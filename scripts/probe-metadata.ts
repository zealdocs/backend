import { defaultMirror } from "../src/geo";
import {
    dashFeedName,
    dashArchiveUrl,
    contribArchiveUrl,
    cheatsheetArchiveUrl,
    tarixUrl,
    type DocsetManifest,
} from "../src/mirror-url";
import { sourceHasTarix } from "../src/sources";
import { entryKey, type CatalogDiff, type DiffableEntry } from "./catalog-diff";

export type EnrichableEntry = {
    name: string;
    sourceId: string;
    versions?: string[];
    archive?: string;
    size?: number;
    tarix?: boolean;
};

/** Mirror URL of the archive a `/d/<source>/<name>/latest` request resolves to. */
export function archiveUrl(entry: EnrichableEntry, mirror: string, manifest: DocsetManifest): string | null {
    switch (entry.sourceId) {
        case "com.kapeli.dash": {
            const feedName = dashFeedName(entry.name, manifest);
            return feedName ? dashArchiveUrl(feedName, entry.versions?.[0], mirror) : null;
        }
        case "com.kapeli.contrib":
            return entry.archive ? contribArchiveUrl(entry.name, entry.archive, mirror) : null;
        case "com.kapeli.cheatsheet":
            return cheatsheetArchiveUrl(entry.name, mirror);
        default:
            return null;
    }
}

/**
 * Result of a HEAD probe:
 * - `ok`     — a direct 200; `size` is the Content-Length (null if unreadable).
 * - `absent` — a definitive 3xx/4xx (the mirror 302-redirects missing files).
 * - `error`  — network failure or transient 5xx after retries; outcome unknown.
 *
 * The absent/error split matters: `absent` is a real "no such file" answer we
 * can record, while `error` must leave the field unset so the next build
 * re-probes instead of baking in a wrong value.
 */
type HeadResult = { kind: "ok"; size: number | null } | { kind: "absent" } | { kind: "error" };

/**
 * HEAD a URL with retry on transient failures. Identity encoding is requested
 * so text files (the tarix index) report their real size instead of a
 * compressed transfer length.
 */
async function head(url: string, timeoutMs: number, retries = 2): Promise<HeadResult> {
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await fetch(url, {
                method: "HEAD",
                redirect: "manual",
                headers: { "Accept-Encoding": "identity" },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (res.status === 200) {
                const len = res.headers.get("content-length");
                const n = len ? Number.parseInt(len, 10) : Number.NaN;
                return { kind: "ok", size: Number.isFinite(n) ? n : null };
            }
            // 5xx and transient client statuses (timeout / too-early / rate-limit)
            // are retried; any other 3xx/4xx is a definitive "not here".
            const transient = res.status >= 500 || res.status === 408 || res.status === 425 || res.status === 429;
            if (!transient) return { kind: "absent" };
        } catch {
            // Network error / timeout: retry.
        }
        if (attempt >= retries) return { kind: "error" };
        await Bun.sleep(500);
    }
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            await fn(items[next++]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Populate `size` (download bytes; archive + tarix index when present) and
 * `tarix` on each entry. Entries unchanged since the baseline reuse its
 * metadata; the rest are probed with HEAD requests. Probe failures leave the
 * fields unset so "unknown" stays distinct from a real value.
 */
export async function enrichMetadata(options: {
    entries: EnrichableEntry[];
    diff: CatalogDiff;
    baseline: DiffableEntry[];
    manifest: DocsetManifest;
    mirror?: string;
    concurrency?: number;
    timeoutMs?: number;
}): Promise<{ reused: number; probed: number; failed: number; skipped: number }> {
    const { entries, diff, baseline, manifest, mirror = defaultMirror, concurrency = 16, timeoutMs = 10_000 } = options;

    const reusable = new Set(diff.unchanged);
    const baseMeta = new Map(baseline.map((b) => [entryKey(b), b]));

    const toProbe: EnrichableEntry[] = [];
    let reused = 0;
    for (const entry of entries) {
        const base = reusable.has(entryKey(entry)) ? baseMeta.get(entryKey(entry)) : undefined;
        if (base && base.size !== undefined && base.tarix !== undefined) {
            entry.size = base.size;
            entry.tarix = base.tarix;
            reused++;
        } else {
            toProbe.push(entry);
        }
    }

    let probed = 0;
    let failed = 0;
    let skipped = 0;
    await runPool(toProbe, concurrency, async (entry) => {
        try {
            const url = archiveUrl(entry, mirror, manifest);
            if (url === null) {
                skipped++;
                return;
            }
            const archive = await head(url, timeoutMs);
            if (archive.kind !== "ok" || archive.size === null) {
                failed++;
                return;
            }

            // Sources known to lack tarix indices: record false without a probe.
            if (!sourceHasTarix(entry.sourceId)) {
                entry.size = archive.size;
                entry.tarix = false;
                probed++;
                return;
            }

            const tarix = await head(tarixUrl(url), timeoutMs);
            if (tarix.kind === "error") {
                // Unknown tarix state: leave unset so the next build re-probes.
                failed++;
                return;
            }
            entry.size = archive.size + (tarix.kind === "ok" ? (tarix.size ?? 0) : 0);
            entry.tarix = tarix.kind === "ok";
            probed++;
        } catch {
            failed++;
        }
    });

    return { reused, probed, failed, skipped };
}
