import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";

// waitUntil must not throw off Vercel; geolocation is irrelevant here. This
// mock is harmless to other suites (no-op waitUntil, empty geo).
mock.module("@vercel/functions", () => ({
    waitUntil: (_p: Promise<unknown>) => {},
    geolocation: () => ({}),
}));

const { track } = await import("./track");

// Defaults from track.ts; the test exercises both flush triggers with them.
const BATCH_MAX = 20;
const BATCH_DELAY_MS = 1000;

const req = () => new Request("http://localhost/v1/docsets", { headers: { "user-agent": "curl/8" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("track batching", () => {
    let calls: { url: string; lines: string[] }[];
    let fetchSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        // Enable tracking only within these cases so route suites stay quiet.
        process.env.TINYBIRD_TOKEN = "test-token";
        calls = [];
        fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
            url: string | URL | Request,
            init?: RequestInit,
        ) => {
            const body = String(init?.body ?? "");
            calls.push({ url: String(url), lines: body.split("\n").filter((l) => l.length > 0) });
            return new Response("", { status: 202 });
        }) as unknown as typeof fetch);
    });

    afterEach(() => {
        delete process.env.TINYBIRD_TOKEN;
        fetchSpy.mockRestore();
    });

    it("coalesces a full batch into a single POST when BATCH_MAX is reached", () => {
        for (let i = 0; i < BATCH_MAX - 1; i++) track(req(), { event: "catalog" });
        expect(calls.length).toBe(0); // still buffering

        track(req(), { event: "catalog" }); // reaches BATCH_MAX -> flush now
        expect(calls.length).toBe(1);
        expect(calls[0]?.lines.length).toBe(BATCH_MAX);
        expect(calls[0]?.url).toContain("name=events");
        for (const line of calls[0]?.lines ?? []) {
            expect(JSON.parse(line).event).toBe("catalog");
        }
    });

    it("flushes a partial batch once the delay elapses", async () => {
        track(req(), { event: "download" });
        track(req(), { event: "download" });
        expect(calls.length).toBe(0); // under BATCH_MAX, waiting on the timer

        await sleep(BATCH_DELAY_MS + 100);
        expect(calls.length).toBe(1);
        expect(calls[0]?.lines.length).toBe(2);
    });
});
