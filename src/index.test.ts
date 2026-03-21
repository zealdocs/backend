import { describe, it, expect } from "bun:test";
import { createApp } from "./index";

const app = createApp(
    // Legacy com.kapeli catalog (for /v1/docsets and official routing)
    [
        { name: "Akka", versions: ["2.10.16", "2.10.15"] },
        { name: "Python_3", versions: ["3.14.3", "3.13.7"] },
    ],
    // Full catalog: dash + contrib + cheatsheet entries (for /v1/catalog and routing)
    [
        { name: "Akka", sourceId: "com.kapeli.dash", versions: ["2.10.16", "2.10.15"] },
        { name: "Python_3", sourceId: "com.kapeli.dash", versions: ["3.14.3", "3.13.7"] },
        {
            name: "Jest",
            sourceId: "com.kapeli.contrib",
            versions: ["29.0"],
            archive: "Jest.tgz",
            specificVersions: { "29.0": "Jest-29.0.tgz" },
        },
        { name: "Vim", sourceId: "com.kapeli.cheatsheet", versions: ["4.0"] },
    ],
);

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

// describe("GET /v1/catalog", () => {
//     it("returns 200 JSON", async () => {
//         const res = await app.handle(new Request("http://localhost/v1/catalog"));
//         expect(res.status).toBe(200);
//         expect(res.headers.get("content-type")).toContain("application/json");
//     });
// });

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
    // com.kapeli — official
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

    it("returns 400 for version with disallowed characters", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Akka/1.0;injection"));
        expect(res.status).toBe(400);
    });

    it("returns 400 for version with space", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Akka/1.0%20bad"));
        expect(res.status).toBe(400);
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

    // com.kapeli — _Cheatsheet suffix routing
    it("redirects _Cheatsheet suffix to cheatsheet URL", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Vim_Cheatsheet/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(/\.kapeli\.com\/feeds\/zzz\/cheatsheets\/Vim\.tgz$/);
    });

    // com.kapeli — _Contrib suffix routing
    it("redirects _Contrib suffix to contrib URL (latest)", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Jest_Contrib/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(
            /\.kapeli\.com\/feeds\/zzz\/user_contributed\/build\/Jest\/Jest\.tgz$/,
        );
    });

    it("redirects _Contrib suffix to contrib URL (specific version)", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Jest_Contrib/29.0"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(
            /\.kapeli\.com\/feeds\/zzz\/user_contributed\/build\/Jest\/Jest-29\.0\.tgz$/,
        );
    });

    it("returns 404 for unknown _Contrib docset", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Unknown_Contrib/latest"));
        expect(res.status).toBe(404);
    });

    // com.kapeli.dash
    it("redirects com.kapeli.dash to official URL", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.dash/Python_3/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(
            /\.kapeli\.com\/feeds\/zzz\/versions\/Python\/3\.14\.3\/Python\.tgz$/,
        );
    });

    it("returns 404 for unknown docsetId in com.kapeli.dash", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.dash/NoSuchDocset/latest"));
        expect(res.status).toBe(404);
    });

    // com.kapeli.contrib
    it("redirects com.kapeli.contrib to contrib URL (latest)", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.contrib/Jest/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(
            /\.kapeli\.com\/feeds\/zzz\/user_contributed\/build\/Jest\/Jest\.tgz$/,
        );
    });

    it("redirects com.kapeli.contrib to contrib URL (specific version)", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.contrib/Jest/29.0"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(
            /\.kapeli\.com\/feeds\/zzz\/user_contributed\/build\/Jest\/Jest-29\.0\.tgz$/,
        );
    });

    it("returns 404 for unknown docsetId in com.kapeli.contrib", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.contrib/Unknown/latest"));
        expect(res.status).toBe(404);
    });

    // com.kapeli.cheatsheet
    it("redirects com.kapeli.cheatsheet to cheatsheet URL", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.cheatsheet/Vim/latest"));
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toMatch(/\.kapeli\.com\/feeds\/zzz\/cheatsheets\/Vim\.tgz$/);
    });

    it("returns 404 for unknown docsetId in com.kapeli.cheatsheet", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli.cheatsheet/Unknown/latest"));
        expect(res.status).toBe(404);
    });

    it("returns 404 for unknown _Cheatsheet suffix docset", async () => {
        const res = await app.handle(new Request("http://localhost/d/com.kapeli/Unknown_Cheatsheet/latest"));
        expect(res.status).toBe(404);
    });
});
