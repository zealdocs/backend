import { parseArgs } from "node:util";
import { processFeeds } from "./process-dash-feeds";
import { processContrib } from "./process-contrib";
import { processCheatsheets } from "./process-cheatsheets";

const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        manifest: { type: "string", default: "docsets.json" },
        blacklist: { type: "string", default: "blacklist.json" },
        "resource-dir": { type: "string" },
        "feed-dir": { type: "string" },
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

// Build com.kapeli legacy merged catalog (official + suffixed contrib + suffixed cheatsheet)
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

// Build full catalog (3 individual sources flat-merged)
const catalogEntries = [...officialEntries, ...contribEntries, ...cheatsheetEntries];
catalogEntries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

await Promise.all([
    Bun.write("public/_api/v1/docsets.json", `${JSON.stringify(legacyEntries, null, 2)}\n`),
    Bun.write("public/_api/v1/catalog.json", `${JSON.stringify(catalogEntries, null, 2)}\n`),
]);

console.log("\nBuild complete!");
console.log(`  docsets.json: ${legacyEntries.length} entries (com.kapeli legacy)`);
console.log(`  catalog.json: ${catalogEntries.length} entries (3 sources combined)`);
