import { describe, it, expect, mock, beforeEach } from "bun:test";

let mockData: unknown = {};
let mockStatus = 200;

mock.module("./fetch-retry", () => ({
    fetchWithRetry: async (_url: string): Promise<Response> =>
        ({
            ok: mockStatus >= 200 && mockStatus < 300,
            status: mockStatus,
            statusText: mockStatus === 200 ? "OK" : "Service Unavailable",
            json: async () => mockData,
        }) as Response,
}));

import { processContrib } from "./process-contrib";

const sampleResponse = {
    docsets: {
        Jest: {
            name: "Jest",
            archive: "Jest.tgz",
            icon: "aWNvbg==",
            "icon@2x": "aWNvbjJ4",
            version: "29.0",
            specific_versions: [
                { version: "29.0", archive: "Jest-29.0.tgz" },
                { version: "28.0", archive: "Jest-28.0.tgz" },
            ],
        },
        Alamofire: {
            name: "Alamofire",
            archive: "Alamofire.tgz",
            version: "5.8",
        },
        IconOnlyNoAt2x: {
            name: "Icon Only",
            archive: "IconOnly.tgz",
            icon: "aWNvbg==",
            version: "1.0",
        },
    },
};

describe("processContrib", () => {
    beforeEach(() => {
        mockData = sampleResponse;
        mockStatus = 200;
    });

    it("builds versions from specific_versions with main version prepended", async () => {
        const result = await processContrib({ resourceDir: "" });
        const jest = result.find((d) => d.name === "Jest");
        expect(jest?.versions).toEqual(["29.0", "28.0"]);
    });

    it("does not duplicate main version when already in specific_versions", async () => {
        const result = await processContrib({ resourceDir: "" });
        const jest = result.find((d) => d.name === "Jest");
        expect(jest?.versions.filter((v) => v === "29.0")).toHaveLength(1);
    });

    it("prepends main version when absent from specific_versions", async () => {
        mockData = {
            docsets: {
                Foo: {
                    name: "Foo",
                    archive: "Foo.tgz",
                    version: "3.0",
                    specific_versions: [
                        { version: "2.0", archive: "Foo-2.0.tgz" },
                        { version: "1.0", archive: "Foo-1.0.tgz" },
                    ],
                },
            },
        };
        const result = await processContrib({ resourceDir: "" });
        expect(result[0].versions).toEqual(["3.0", "2.0", "1.0"]);
    });

    it("falls back to [version] when no specific_versions", async () => {
        const result = await processContrib({ resourceDir: "" });
        const alamofire = result.find((d) => d.name === "Alamofire");
        expect(alamofire?.versions).toEqual(["5.8"]);
    });

    it("builds specificVersions map from specific_versions", async () => {
        const result = await processContrib({ resourceDir: "" });
        const jest = result.find((d) => d.name === "Jest");
        expect(jest?.specificVersions).toEqual({
            "29.0": "Jest-29.0.tgz",
            "28.0": "Jest-28.0.tgz",
        });
    });

    it("sets empty specificVersions when no specific_versions", async () => {
        const result = await processContrib({ resourceDir: "" });
        const alamofire = result.find((d) => d.name === "Alamofire");
        expect(alamofire?.specificVersions).toEqual({});
    });

    it("sets archive to the top-level archive field", async () => {
        const result = await processContrib({ resourceDir: "" });
        const jest = result.find((d) => d.name === "Jest");
        expect(jest?.archive).toBe("Jest.tgz");
    });

    it("passes through icon and icon@2x from API", async () => {
        const result = await processContrib({ resourceDir: "" });
        const jest = result.find((d) => d.name === "Jest");
        expect(jest?.icon).toBe("aWNvbg==");
        expect(jest?.icon2x).toBe("aWNvbjJ4");
    });

    it("falls back icon2x to icon when icon@2x is absent", async () => {
        const result = await processContrib({ resourceDir: "" });
        const entry = result.find((d) => d.name === "IconOnlyNoAt2x");
        expect(entry?.icon).toBe("aWNvbg==");
        expect(entry?.icon2x).toBe("aWNvbg==");
    });

    it("uses empty strings for icon and icon2x when both absent", async () => {
        const result = await processContrib({ resourceDir: "" });
        const alamofire = result.find((d) => d.name === "Alamofire");
        expect(alamofire?.icon).toBe("");
        expect(alamofire?.icon2x).toBe("");
    });

    it("sets sourceId to com.kapeli.contrib on all entries", async () => {
        const result = await processContrib({ resourceDir: "" });
        expect(result.every((d) => d.sourceId === "com.kapeli.contrib")).toBe(true);
    });

    it("sorts entries case-insensitively by name", async () => {
        const result = await processContrib({ resourceDir: "" });
        const names = result.map((d) => d.name);
        expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    });

    it("throws on non-200 response", async () => {
        mockStatus = 503;
        await expect(processContrib({ resourceDir: "" })).rejects.toThrow("503");
    });

    it("throws on malformed response shape", async () => {
        mockData = { notDocsets: {} };
        await expect(processContrib({ resourceDir: "" })).rejects.toThrow("unexpected shape");
    });
});
