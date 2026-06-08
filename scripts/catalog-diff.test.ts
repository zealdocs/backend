import { describe, it, expect, mock } from "bun:test";

let baselineJson: unknown = [];
mock.module("./fetch-retry", () => ({
    fetchWithRetry: async (_url: string): Promise<Response> => ({ json: async () => baselineJson }) as Response,
}));

import { entryKey, fingerprint, diffCatalog, fetchBaseline, type DiffableEntry } from "./catalog-diff";

describe("entryKey", () => {
    it("combines sourceId and name", () => {
        expect(entryKey({ sourceId: "com.kapeli.dash", name: "Bash" })).toBe("com.kapeli.dash/Bash");
    });

    it("distinguishes same name across sources", () => {
        const a = entryKey({ sourceId: "com.kapeli.dash", name: "Vim" });
        const b = entryKey({ sourceId: "com.kapeli.cheatsheet", name: "Vim" });
        expect(a).not.toBe(b);
    });
});

describe("fingerprint", () => {
    it("dash: changes with revision or version list", () => {
        const base: DiffableEntry = { name: "Bash", sourceId: "com.kapeli.dash", revision: "9", versions: ["9"] };
        expect(fingerprint(base)).toBe(fingerprint({ ...base }));
        expect(fingerprint({ ...base, revision: "10" })).not.toBe(fingerprint(base));
        expect(fingerprint({ ...base, versions: ["9", "8"] })).not.toBe(fingerprint(base));
    });

    it("contrib: changes with archive or specific versions", () => {
        const base: DiffableEntry = {
            name: "Jest",
            sourceId: "com.kapeli.contrib",
            versions: ["29.0"],
            archive: "Jest.tgz",
            specificVersions: { "29.0": "versions/29.0/Jest.tgz" },
        };
        expect(fingerprint(base)).toBe(fingerprint({ ...base }));
        expect(fingerprint({ ...base, archive: "Jest-new.tgz" })).not.toBe(fingerprint(base));
        expect(fingerprint({ ...base, specificVersions: { "29.0": "x", "28.0": "y" } })).not.toBe(fingerprint(base));
    });

    it("contrib: specific-version order does not matter", () => {
        const a: DiffableEntry = {
            name: "Jest",
            sourceId: "com.kapeli.contrib",
            versions: ["29.0"],
            archive: "Jest.tgz",
            specificVersions: { "29.0": "a", "28.0": "b" },
        };
        const b: DiffableEntry = { ...a, specificVersions: { "28.0": "b", "29.0": "a" } };
        expect(fingerprint(a)).toBe(fingerprint(b));
    });

    it("contrib: changes when a specific-version archive path changes", () => {
        const a: DiffableEntry = {
            name: "Jest",
            sourceId: "com.kapeli.contrib",
            versions: ["29.0"],
            archive: "Jest.tgz",
            specificVersions: { "29.0": "versions/29.0/Jest.tgz" },
        };
        const b: DiffableEntry = { ...a, specificVersions: { "29.0": "versions/29.0/Jest-v2.tgz" } };
        expect(fingerprint(a)).not.toBe(fingerprint(b));
    });

    it("cheatsheet: changes only with version", () => {
        const base: DiffableEntry = { name: "Vim", sourceId: "com.kapeli.cheatsheet", versions: ["1"] };
        expect(fingerprint(base)).toBe(fingerprint({ ...base }));
        expect(fingerprint({ ...base, versions: ["2"] })).not.toBe(fingerprint(base));
    });
});

describe("diffCatalog", () => {
    const baseline: DiffableEntry[] = [
        { name: "Bash", sourceId: "com.kapeli.dash", revision: "9", versions: ["9"] },
        { name: "Go", sourceId: "com.kapeli.dash", revision: "1", versions: ["1.26"] },
        { name: "Vim", sourceId: "com.kapeli.cheatsheet", versions: ["1"] },
    ];

    it("classifies unchanged, changed, added, removed", () => {
        const current: DiffableEntry[] = [
            { name: "Bash", sourceId: "com.kapeli.dash", revision: "9", versions: ["9"] }, // unchanged
            { name: "Go", sourceId: "com.kapeli.dash", revision: "2", versions: ["1.27"] }, // changed
            { name: "Rust", sourceId: "com.kapeli.dash", revision: "1", versions: ["1.0"] }, // added
            // Vim cheatsheet dropped -> removed
        ];
        const diff = diffCatalog(current, baseline);
        expect(diff.unchanged).toEqual(["com.kapeli.dash/Bash"]);
        expect(diff.changed).toEqual(["com.kapeli.dash/Go"]);
        expect(diff.added).toEqual(["com.kapeli.dash/Rust"]);
        expect(diff.removed).toEqual(["com.kapeli.cheatsheet/Vim"]);
    });

    it("treats an empty baseline as all-added", () => {
        const diff = diffCatalog(baseline, []);
        expect(diff.added).toHaveLength(3);
        expect(diff.unchanged).toHaveLength(0);
        expect(diff.changed).toHaveLength(0);
        expect(diff.removed).toHaveLength(0);
    });
});

describe("fetchBaseline", () => {
    it("drops malformed entries missing name or sourceId", async () => {
        baselineJson = [
            { name: "Bash", sourceId: "com.kapeli.dash" },
            { name: "NoSource" },
            { sourceId: "com.kapeli.dash" },
            null,
        ];
        const entries = await fetchBaseline("https://example/catalog.json");
        expect(entries).toEqual([{ name: "Bash", sourceId: "com.kapeli.dash" }]);
    });

    it("throws when the payload is not an array", async () => {
        baselineJson = { not: "an array" };
        await expect(fetchBaseline("https://example/catalog.json")).rejects.toThrow();
    });
});
