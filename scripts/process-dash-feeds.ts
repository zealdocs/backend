import { parseArgs } from "node:util";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const SOURCE_ID = "com.kapeli.dash";

const PNG_CHUNK_WHITELIST = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readIcon(filename: string): string {
    if (!existsSync(filename)) {
        throw new Error(`Cannot find file: ${filename}`);
    }

    const data = readFileSync(filename);

    if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error(`Not a valid PNG file: ${filename}`);
    }

    const chunks: Buffer[] = [PNG_SIGNATURE];
    let offset = 8;

    while (offset < data.length) {
        if (offset + 12 > data.length) break;
        const length = data.readUInt32BE(offset);
        const type = data.subarray(offset + 4, offset + 8).toString("ascii");
        const chunkTotal = 12 + length;

        if (PNG_CHUNK_WHITELIST.has(type)) {
            chunks.push(data.subarray(offset, offset + chunkTotal));
        }

        offset += chunkTotal;
    }

    return Buffer.concat(chunks).toString("base64");
}

type ManifestEntry = {
    title: string;
    iconName: string;
    extra?: Record<string, unknown>;
};

type DocsetInfo = {
    name: string;
    title: string;
    sourceId: string;
    revision: string;
    versions: string[];
    icon: string;
    icon2x: string;
    extra?: Record<string, unknown>;
};

export async function processFeeds(options: {
    manifest: Record<string, ManifestEntry>;
    blacklist?: string[];
    resourceDir: string;
    feedDir: string;
    output: string;
}): Promise<void> {
    const { manifest, blacklist = [], resourceDir, feedDir, output } = options;
    const iconDir = join(resourceDir, "docset_icons");

    const parser = new XMLParser({
        parseTagValue: false,
        isArray: (_tagName, jPath) => jPath.endsWith(".other-versions.version"),
    });

    const docsetList: DocsetInfo[] = [];

    const glob = new Bun.Glob("*.xml");
    const feedFiles = Array.from(glob.scanSync(feedDir)).sort();

    for (const feedFile of feedFiles) {
        const feedName = feedFile.replace(/\.xml$/, "");
        console.log(`\nProcessing ${feedFile}...`);

        if (blacklist.includes(feedName)) {
            console.log(`  ! ${feedName} is blacklisted.`);
            continue;
        }

        if (!Object.hasOwn(manifest, feedName)) {
            console.log(`  ! ${feedName} is NOT in manifest.`);
            continue;
        }

        let parsed: ReturnType<typeof parser.parse>;
        try {
            parsed = parser.parse(readFileSync(join(feedDir, feedFile), "utf-8"));
        } catch (e) {
            console.error(`  ! Failed to parse XML: ${e}`);
            continue;
        }
        const rootKey = Object.keys(parsed)[0];
        const entry = parsed[rootKey];

        const versionStr = String(entry.version ?? "");
        const versionParts = versionStr.split("/");
        let version = versionParts[0];
        const revision = versionParts.length === 2 ? versionParts[1] : "0";

        const otherVersions = entry["other-versions"];
        let versionList: string[] = [];
        if (otherVersions?.version) {
            const versions = Array.isArray(otherVersions.version) ? otherVersions.version : [otherVersions.version];
            versionList = versions.map((v: { name: unknown }) => String(v.name));
        }

        if (!versionList.length && version) {
            if (version.startsWith(".")) {
                version = (feedName.split("_").at(-1) ?? feedName) + version;
            }
            versionList = [version];
        }

        console.log(`  -> Versions: ${versionList.length ? versionList.join(", ") : "<none>"}`);
        console.log(`  -> Revision: ${revision}`);

        const feedManifest = manifest[feedName];

        const docsetInfo: DocsetInfo = {
            name: feedName,
            title: feedManifest.title,
            sourceId: SOURCE_ID,
            revision,
            versions: versionList,
            icon: readIcon(join(iconDir, `${feedManifest.iconName}.png`)),
            icon2x: readIcon(join(iconDir, `${feedManifest.iconName}@2x.png`)),
        };

        if (feedManifest.extra) {
            docsetInfo.extra = feedManifest.extra;
        }

        docsetList.push(docsetInfo);
    }

    if (!docsetList.length) {
        console.warn("Warning: No docsets were processed.");
        return;
    }

    docsetList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    await Bun.write(output, `${JSON.stringify(docsetList, null, 2)}\n`);
}

if (import.meta.main) {
    const { values, positionals } = parseArgs({
        args: Bun.argv.slice(2),
        options: {
            manifest: { type: "string", default: "docsets.json" },
            blacklist: { type: "string", default: "blacklist.json" },
            "resource-dir": { type: "string" },
        },
        allowPositionals: true,
    });

    const [feedDir, output] = positionals;

    if (!values["resource-dir"] || !feedDir || !output) {
        console.error(
            "Usage: process-dash-feeds.ts --resource-dir=<dir> [--manifest=<file>] [--blacklist=<file>] <feed_dir> <output>",
        );
        process.exit(1);
    }

    const manifest = JSON.parse(await Bun.file(values.manifest ?? "docsets.json").text());
    const blacklistFile = Bun.file(values.blacklist ?? "blacklist.json");
    const blacklist = (await blacklistFile.exists()) ? JSON.parse(await blacklistFile.text()) : [];

    await processFeeds({
        manifest,
        blacklist,
        resourceDir: values["resource-dir"] as string,
        feedDir,
        output,
    });
}
