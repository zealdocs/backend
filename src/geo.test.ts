import { describe, it, expect } from "bun:test";
import { getMirror, defaultMirror } from "./geo";

describe("getMirror", () => {
    it("returns default mirror when coordinates are missing", () => {
        expect(getMirror(undefined, undefined)).toBe(defaultMirror);
        expect(getMirror("51.5", undefined)).toBe(defaultMirror);
        expect(getMirror(undefined, "-0.1")).toBe(defaultMirror);
    });

    it("returns default mirror for non-numeric inputs", () => {
        expect(getMirror("abc", "xyz")).toBe(defaultMirror);
        expect(getMirror("51.5", "invalid")).toBe(defaultMirror);
    });

    it("returns a mirror for zero coordinates", () => {
        expect(getMirror("0", "0")).toBeDefined();
    });

    it("returns default mirror for out-of-range coordinates", () => {
        expect(getMirror("91", "0")).toBe(defaultMirror);
        expect(getMirror("-91", "0")).toBe(defaultMirror);
        expect(getMirror("0", "181")).toBe(defaultMirror);
        expect(getMirror("0", "-181")).toBe(defaultMirror);
    });

    it("returns Tokyo for coordinates near the antimeridian", () => {
        expect(getMirror("35.7", "179.9")).toBe("tokyo.kapeli.com");
        expect(getMirror("35.7", "-179.9")).toBe("tokyo.kapeli.com");
    });

    it("returns Frankfurt for European coordinates", () => {
        expect(getMirror("50.1", "8.7")).toBe("frankfurt.kapeli.com"); // Frankfurt
        expect(getMirror("52.5", "13.4")).toBe("frankfurt.kapeli.com"); // Berlin
    });

    it("returns London for UK coordinates", () => {
        expect(getMirror("51.5", "-0.1")).toBe("london.kapeli.com"); // London
        expect(getMirror("48.9", "2.3")).toBe("london.kapeli.com"); // Paris
    });

    it("returns New York for East US coordinates", () => {
        expect(getMirror("40.7", "-74.0")).toBe("newyork.kapeli.com"); // New York
        expect(getMirror("38.9", "-77.0")).toBe("newyork.kapeli.com"); // Washington D.C.
    });

    it("returns San Francisco for West US coordinates", () => {
        expect(getMirror("37.8", "-122.4")).toBe("sanfrancisco.kapeli.com"); // San Francisco
        expect(getMirror("47.6", "-122.3")).toBe("sanfrancisco.kapeli.com"); // Seattle
    });

    it("returns Tokyo for Asia-Pacific coordinates", () => {
        expect(getMirror("35.7", "139.7")).toBe("tokyo.kapeli.com"); // Tokyo
        expect(getMirror("1.3", "103.8")).toBe("tokyo.kapeli.com"); // Singapore
        expect(getMirror("-33.9", "151.2")).toBe("tokyo.kapeli.com"); // Sydney
    });
});
