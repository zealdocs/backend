import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { readIcon } from "./png-utils";
import { fetchWithRetry } from "./fetch-retry";

export type CheatsheetDocsetInfo = {
    name: string;
    title: string;
    sourceId: "com.kapeli.cheatsheet";
    revision: string;
    versions: string[];
    icon: string;
    icon2x: string;
};

type CheatsheetApiEntry = {
    name: string;
    version: string;
    aliases?: string[];
};

type CheatsheetApiResponse = {
    cheatsheets: Record<string, CheatsheetApiEntry>;
};

export async function processCheatsheets(options: { resourceDir: string }): Promise<CheatsheetDocsetInfo[]> {
    const { resourceDir } = options;
    const iconDir = join(resourceDir, "docset_icons");

    // Build icon lookup maps from official icon dir
    const iconMap = new Map<string, string>(); // lowercase name -> base64
    const icon2xMap = new Map<string, string>(); // lowercase name -> base64
    if (existsSync(iconDir)) {
        for (const file of readdirSync(iconDir)) {
            if (file.endsWith("@2x.png")) {
                const name = file.replace("@2x.png", "").toLowerCase();
                try {
                    icon2xMap.set(name, readIcon(join(iconDir, file)));
                } catch (err) {
                    console.warn(`[warn] Could not read icon ${file}: ${err}`);
                }
            } else if (file.endsWith(".png")) {
                const name = file.replace(".png", "").toLowerCase();
                try {
                    iconMap.set(name, readIcon(join(iconDir, file)));
                } catch (err) {
                    console.warn(`[warn] Could not read icon ${file}: ${err}`);
                }
            }
        }
    }

    // Fallback cheatsheet icon (committed in resources/docset_icons/)
    const fallbackIcon = iconMap.get("cheatsheet") ?? "";
    const fallbackIcon2x = icon2xMap.get("cheatsheet") ?? fallbackIcon;

    const response = await fetchWithRetry("https://kapeli.com/feeds/zzz/cheatsheets/cheat.json");
    if (!response.ok) {
        throw new Error(`Failed to fetch cheatsheets: ${response.status} ${response.statusText}`);
    }
    // cheat.json contains trailing commas — strip them before parsing
    const text = (await response.text()).replace(/,(\s*[}\]])/g, "$1");
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || typeof (raw as Record<string, unknown>).cheatsheets !== "object") {
        throw new Error("Cheatsheets API response has unexpected shape");
    }
    const data = raw as CheatsheetApiResponse;

    const entries: CheatsheetDocsetInfo[] = [];

    for (const [key, sheet] of Object.entries(data.cheatsheets)) {
        const keyLower = key.toLowerCase();
        const icon = iconMap.get(keyLower) ?? fallbackIcon;
        const icon2x = icon2xMap.get(keyLower) ?? fallbackIcon2x;

        entries.push({
            name: key,
            title: sheet.name,
            sourceId: "com.kapeli.cheatsheet",
            revision: "0",
            versions: [sheet.version],
            icon,
            icon2x,
        });
    }

    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return entries;
}
