import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { enrichMetadata, archiveUrl, type EnrichableEntry } from "./probe-metadata";
import type { CatalogDiff } from "./catalog-diff";

const MIRROR = "m.test";
const manifest = { Go: {} };

const realFetch = globalThis.fetch;
let responses: Map<string, { status: number; len?: string }>;
let throwUrls: Set<string>;
let fetched: string[];

beforeEach(() => {
    responses = new Map();
    throwUrls = new Set();
    fetched = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
        const u = String(url);
        fetched.push(u);
        if (throwUrls.has(u)) throw new Error("network");
        const r = responses.get(u);
        const headers = new Headers();
        if (r?.len !== undefined) headers.set("content-length", r.len);
        return { status: r?.status ?? 404, headers } as Response;
    }) as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

const emptyDiff = (): CatalogDiff => ({ unchanged: [], changed: [], added: [], removed: [] });

describe("archiveUrl", () => {
    it("builds per-source URLs and rejects unknown sources", () => {
        expect(archiveUrl({ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }, MIRROR, manifest)).toBe(
            "https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz",
        );
        expect(
            archiveUrl({ name: "Jest", sourceId: "com.kapeli.contrib", archive: "Jest.tgz" }, MIRROR, manifest),
        ).toBe("https://m.test/feeds/zzz/user_contributed/build/Jest/Jest.tgz");
        expect(archiveUrl({ name: "Vim", sourceId: "com.kapeli.cheatsheet" }, MIRROR, manifest)).toBe(
            "https://m.test/feeds/zzz/cheatsheets/Vim.tgz",
        );
        expect(archiveUrl({ name: "X", sourceId: "other" }, MIRROR, manifest)).toBeNull();
    });
});

