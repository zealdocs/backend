import { describe, it, expect, mock, beforeAll, beforeEach, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { PNG } from "pngjs";

let mockData: unknown = {};
let mockStatus = 200;

mock.module("./fetch-retry", () => ({
    fetchWithRetry: async (_url: string): Promise<Response> =>
        ({
            ok: mockStatus >= 200 && mockStatus < 300,
            status: mockStatus,
            statusText: mockStatus === 200 ? "OK" : "Service Unavailable",
            json: async () => mockData,
            text: async () => JSON.stringify(mockData),
        }) as Response,
}));

import { processCheatsheets } from "./process-cheatsheets";

function createColorPng(r: number, g: number, b: number): Buffer {
    const p = new PNG({ width: 1, height: 1 });
    p.data = Buffer.from([r, g, b, 255]);
    return PNG.sync.write(p);
}

const sampleResponse = {
    cheatsheets: {
        Vim: { name: "Vim", version: "4.0" },
        React: { name: "React", version: "18.0" },
        Unknown: { name: "Unknown Tool", version: "1.0" },
    },
};

describe("processCheatsheets", () => {
    let tmpDir: string;
    let resourceDir: string;
    let iconDir: string;
    let matchedIconBase64: string;
    let fallbackIconBase64: string;

    beforeAll(async () => {
        tmpDir = join(tmpdir(), `test-processCheatsheets-${Date.now()}`);
        resourceDir = join(tmpDir, "resources");
        iconDir = join(resourceDir, "docset_icons");
        mkdirSync(iconDir, { recursive: true });

        const matchedPng = createColorPng(255, 0, 0); // red — for named icons
        const fallbackPng = createColorPng(0, 255, 0); // green — for cheatsheet fallback

        writeFileSync(join(iconDir, "vim.png"), matchedPng);
        writeFileSync(join(iconDir, "react.png"), matchedPng);
        writeFileSync(join(iconDir, "react@2x.png"), matchedPng);
        writeFileSync(join(iconDir, "cheatsheet.png"), fallbackPng);
        writeFileSync(join(iconDir, "cheatsheet@2x.png"), fallbackPng);

        mockData = sampleResponse;
        mockStatus = 200;

        // Capture base64 values by running a single build to reference in assertions
        const result = await processCheatsheets({ resourceDir });
        matchedIconBase64 = result.find((d) => d.name === "Vim")?.icon ?? "";
        fallbackIconBase64 = result.find((d) => d.name === "Unknown")?.icon ?? "";
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        mockData = sampleResponse;
        mockStatus = 200;
    });

    it("matches icon by key.toLowerCase()", async () => {
        const result = await processCheatsheets({ resourceDir });
        const vim = result.find((d) => d.name === "Vim");
        expect(vim?.icon).toBe(matchedIconBase64);
    });

    it("matches @2x icon separately from 1x", async () => {
        const result = await processCheatsheets({ resourceDir });
        const react = result.find((d) => d.name === "React");
        expect(react?.icon).toBe(matchedIconBase64);
        expect(react?.icon2x).toBe(matchedIconBase64);
    });

    it("falls back 1x to cheatsheet.png when no match", async () => {
        const result = await processCheatsheets({ resourceDir });
        const unknown = result.find((d) => d.name === "Unknown");
        expect(unknown?.icon).toBe(fallbackIconBase64);
        expect(unknown?.icon).not.toBe(matchedIconBase64);
    });

    it("falls back 2x to cheatsheet@2x.png when no match", async () => {
        const result = await processCheatsheets({ resourceDir });
        const unknown = result.find((d) => d.name === "Unknown");
        expect(unknown?.icon2x).toBe(fallbackIconBase64);
    });

    it("uses empty string when no match and no cheatsheet.png", async () => {
        const emptyDir = join(tmpDir, "empty-resources");
        mkdirSync(join(emptyDir, "docset_icons"), { recursive: true });
        const result = await processCheatsheets({ resourceDir: emptyDir });
        expect(result.every((d) => d.icon === "" && d.icon2x === "")).toBe(true);
    });

    it("handles missing iconDir without crashing", async () => {
        const result = await processCheatsheets({ resourceDir: join(tmpDir, "nonexistent") });
        expect(result.every((d) => d.icon === "")).toBe(true);
    });

    it("sets versions from API version field", async () => {
        const result = await processCheatsheets({ resourceDir });
        const vim = result.find((d) => d.name === "Vim");
        expect(vim?.versions).toEqual(["4.0"]);
    });

    it("sets sourceId to com.kapeli.cheatsheet on all entries", async () => {
        const result = await processCheatsheets({ resourceDir });
        expect(result.every((d) => d.sourceId === "com.kapeli.cheatsheet")).toBe(true);
    });

    it("sorts entries case-insensitively by name", async () => {
        const result = await processCheatsheets({ resourceDir });
        const names = result.map((d) => d.name);
        expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    });

    it("throws on non-200 response", async () => {
        mockStatus = 503;
        await expect(processCheatsheets({ resourceDir })).rejects.toThrow("503");
    });

    it("throws on malformed response shape", async () => {
        mockData = { notCheatsheets: {} };
        await expect(processCheatsheets({ resourceDir })).rejects.toThrow("unexpected shape");
    });
});
