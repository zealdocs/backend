import { describe, it, expect } from "bun:test";
import { dashFeedName, dashArchiveUrl, contribArchiveUrl, cheatsheetArchiveUrl, tarixUrl } from "./mirror-url";

const M = "frankfurt.kapeli.com";

describe("dashFeedName", () => {
    const manifest = { Go: {}, Python_3: { source: "Python" } };

    it("returns the docset id when no source override", () => {
        expect(dashFeedName("Go", manifest)).toBe("Go");
    });

    it("returns the source override when present", () => {
        expect(dashFeedName("Python_3", manifest)).toBe("Python");
    });

    it("returns null for unknown docsets", () => {
        expect(dashFeedName("Nope", manifest)).toBeNull();
    });
});

describe("dashArchiveUrl", () => {
    it("uses the versioned path when a version is given", () => {
        expect(dashArchiveUrl("Go", "1.26.1", M)).toBe(
            "https://frankfurt.kapeli.com/feeds/zzz/versions/Go/1.26.1/Go.tgz",
        );
    });

    it("uses the feed root when no version", () => {
        expect(dashArchiveUrl("Bash", undefined, M)).toBe("https://frankfurt.kapeli.com/feeds/Bash.tgz");
    });
});

describe("contrib/cheatsheet/tarix URLs", () => {
    it("builds the contrib path with key and archive", () => {
        expect(contribArchiveUrl("Jest", "Jest.tgz", M)).toBe(
            "https://frankfurt.kapeli.com/feeds/zzz/user_contributed/build/Jest/Jest.tgz",
        );
    });

    it("builds the cheatsheet path", () => {
        expect(cheatsheetArchiveUrl("Vim", M)).toBe("https://frankfurt.kapeli.com/feeds/zzz/cheatsheets/Vim.tgz");
    });

    it("appends .tarix to any archive url", () => {
        expect(tarixUrl("https://x/y.tgz")).toBe("https://x/y.tgz.tarix");
    });
});
