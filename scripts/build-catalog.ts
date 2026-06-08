import { parseArgs } from "node:util";
import { processFeeds } from "./process-dash-feeds";
import { processContrib } from "./process-contrib";
import { processCheatsheets } from "./process-cheatsheets";
import { fetchReleases } from "./fetch-releases";
import { diffCatalog, fetchBaseline, type DiffableEntry } from "./catalog-diff";
import { enrichMetadata } from "./probe-metadata";

const DEFAULT_BASELINE_URL = "https://api.zealdocs.org/_api/v1/catalog.json";

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        manifest: { type: "string", default: "docsets.json" },
        blacklist: { type: "string", default: "blacklist.json" },
        "resource-dir": { type: "string" },
        "feed-dir": { type: "string" },
        // Previously-deployed catalog used as a diff baseline. Pass "" to skip.
        baseline: { type: "string", default: DEFAULT_BASELINE_URL },
    },
    allowPositionals: false,
});

const resourceDir = values["resource-dir"];
const feedDir = values["feed-dir"];

if (!resourceDir || !feedDir) {
    console.error(
        "Usage: build-catalog.ts --resource-dir=<dir> --feed-dir=<dir> [--manifest=<file>] [--blacklist=<file>]",
    );
    process.exit(1);
}

const manifest = JSON.parse(await Bun.file(values.manifest ?? "docsets.json").text());
const blacklistFile = Bun.file(values.blacklist ?? "blacklist.json");
const blacklist = (await blacklistFile.exists()) ? JSON.parse(await blacklistFile.text()) : [];

console.log("Processing official Dash feeds...");
const officialEntries = await processFeeds({ manifest, blacklist, resourceDir, feedDir });

console.log("\nProcessing user-contributed docsets...");
const contribEntries = await processContrib({ resourceDir });
console.log(`  ${contribEntries.length} contrib docsets fetched.`);

console.log("\nProcessing cheatsheets...");
const cheatsheetEntries = await processCheatsheets({ resourceDir });
console.log(`  ${cheatsheetEntries.length} cheatsheets fetched.`);

// Full catalog (3 individual sources flat-merged). These objects are enriched
// in place below, before the legacy catalog copies them, so both outputs carry
// the size/tarix metadata.
const catalogEntries = [...officialEntries, ...contribEntries, ...cheatsheetEntries];

// Diff against the previously-deployed catalog so unchanged docsets reuse their
// metadata instead of being re-probed.
let baseline: DiffableEntry[] = [];
if (values.baseline) {
    try {
        baseline = await fetchBaseline(values.baseline);
    } catch (err) {
        console.warn(`\nWarning: baseline unavailable, probing all docsets: ${err}`);
    }
} else {
    console.log("\nBaseline disabled; probing all docsets.");
}

const diff = diffCatalog(catalogEntries, baseline);
console.log(
    `\nCatalog diff: ${diff.unchanged.length} unchanged, ${diff.changed.length} changed, ` +
        `${diff.added.length} added, ${diff.removed.length} removed`,
);
if (diff.changed.length) console.log(`  changed: ${diff.changed.join(", ")}`);
if (diff.added.length) console.log(`  added: ${diff.added.join(", ")}`);
if (diff.removed.length) console.log(`  removed: ${diff.removed.join(", ")}`);

console.log("\nProbing download sizes and tarix availability...");
let meta = { reused: 0, probed: 0, failed: 0, skipped: 0 };
try {
    meta = await enrichMetadata({ entries: catalogEntries, diff, baseline, manifest });
} catch (err) {
    console.warn(`  Warning: metadata probing failed: ${err}`);
}
console.log(
    `  ${meta.reused} reused, ${meta.probed} probed, ${meta.failed} failed` +
        (meta.skipped ? `, ${meta.skipped} skipped` : ""),
);

catalogEntries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

// Legacy merged catalog (official + suffixed contrib + suffixed cheatsheet),
// derived after enrichment so the copies inherit size/tarix.
const legacyEntries = [
    ...officialEntries.map((e) => ({ ...e, sourceId: "com.kapeli" })),
    ...contribEntries.map((e) => ({
        ...e,
        name: `${e.name}_Contrib`,
        title: `${e.title} (user contributed)`,
        sourceId: "com.kapeli",
    })),
    ...cheatsheetEntries.map((e) => ({
        ...e,
        name: `${e.name}_Cheatsheet`,
        title: `${e.title} (cheatsheet)`,
        sourceId: "com.kapeli",
    })),
];
legacyEntries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

console.log("\nFetching Zeal releases from GitHub...");
let releases: Awaited<ReturnType<typeof fetchReleases>> = [];
try {
    releases = await fetchReleases();
    console.log(`  ${releases.length} releases fetched.`);
} catch (err) {
    console.warn(`  Warning: failed to fetch releases: ${err}`);
}

await Promise.all([
    Bun.write("public/_api/v1/docsets.json", `${JSON.stringify(legacyEntries, null, 2)}\n`),
    Bun.write("public/_api/v1/catalog.json", `${JSON.stringify(catalogEntries, null, 2)}\n`),
    Bun.write("public/_api/v1/releases.json", `${JSON.stringify(releases, null, 2)}\n`),
]);

console.log("\nBuild complete!");
console.log(`  docsets.json: ${legacyEntries.length} entries (com.kapeli legacy)`);
console.log(`  catalog.json: ${catalogEntries.length} entries (3 sources combined)`);
console.log(`  releases.json: ${releases.length} releases`);
