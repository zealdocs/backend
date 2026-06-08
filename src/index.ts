import { Elysia } from "elysia";
import { geolocation } from "@vercel/functions";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getMirror } from "./geo";
import { dashFeedName, dashArchiveUrl, contribArchiveUrl, cheatsheetArchiveUrl } from "./mirror-url";
import { linkMap } from "./links";
import { track } from "./track";
import docsets from "../docsets.json";
type LegacyEntry = { name: string; versions: string[] };
type FullEntry = {
    name: string;
    sourceId: string;
    versions: string[];
    archive?: string;
    specificVersions?: Record<string, string>;
    bareLatest?: boolean;
};

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../public/_api/v1");

function tryReadJson<T>(filename: string): T[] {
    try {
        return JSON.parse(readFileSync(join(dataDir, filename), "utf-8")) as T[];
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            console.warn(`[warn] ${filename} not found — serving empty catalog`);
            return [];
        }
        throw err;
    }
}

type ReleaseEntry = { version: string; date: string };

export function createApp(
    legacyCatalog: LegacyEntry[] = tryReadJson<LegacyEntry>("docsets.json"),
    fullCatalog: FullEntry[] = tryReadJson<FullEntry>("catalog.json"),
    releases: ReleaseEntry[] = tryReadJson<ReleaseEntry>("releases.json"),
) {
    const legacyFirstVersion = new Map<string, string>(
        legacyCatalog.filter((d) => d.versions.length > 0).map((d) => [d.name, d.versions[0]]),
    );

    const dashFirstVersion = new Map<string, string>(
        fullCatalog
            .filter((d) => d.sourceId === "com.kapeli.dash" && d.versions.length > 0)
            .map((d) => [d.name, d.versions[0]]),
    );

    const contribMap = new Map<string, { archive: string; specificVersions: Record<string, string> }>(
        fullCatalog
            .filter(
                (d): d is FullEntry & { archive: string } =>
                    d.sourceId === "com.kapeli.contrib" && d.archive !== undefined,
            )
            .map((d) => [d.name, { archive: d.archive, specificVersions: d.specificVersions ?? {} }]),
    );

    const cheatsheetKeys = new Set<string>(
        fullCatalog.filter((d) => d.sourceId === "com.kapeli.cheatsheet").map((d) => d.name),
    );

    // Dash docsets whose latest lives at the bare feed path, not a versioned one
    // (the feed advertises a version Kapeli never published a versioned artifact for).
    const dashBareLatest = new Set<string>(
        fullCatalog.filter((d) => d.sourceId === "com.kapeli.dash" && d.bareLatest).map((d) => d.name),
    );

    const manifest = docsets as Record<string, { source?: string }>;

    function buildDashRedirectUrl(
        docsetId: string,
        version: string,
        firstVersion: Map<string, string>,
        mirror: string,
    ): string | null {
        const feedName = dashFeedName(docsetId, manifest);
        if (!feedName) return null;
        const resolvedVersion =
            version === "latest" ? (dashBareLatest.has(docsetId) ? undefined : firstVersion.get(docsetId)) : version;
        return dashArchiveUrl(feedName, resolvedVersion, mirror);
    }

    return (
        new Elysia()
            .get("/", ({ redirect }) => redirect("https://zealdocs.org", 302))
            .get(
                "/robots.txt",
                () =>
                    new Response("User-agent: *\nDisallow: /\n", {
                        headers: { "content-type": "text/plain", "cache-control": "public, max-age=86400" },
                    }),
            )
            .get("/favicon.ico", () => new Response(null, { status: 204 }))
            .get("/v1/releases", ({ request }) => {
                track(request, { event: "releases" });
                return Response.json(releases, { headers: { "Cache-Control": "public, s-maxage=21600" } });
            })
            // Uncached tracked redirect; the payload is edge-cached as a static asset.
            .get("/v1/docsets", ({ request, redirect }) => {
                track(request, { event: "catalog" });
                return redirect("/_api/v1/docsets.json", 302);
            })
            // Dev/test fallback; on Vercel the static file shadows this route.
            .get("/_api/v1/docsets.json", () =>
                Response.json(legacyCatalog, { headers: { "Cache-Control": "public, s-maxage=21600" } }),
            )
            // .get("/v1/catalog", () => Response.json(fullCatalog, { headers: { "Cache-Control": "public, s-maxage=21600" } }))
            .get("/l/:linkId", ({ params: { linkId }, request, redirect, set }) => {
                const url = linkMap[linkId];
                if (!url) {
                    set.status = 404;
                    return "Not found";
                }
                track(request, { event: "link", link_id: linkId });
                return redirect(url, 302);
            })
            .get("/d/:sourceId/:docsetId/:version?", ({ params, request, redirect, set }) => {
                const { sourceId, docsetId } = params;
                const version = params.version ?? "latest";

                if (version !== "latest" && !/^[\w.-]+$/.test(version)) {
                    set.status = 400;
                    return "Invalid version";
                }

                let latitude: string | undefined;
                let longitude: string | undefined;
                try {
                    ({ latitude, longitude } = geolocation(request));
                } catch {
                    // Not on Vercel, or geolocation unavailable — fall back to default mirror.
                }
                const mirror = getMirror(latitude, longitude);

                const trackDownload = (source: string, docset: string) =>
                    track(request, {
                        event: "download",
                        source_id: source,
                        source_id_raw: sourceId,
                        docset_id: docset,
                        version,
                        mirror,
                    });

                if (sourceId === "com.kapeli") {
                    if (docsetId.endsWith("_Cheatsheet")) {
                        const key = docsetId.slice(0, -"_Cheatsheet".length);
                        if (!cheatsheetKeys.has(key)) {
                            set.status = 404;
                            return "Not found";
                        }
                        trackDownload("com.kapeli.cheatsheet", key);
                        return redirect(cheatsheetArchiveUrl(key, mirror), 302);
                    }

                    if (docsetId.endsWith("_Contrib")) {
                        const key = docsetId.slice(0, -"_Contrib".length);
                        const entry = contribMap.get(key);
                        if (!entry) {
                            set.status = 404;
                            return "Not found";
                        }
                        const archive =
                            version !== "latest" && entry.specificVersions[version]
                                ? entry.specificVersions[version]
                                : entry.archive;
                        trackDownload("com.kapeli.contrib", key);
                        return redirect(contribArchiveUrl(key, archive, mirror), 302);
                    }

                    // Official Dash docset
                    const url = buildDashRedirectUrl(docsetId, version, legacyFirstVersion, mirror);
                    if (!url) {
                        set.status = 404;
                        return "Not found";
                    }
                    trackDownload("com.kapeli.dash", docsetId);
                    return redirect(url, 302);
                }

                if (sourceId === "com.kapeli.dash") {
                    const url = buildDashRedirectUrl(docsetId, version, dashFirstVersion, mirror);
                    if (!url) {
                        set.status = 404;
                        return "Not found";
                    }
                    trackDownload("com.kapeli.dash", docsetId);
                    return redirect(url, 302);
                }

                if (sourceId === "com.kapeli.contrib") {
                    const entry = contribMap.get(docsetId);
                    if (!entry) {
                        set.status = 404;
                        return "Not found";
                    }
                    const archive =
                        version !== "latest" && entry.specificVersions[version]
                            ? entry.specificVersions[version]
                            : entry.archive;
                    trackDownload("com.kapeli.contrib", docsetId);
                    return redirect(contribArchiveUrl(docsetId, archive, mirror), 302);
                }

                if (sourceId === "com.kapeli.cheatsheet") {
                    if (!cheatsheetKeys.has(docsetId)) {
                        set.status = 404;
                        return "Not found";
                    }
                    trackDownload("com.kapeli.cheatsheet", docsetId);
                    return redirect(cheatsheetArchiveUrl(docsetId, mirror), 302);
                }

                set.status = 404;
                return "Not found";
            })
    );
}

const app = createApp();

if (import.meta.main) {
    app.listen(3000);
}

export default app;
