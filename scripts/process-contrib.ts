import { join } from "node:path";
import { fetchWithRetry } from "./fetch-retry";
import { readIcon } from "./png-utils";

export type ContribDocsetInfo = {
    name: string;
    title: string;
    sourceId: "com.kapeli.contrib";
    revision: string;
    versions: string[];
    icon: string;
    icon2x: string;
    archive: string;
    specificVersions: Record<string, string>;
};

type ContribApiEntry = {
    name: string;
    archive: string;
    icon?: string;
    "icon@2x"?: string;
    version: string;
    specific_versions?: Array<{ version: string; archive: string }>;
};

type ContribApiResponse = {
    docsets: Record<string, ContribApiEntry>;
};

export async function processContrib(options: { resourceDir: string }): Promise<ContribDocsetInfo[]> {
    const { resourceDir } = options;
    const iconDir = join(resourceDir, "docset_icons");
    let fallbackIcon = "";
    let fallbackIcon2x = "";
    try {
        fallbackIcon = readIcon(join(iconDir, "Other.png"));
        fallbackIcon2x = readIcon(join(iconDir, "Other@2x.png"));
    } catch (err) {
        console.warn(`[warn] Could not read contrib fallback icon: ${err}`);
    }

    const response = await fetchWithRetry("https://kapeli.com/feeds/zzz/user_contributed/build/index.json");
    if (!response.ok) {
        throw new Error(`Failed to fetch contrib index: ${response.status} ${response.statusText}`);
    }
    const raw = await response.json();
    if (typeof raw !== "object" || raw === null || typeof (raw as Record<string, unknown>).docsets !== "object") {
        throw new Error("Contrib API response has unexpected shape");
    }
    const data = raw as ContribApiResponse;

    const entries: ContribDocsetInfo[] = [];

    for (const [key, docset] of Object.entries(data.docsets)) {
        const specificVersions: Record<string, string> = {};
        const versions: string[] = [];

        if (docset.specific_versions?.length) {
            for (const sv of docset.specific_versions) {
                specificVersions[sv.version] = sv.archive;
                versions.push(sv.version);
            }
        }

        if (!versions.includes(docset.version) && docset.version) {
            versions.unshift(docset.version);
        }

        entries.push({
            name: key,
            title: docset.name,
            sourceId: "com.kapeli.contrib",
            revision: "0",
            versions,
            icon: docset.icon ?? fallbackIcon,
            icon2x: docset["icon@2x"] ?? docset.icon ?? fallbackIcon2x,
            archive: docset.archive,
            specificVersions,
        });
    }

    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return entries;
}
