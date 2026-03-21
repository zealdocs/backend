import { parseArgs } from "node:util";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { readIcon } from "./png-utils";

const SOURCE_ID = "com.kapeli.dash";

type ManifestEntry = {
    title: string;
    iconName: string;
    source?: string;
    versionPrefix?: string;
    extra?: Record<string, unknown>;
};

export type DocsetInfo = {
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
}): Promise<DocsetInfo[]> {
    const { manifest, blacklist = [], resourceDir, feedDir } = options;
    const iconDir = join(resourceDir, "docset_icons");

    const parser = new XMLParser({
        parseTagValue: false,
        processEntities: false,
        isArray: (_tagName: string, jPath: unknown) =>
            typeof jPath === "string" && jPath.endsWith(".other-versions.version"),
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
        return docsetList;
    }

    docsetList.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return docsetList;
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

    const entries = await processFeeds({
        manifest,
        blacklist,
        resourceDir: values["resource-dir"] as string,
        feedDir,
    });
    if (entries.length) {
        await Bun.write(output, `${JSON.stringify(entries, null, 2)}\n`);
    }
}
