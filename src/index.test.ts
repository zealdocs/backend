import { describe, it, expect } from "bun:test";
import { createApp } from "./index";

const app = createApp([
    { name: "Akka", versions: ["2.10.16", "2.10.15"] },
    { name: "Python_3", versions: ["3.14.3", "3.13.7"] },
]);

describe("GET /v1/releases", () => {
    it("returns 200 JSON", async () => {
        const res = await app.handle(new Request("http://localhost/v1/releases"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
    });
});

describe("GET /v1/docsets", () => {
    it("returns 200 JSON", async () => {
        const res = await app.handle(new Request("http://localhost/v1/docsets"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
    });
});

describe("GET /", () => {
    it("redirects to zealdocs.org", async () => {
        const res = await app.handle(new Request("http://localhost/"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://zealdocs.org");
    });
});

describe("GET /l/:linkId", () => {
    it("redirects to GitHub", async () => {
        const res = await app.handle(new Request("http://localhost/l/github"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://github.com/zealdocs/zeal");
    });

    it("returns 404 for unknown link", async () => {
        const res = await app.handle(new Request("http://localhost/l/unknown"));
        expect(res.status).toBe(404);
    });
});

describe("GET /d/:sourceId/:docsetId/:version", () => {
    it("redirects to versioned URL for latest", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Akka/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(/\.kapeli\.com\/feeds\/zzz\/versions\/Akka\/2\.10\.16\/Akka\.tgz$/);
    });

    it("uses source feed name in URL for split docsets", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Python_3/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(
            /\.kapeli\.com\/feeds\/zzz\/versions\/Python\/3\.14\.3\/Python\.tgz$/,
        );
    });

    it("falls back to unversioned URL when not in catalog", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/C++/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(/\.kapeli\.com\/feeds\/C\+\+\.tgz$/);
    });

    it("returns 404 for unknown sourceId", async () => {
        const res = await app.handle(new Request("http://localhost/d/unknown/Python/latest"));
        expect(res.status).toBe(404);
    });

    it("returns 404 for unknown docsetId", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/NoSuchDocset/latest"));
        expect(res.status).toBe(404);
    });

    it("redirects to versioned URL for specific version", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Akka/2.10.16"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(/\.kapeli\.com\/feeds\/zzz\/versions\/Akka\/2\.10\.16\/Akka\.tgz$/);
    });

    it("returns 404 for unknown docset with specific version", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/NoSuchDocset/1.0"));
        expect(res.status).toBe(404);
    });
});
