import { describe, it, expect } from "bun:test";
import { getMirror, defaultMirror } from "./geo";

describe("getMirror", () => {
    it("returns default mirror for undefined", () => {
        expect(getMirror(undefined)).toBe(defaultMirror);
    });

    it("returns default mirror for unknown region", () => {
        expect(getMirror("xyz1")).toBe(defaultMirror);
    });

    it("returns correct mirror for known regions", () => {
        expect(getMirror("fra1")).toBe("frankfurt.kapeli.com");
        expect(getMirror("iad1")).toBe("newyork.kapeli.com");
        expect(getMirror("lhr1")).toBe("london.kapeli.com");
        expect(getMirror("hnd1")).toBe("tokyo.kapeli.com");
        expect(getMirror("sfo1")).toBe("sanfrancisco.kapeli.com");
    });
});
