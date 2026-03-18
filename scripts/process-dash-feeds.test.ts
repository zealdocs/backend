import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { PNG } from "pngjs";
import { readIcon, processFeeds, checkCoverage } from "./process-dash-feeds";

// CRC32 implementation for building test PNG chunks
const crc32Table = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[i] = c;
    }
    return table;
})();

function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buf) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
    const lenBuf = Buffer.allocUnsafe(4);
    lenBuf.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createBasePng(): Buffer {
    const p = new PNG({ width: 1, height: 1 });
    p.data = Buffer.from([255, 0, 0, 255]);
    return PNG.sync.write(p);
}

function injectTextChunk(pngBuf: Buffer): Buffer {
    let offset = 8;
    let insertPos = pngBuf.length;
    while (offset < pngBuf.length) {
        const len = pngBuf.readUInt32BE(offset);
        const type = pngBuf.subarray(offset + 4, offset + 8).toString("ascii");
        if (type === "IDAT") {
            insertPos = offset;
            break;
        }
        offset += 12 + len;
    }
    const textChunk = makeChunk("tEXt", Buffer.from("Comment\0test"));
    return Buffer.concat([pngBuf.subarray(0, insertPos), textChunk, pngBuf.subarray(insertPos)]);
}

function getPngChunkTypes(buf: Buffer): string[] {
    const types: string[] = [];
    let offset = 8;
    while (offset < buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
        types.push(type);
        offset += 12 + len;
    }
    return types;
}