describe("enrichMetadata", () => {
    it("reuses baseline metadata for unchanged entries without probing", async () => {
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), unchanged: ["com.kapeli.dash/Go"] };
        const baseline = [{ name: "Go", sourceId: "com.kapeli.dash", size: 999, tarix: true }];

        const stats = await enrichMetadata({ entries, diff, baseline, manifest, mirror: MIRROR });

        expect(entries[0].size).toBe(999);
        expect(entries[0].tarix).toBe(true);
        expect(stats).toEqual({ reused: 1, probed: 0, failed: 0, skipped: 0 });
        expect(fetched).toHaveLength(0);
    });

    it("probes changed entries; size = archive + tarix when tarix exists", async () => {
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz", { status: 200, len: "1000" });
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz.tarix", { status: 200, len: "50" });
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/Go"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR });

        expect(entries[0].size).toBe(1050);
        expect(entries[0].tarix).toBe(true);
        expect(stats).toEqual({ reused: 0, probed: 1, failed: 0, skipped: 0 });
    });

    it("falls back to the bare path when a dash versioned artifact is missing", async () => {
        // Versioned URL 404s (default); only the bare feed file and its tarix exist.
        const m = { ActionScript: {} };
        responses.set("https://m.test/feeds/ActionScript.tgz", { status: 200, len: "600" });
        responses.set("https://m.test/feeds/ActionScript.tgz.tarix", { status: 200, len: "20" });
        const entries: EnrichableEntry[] = [{ name: "ActionScript", sourceId: "com.kapeli.dash", versions: ["3"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/ActionScript"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest: m, mirror: MIRROR });

        expect(entries[0].size).toBe(620);
        expect(entries[0].tarix).toBe(true);
        expect(entries[0].bareLatest).toBe(true);
        expect(stats.probed).toBe(1);
    });

    it("does not fall back to bare on a transient versioned error", async () => {
        // Versioned HEAD errors transiently (not a definitive 404); bare exists.
        // Must stay unset for re-probe, not switch to bare.
        const m = { ActionScript: {} };
        throwUrls.add("https://m.test/feeds/zzz/versions/ActionScript/3/ActionScript.tgz");
        responses.set("https://m.test/feeds/ActionScript.tgz", { status: 200, len: "600" });
        responses.set("https://m.test/feeds/ActionScript.tgz.tarix", { status: 200, len: "20" });
        const entries: EnrichableEntry[] = [{ name: "ActionScript", sourceId: "com.kapeli.dash", versions: ["3"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/ActionScript"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest: m, mirror: MIRROR, timeoutMs: 50 });

        expect(entries[0].bareLatest).toBeUndefined();
        expect(entries[0].size).toBeUndefined();
        expect(stats.failed).toBe(1);
    });

    it("does not set bareLatest when the versioned artifact resolves normally", async () => {
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz", { status: 200, len: "1000" });
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz.tarix", { status: 200, len: "50" });
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/Go"] };

        await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR });

        expect(entries[0].bareLatest).toBeUndefined();
    });

    it("dash docset without a tarix index records tarix=false, size=archive", async () => {
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz", { status: 200, len: "1000" });
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz.tarix", { status: 302 });
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/Go"] };

        await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR });

        expect(entries[0].size).toBe(1000);
        expect(entries[0].tarix).toBe(false);
    });

    it("skips the tarix probe entirely for cheatsheets (source config)", async () => {
        responses.set("https://m.test/feeds/zzz/cheatsheets/Vim.tgz", { status: 200, len: "500" });
        const entries: EnrichableEntry[] = [{ name: "Vim", sourceId: "com.kapeli.cheatsheet" }];
        const diff = { ...emptyDiff(), added: ["com.kapeli.cheatsheet/Vim"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR });

        expect(entries[0].size).toBe(500);
        expect(entries[0].tarix).toBe(false);
        expect(stats.probed).toBe(1);
        // Only the archive was fetched; the .tarix URL was never requested.
        expect(fetched).toEqual(["https://m.test/feeds/zzz/cheatsheets/Vim.tgz"]);
    });

    it("leaves fields unset and counts failure when the archive is unreachable", async () => {
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/Go"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR });

        expect(entries[0].size).toBeUndefined();
        expect(entries[0].tarix).toBeUndefined();
        expect(stats).toEqual({ reused: 0, probed: 0, failed: 1, skipped: 0 });
    });

    it("treats a 429 on the archive as transient (not a definitive absence)", async () => {
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz", { status: 429 });
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/Go"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR, timeoutMs: 50 });

        // Retried then gave up -> unset (re-probe next build), never recorded as size 0 / tarix false.
        expect(entries[0].size).toBeUndefined();
        expect(entries[0].tarix).toBeUndefined();
        expect(stats.failed).toBe(1);
    });

    it("leaves fields unset when the tarix probe errors (so it re-probes next build)", async () => {
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz", { status: 200, len: "1000" });
        throwUrls.add("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz.tarix");
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), changed: ["com.kapeli.dash/Go"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR, timeoutMs: 50 });

        expect(entries[0].size).toBeUndefined();
        expect(entries[0].tarix).toBeUndefined();
        expect(stats.failed).toBe(1);
    });

    it("counts entries with no resolvable URL as skipped, not failed", async () => {
        const entries: EnrichableEntry[] = [{ name: "X", sourceId: "other" }];
        const diff = { ...emptyDiff(), added: ["other/X"] };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR });

        expect(stats).toEqual({ reused: 0, probed: 0, failed: 0, skipped: 1 });
        expect(fetched).toHaveLength(0);
    });

    it("probes when marked unchanged but baseline lacks metadata (first run)", async () => {
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz", { status: 200, len: "1000" });
        responses.set("https://m.test/feeds/zzz/versions/Go/1.0/Go.tgz.tarix", { status: 200, len: "50" });
        const entries: EnrichableEntry[] = [{ name: "Go", sourceId: "com.kapeli.dash", versions: ["1.0"] }];
        const diff = { ...emptyDiff(), unchanged: ["com.kapeli.dash/Go"] };
        const baseline = [{ name: "Go", sourceId: "com.kapeli.dash" }]; // no size/tarix

        const stats = await enrichMetadata({ entries, diff, baseline, manifest, mirror: MIRROR });

        expect(entries[0].size).toBe(1050);
        expect(stats.probed).toBe(1);
    });

    it("processes every entry when there are more entries than the concurrency limit", async () => {
        const entries: EnrichableEntry[] = [];
        const added: string[] = [];
        for (let i = 0; i < 40; i++) {
            const name = `Sheet${i}`;
            responses.set(`https://m.test/feeds/zzz/cheatsheets/${name}.tgz`, { status: 200, len: "100" });
            entries.push({ name, sourceId: "com.kapeli.cheatsheet" });
            added.push(`com.kapeli.cheatsheet/${name}`);
        }
        const diff = { ...emptyDiff(), added };

        const stats = await enrichMetadata({ entries, diff, baseline: [], manifest, mirror: MIRROR, concurrency: 4 });

        expect(stats.probed).toBe(40);
        expect(entries.every((e) => e.size === 100 && e.tarix === false)).toBe(true);
    });
});
