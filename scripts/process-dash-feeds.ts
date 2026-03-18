import { parseArgs } from "node:util";
import { join } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
    source?: string;
    versionPrefix?: string;
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

function parseVersionList(entry: Record<string, unknown>): {
    version: string;
    revision: string;
    allVersions: string[];
} {
    const versionStr = String(entry.version ?? "");
    const versionParts = versionStr.split("/");
    const version = versionParts[0];
    const revision = versionParts.length === 2 ? versionParts[1] : "0";

    const otherVersions = entry["other-versions"] as { version?: Array<{ name: unknown }> } | undefined;
    let allVersions: string[] = [];
    if (otherVersions?.version) {
        // Parser is configured with isArray to always return an array here
        allVersions = otherVersions.version.map((v) => String(v.name));
    }

    if (!allVersions.length) {
        allVersions = version ? [version] : [];
    } else if (version && !allVersions.includes(version)) {
        allVersions.unshift(version);
    }

    return { version, revision, allVersions };
}

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

    // Build reverse map: feedBaseName → manifest entries
    const feedEntries = new Map<string, Array<[string, ManifestEntry]>>();
    for (const [entryName, feedManifest] of Object.entries(manifest)) {
        const feedBaseName = feedManifest.source ?? entryName;
        let list = feedEntries.get(feedBaseName);
        if (!list) {
            list = [];
            feedEntries.set(feedBaseName, list);
        }
        list.push([entryName, feedManifest]);
    }

    const docsetList: DocsetInfo[] = [];

    const feedFiles = readdirSync(feedDir).filter((f) => f.endsWith(".xml"));

    for (const feedFile of feedFiles) {
        const feedBaseName = feedFile.replace(".xml", "");

        if (blacklist.includes(feedBaseName)) {
            console.log(`\nSkipping ${feedFile} (blacklisted).`);
            continue;
        }

        const entries = feedEntries.get(feedBaseName);
        if (!entries) {
            console.warn(`\nWarning: ${feedFile} is not covered by manifest or blacklist`);
            continue;
        }

        console.log(`\nProcessing ${feedFile}...`);

        let parsed: ReturnType<typeof parser.parse>;
        try {
            parsed = parser.parse(readFileSync(join(feedDir, feedFile), "utf-8"));
        } catch (e) {
            const affected = entries.map(([name]) => name).join(", ");
            console.error(`  ! Failed to parse ${feedFile}: ${e}`);
            console.error(`  ! Skipping: ${affected}`);
            continue;
        }

        const rootKey = Object.keys(parsed)[0];
        if (!rootKey) {
            const affected = entries.map(([name]) => name).join(", ");
            console.error(`  ! Empty or invalid XML structure in ${feedFile}`);
            console.error(`  ! Skipping: ${affected}`);
            continue;
        }
        const { revision, allVersions } = parseVersionList(parsed[rootKey]);

        // Warn about uncovered versions in split feeds
        const splitEntries = entries.filter(([, m]) => m.versionPrefix);
        if (splitEntries.length) {
            const coveredVersions = new Set(
                splitEntries.flatMap(([, { versionPrefix }]) =>
                    versionPrefix ? allVersions.filter((v) => v.startsWith(versionPrefix)) : [],
                ),
            );
            const uncovered = allVersions.filter((v) => !coveredVersions.has(v));
            if (uncovered.length) {
                console.warn(`\nWarning: ${feedFile} has uncovered versions: ${uncovered.join(", ")}`);
            }
        }

        for (const [entryName, feedManifest] of entries) {
            const { versionPrefix } = feedManifest;
            const versionList = versionPrefix ? allVersions.filter((v) => v.startsWith(versionPrefix)) : allVersions;

            console.log(
                `  -> ${entryName}: ${versionList.length ? versionList.join(", ") : "<none>"} (rev ${revision})`,
            );

            const docsetInfo: DocsetInfo = {
                name: entryName,
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

    if (!values["resource-dir"] || positionals.length < 2) {
        console.error(
            "Usage: process-dash-feeds.ts --resource-dir=<dir> [--manifest=<file>] [--blacklist=<file>] <feed_dir> <output>",
        );
        process.exit(1);
    }

    const [feedDir, output] = positionals;
    const manifest = JSON.parse(await Bun.file(values.manifest ?? "docsets.json").text());
    const blacklistFile = Bun.file(values.blacklist ?? "blacklist.json");
    const blacklist = (await blacklistFile.exists()) ? JSON.parse(await blacklistFile.text()) : [];

    await processFeeds({
        manifest,
        blacklist,
        resourceDir: values["resource-dir"],
        feedDir,
        output,
    });
}