describe("readIcon", () => {
    let tmpDir: string;
    let cleanPngPath: string;
    let dirtyPngPath: string;

    beforeAll(() => {
        tmpDir = join(tmpdir(), `test-readIcon-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });

        const base = createBasePng();
        cleanPngPath = join(tmpDir, "clean.png");
        writeFileSync(cleanPngPath, base);

        dirtyPngPath = join(tmpDir, "dirty.png");
        writeFileSync(dirtyPngPath, injectTextChunk(base));
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns valid base64", () => {
        const result = readIcon(cleanPngPath);
        expect(() => Buffer.from(result, "base64")).not.toThrow();
        const decoded = Buffer.from(result, "base64");
        // PNG signature
        expect(decoded.subarray(0, 4).toString("hex")).toBe("89504e47");
    });

    it("strips non-whitelisted PNG chunks", () => {
        // Verify the dirty PNG actually has the injected chunk
        const rawChunks = getPngChunkTypes(readFileSync(dirtyPngPath));
        expect(rawChunks).toContain("tEXt");

        const result = readIcon(dirtyPngPath);
        const decoded = Buffer.from(result, "base64");
        const chunks = getPngChunkTypes(decoded);

        expect(chunks).not.toContain("tEXt");
        expect(chunks).toContain("IHDR");
        expect(chunks).toContain("IDAT");
        expect(chunks).toContain("IEND");
    });
});

describe("processFeeds", () => {
    let tmpDir: string;
    let feedDir: string;
    let iconDir: string;
    let outputPath: string;

    beforeAll(() => {
        tmpDir = join(tmpdir(), `test-processFeeds-${Date.now()}`);
        feedDir = join(tmpDir, "feeds");
        const resourceDir = join(tmpDir, "resources");
        iconDir = join(resourceDir, "docset_icons");
        outputPath = join(tmpDir, "output.json");

        mkdirSync(feedDir, { recursive: true });
        mkdirSync(iconDir, { recursive: true });

        // Create PNG icons
        const pngBuf = createBasePng();
        writeFileSync(join(iconDir, "python.png"), pngBuf);
        writeFileSync(join(iconDir, "python@2x.png"), pngBuf);
        writeFileSync(join(iconDir, "ruby.png"), pngBuf);
        writeFileSync(join(iconDir, "ruby@2x.png"), pngBuf);
        writeFileSync(join(iconDir, "aws.png"), pngBuf);
        writeFileSync(join(iconDir, "aws@2x.png"), pngBuf);

        // Create feed XML files
        writeFileSync(
            join(feedDir, "Python.xml"),
            `<entry><version>3.11/2</version><other-versions><version><name>3.11</name></version><version><name>3.10</name></version></other-versions></entry>`,
        );
        writeFileSync(join(feedDir, "Ruby.xml"), `<entry><version>3.2/0</version></entry>`);
        writeFileSync(join(feedDir, "Blacklisted.xml"), `<entry><version>1.0/0</version></entry>`);
        writeFileSync(join(feedDir, "AWS_JavaScript.xml"), `<entry><version>3.0/1</version></entry>`);
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("parses version and revision from XML", async () => {
        const manifest = {
            Python: { title: "Python", iconName: "python" },
            Ruby: { title: "Ruby", iconName: "ruby" },
        };
        await processFeeds({
            manifest,
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        const python = result.find((d: { name: string }) => d.name === "Python");
        expect(python.revision).toBe("2");
        expect(python.versions).toEqual(["3.11", "3.10"]);

        const ruby = result.find((d: { name: string }) => d.name === "Ruby");
        expect(ruby.revision).toBe("0");
        expect(ruby.versions).toEqual(["3.2"]);
    });

    it("skips blacklisted docsets", async () => {
        const manifest = {
            Python: { title: "Python", iconName: "python" },
            Blacklisted: { title: "Blacklisted", iconName: "python" },
        };
        await processFeeds({
            manifest,
            blacklist: ["Blacklisted"],
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        expect(result.find((d: { name: string }) => d.name === "Blacklisted")).toBeUndefined();
        expect(result.find((d: { name: string }) => d.name === "Python")).toBeDefined();
    });

    it("uses source field to read a different XML file", async () => {
        const manifest = {
            Python_3: { title: "Python 3", iconName: "python", source: "Python", versionPrefix: "3." },
        };
        await processFeeds({
            manifest,
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        const entry = result.find((d: { name: string }) => d.name === "Python_3");
        expect(entry).toBeDefined();
        expect(entry.versions).toEqual(["3.11", "3.10"]);
    });

    it("filters versions by versionPrefix", async () => {
        const manifest = {
            Python_2: { title: "Python 2", iconName: "python", source: "Python", versionPrefix: "2." },
            Python_3: { title: "Python 3", iconName: "python", source: "Python", versionPrefix: "3." },
        };
        await processFeeds({
            manifest,
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        const py2 = result.find((d: { name: string }) => d.name === "Python_2");
        const py3 = result.find((d: { name: string }) => d.name === "Python_3");
        expect(py2.versions).toEqual([]);
        expect(py3.versions).toEqual(["3.11", "3.10"]);
    });

    it("includes extra fields from manifest", async () => {
        const manifest = {
            Python: {
                title: "Python",
                iconName: "python",
                extra: { isJavaScriptEnabled: true },
            },
        };
        await processFeeds({
            manifest,
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        const python = result.find((d: { name: string }) => d.name === "Python");
        expect(python.extra).toEqual({ isJavaScriptEnabled: true });
    });

    it("sorts output case-insensitively by name", async () => {
        const manifest = {
            Python: { title: "Python", iconName: "python" },
            Ruby: { title: "Ruby", iconName: "ruby" },
            AWS_JavaScript: { title: "AWS JavaScript", iconName: "aws" },
        };
        await processFeeds({
            manifest,
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        const names = result.map((d: { name: string }) => d.name);
        expect(names).toEqual([...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
    });

    it("skips entry when source XML file is missing", async () => {
        const manifest = {
            MissingSource: { title: "Missing", iconName: "python", source: "DoesNotExist" },
            Python: { title: "Python", iconName: "python" },
        };
        await processFeeds({
            manifest,
            feedDir,
            resourceDir: join(tmpDir, "resources"),
            output: outputPath,
        });

        const result = JSON.parse(readFileSync(outputPath, "utf-8"));
        expect(result.find((d: { name: string }) => d.name === "MissingSource")).toBeUndefined();
        expect(result.find((d: { name: string }) => d.name === "Python")).toBeDefined();
    });
});

describe("checkCoverage", () => {
    let tmpDir: string;
    let feedDir: string;

    beforeAll(() => {
        tmpDir = join(tmpdir(), `test-checkCoverage-${Date.now()}`);
        feedDir = join(tmpDir, "feeds");
        mkdirSync(feedDir, { recursive: true });

        writeFileSync(
            join(feedDir, "Python.xml"),
            `<entry><version>3.11/2</version><other-versions><version><name>3.11</name></version><version><name>3.10</name></version><version><name>2.7</name></version></other-versions></entry>`,
        );
        writeFileSync(join(feedDir, "Ruby.xml"), `<entry><version>3.2/0</version></entry>`);
        writeFileSync(join(feedDir, "Unlisted.xml"), `<entry><version>1.0/0</version></entry>`);
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("warns about feeds not in manifest or blacklist", () => {
        const warnings: string[] = [];
        const orig = console.warn;
        console.warn = (msg: string) => warnings.push(msg);
        try {
            checkCoverage({
                manifest: { Python: { title: "Python", iconName: "python" } },
                blacklist: [],
                feedDir,
            });
            expect(warnings.some((w) => w.includes("Unlisted.xml"))).toBe(true);
            expect(warnings.some((w) => w.includes("Ruby.xml"))).toBe(true);
            expect(warnings.some((w) => w.includes("Python.xml"))).toBe(false);
        } finally {
            console.warn = orig;
        }
    });

    it("does not warn when feed is in blacklist", () => {
        const warnings: string[] = [];
        const orig = console.warn;
        console.warn = (msg: string) => warnings.push(msg);
        try {
            checkCoverage({
                manifest: { Python: { title: "Python", iconName: "python" } },
                blacklist: ["Ruby", "Unlisted"],
                feedDir,
            });
            expect(warnings.some((w) => w.includes("Ruby.xml") || w.includes("Unlisted.xml"))).toBe(false);
        } finally {
            console.warn = orig;
        }
    });

    it("warns about uncovered versions in split feeds", () => {
        const warnings: string[] = [];
        const orig = console.warn;
        console.warn = (msg: string) => warnings.push(msg);
        try {
            checkCoverage({
                manifest: {
                    Python_3: { title: "Python 3", iconName: "python", source: "Python", versionPrefix: "3." },
                    Ruby: { title: "Ruby", iconName: "ruby" },
                    Unlisted: { title: "Unlisted", iconName: "unlisted" },
                },
                feedDir,
            });
            const versionWarning = warnings.find((w) => w.includes("Python.xml") && w.includes("uncovered versions"));
            expect(versionWarning).toBeDefined();
            expect(versionWarning).toContain("2.7");
        } finally {
            console.warn = orig;
        }
    });

    it("does not warn when all versions are covered", () => {
        const warnings: string[] = [];
        const orig = console.warn;
        console.warn = (msg: string) => warnings.push(msg);
        try {
            checkCoverage({
                manifest: {
                    Python_2: { title: "Python 2", iconName: "python", source: "Python", versionPrefix: "2." },
                    Python_3: { title: "Python 3", iconName: "python", source: "Python", versionPrefix: "3." },
                    Ruby: { title: "Ruby", iconName: "ruby" },
                    Unlisted: { title: "Unlisted", iconName: "unlisted" },
                },
                feedDir,
            });
            expect(warnings.some((w) => w.includes("uncovered versions"))).toBe(false);
        } finally {
            console.warn = orig;
        }
    });
});
