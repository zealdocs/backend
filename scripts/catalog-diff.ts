import { fetchWithRetry } from "./fetch-retry";

/**
 * Minimal shape needed to diff a docset entry. Both freshly-built entries and
 * baseline entries parsed from the live catalog.json satisfy this.
 */
export type DiffableEntry = {
    name: string;
    sourceId: string;
    revision?: string;
    versions?: string[];
    archive?: string;
    specificVersions?: Record<string, string>;
    size?: number;
    tarix?: boolean;
    bareLatest?: boolean;
};

export function entryKey(e: { sourceId: string; name: string }): string {
    return `${e.sourceId}/${e.name}`;
}

/**
 * A fingerprint derived from each source's version/revision signal, used to
 * detect which docsets changed between builds. It catches version/revision
 * changes but not a tarball repacked in place under an unchanged version, so
 * metadata reused on a fingerprint match (e.g. size) is best-effort, not exact.
 */
export function fingerprint(e: DiffableEntry): string {
    const versions = (Array.isArray(e.versions) ? e.versions : []).join(",");
    switch (e.sourceId) {
        case "com.kapeli.dash":
            return `${e.revision ?? "0"}|${versions}`;
        case "com.kapeli.contrib": {
            const specific = Object.entries(e.specificVersions ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([version, archivePath]) => `${version}:${archivePath}`)
                .join(",");
            return `${versions}|${e.archive ?? ""}|${specific}`;
        }
        case "com.kapeli.cheatsheet":
            // Cheatsheet download URLs are unversioned; version is the only signal.
            return versions;
        default:
            // Unknown source: fold in every field so any change is caught.
            return `${e.revision ?? "0"}|${versions}|${e.archive ?? ""}`;
    }
}

// Values are entryKey() strings; added/removed are relative to the baseline.
export type CatalogDiff = {
    unchanged: string[];
    changed: string[];
    added: string[];
    removed: string[];
};

export function diffCatalog(current: DiffableEntry[], baseline: DiffableEntry[]): CatalogDiff {
    const baseMap = new Map(baseline.map((e) => [entryKey(e), e]));
    const currentKeys = new Set<string>();
    const diff: CatalogDiff = { unchanged: [], changed: [], added: [], removed: [] };

    for (const entry of current) {
        const key = entryKey(entry);
        currentKeys.add(key);
        const base = baseMap.get(key);
        if (!base) {
            diff.added.push(key);
        } else if (fingerprint(entry) === fingerprint(base)) {
            diff.unchanged.push(key);
        } else {
            diff.changed.push(key);
        }
    }

    for (const key of baseMap.keys()) {
        if (!currentKeys.has(key)) diff.removed.push(key);
    }

    return diff;
}

/** Fetch and parse the previously-deployed catalog as a diff baseline. */
export async function fetchBaseline(url: string): Promise<DiffableEntry[]> {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    if (!Array.isArray(data)) {
        throw new Error("Baseline catalog is not a JSON array");
    }
    return (data as DiffableEntry[]).flatMap((e) => {
        if (!e || typeof e.name !== "string" || typeof e.sourceId !== "string") return [];
        // `size`/`tarix`/`bareLatest` are reused verbatim into output, so reject bad types.
        return [
            {
                ...e,
                size: typeof e.size === "number" && Number.isFinite(e.size) && e.size >= 0 ? e.size : undefined,
                tarix: typeof e.tarix === "boolean" ? e.tarix : undefined,
                bareLatest: typeof e.bareLatest === "boolean" ? e.bareLatest : undefined,
            },
        ];
    });
}
