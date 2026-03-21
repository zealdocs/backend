import { Elysia } from "elysia";
import { geolocation } from "@vercel/functions";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { getMirror } from "./geo";
import { linkMap } from "./links";
import docsets from "../docsets.json";
type LegacyEntry = { name: string; versions: string[] };
type FullEntry = {
    name: string;
    sourceId: string;
    versions: string[];
    archive?: string;
    specificVersions?: Record<string, string>;
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

    const manifest = docsets as Record<string, { source?: string }>;

    function buildDashRedirectUrl(
        docsetId: string,
        version: string,
        firstVersion: Map<string, string>,
        mirror: string,
    ): string | null {
        if (!Object.hasOwn(manifest, docsetId)) return null;
        const feedName = manifest[docsetId].source ?? docsetId;
        const resolvedVersion = version === "latest" ? firstVersion.get(docsetId) : version;
        return resolvedVersion
            ? `https://${mirror}/feeds/zzz/versions/${feedName}/${resolvedVersion}/${feedName}.tgz`
            : `https://${mirror}/feeds/${feedName}.tgz`;
    }

    return (
        new Elysia()
            .get("/", ({ redirect }) => redirect("https://zealdocs.org", 302))
            .get("/v1/releases", () =>
                Response.json(releases, { headers: { "Cache-Control": "public, s-maxage=3600" } }),
            )
            .get("/v1/docsets", () =>
                Response.json(legacyCatalog, { headers: { "Cache-Control": "public, s-maxage=3600" } }),
            )
            // .get("/v1/catalog", () => Response.json(fullCatalog, { headers: { "Cache-Control": "public, s-maxage=3600" } }))
            .get("/l/:linkId", ({ params: { linkId }, redirect, set }) => {
                const url = linkMap[linkId];
                if (!url) {
                    set.status = 404;
                    return "Not found";
                }
                return redirect(url, 302);
            })
            .get("/d/:sourceId/:docsetId/:version?", ({ params, request, redirect, set }) => {
                const { sourceId, docsetId } = params;
                const version = params.version ?? "latest";

                if (version !== "latest" && !/^[\w.-]+$/.test(version)) {
                    set.status = 400;
                    return "Invalid version";
                }

                const { latitude, longitude } = geolocation(request);
                const mirror = getMirror(latitude, longitude);

                if (sourceId === "com.kapeli") {
                    if (docsetId.endsWith("_Cheatsheet")) {
                        const key = docsetId.slice(0, -"_Cheatsheet".length);
                        if (!cheatsheetKeys.has(key)) {
                            set.status = 404;
                            return "Not found";
                        }
                        return redirect(`https://${mirror}/feeds/zzz/cheatsheets/${key}.tgz`, 302);
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
                        return redirect(`https://${mirror}/feeds/zzz/user_contributed/build/${key}/${archive}`, 302);
                    }

                    // Official Dash docset
                    const url = buildDashRedirectUrl(docsetId, version, legacyFirstVersion, mirror);
                    if (!url) {
                        set.status = 404;
                        return "Not found";
                    }
                    return redirect(url, 302);
                }

                if (sourceId === "com.kapeli.dash") {
                    const url = buildDashRedirectUrl(docsetId, version, dashFirstVersion, mirror);
                    if (!url) {
                        set.status = 404;
                        return "Not found";
                    }
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
                    return redirect(`https://${mirror}/feeds/zzz/user_contributed/build/${docsetId}/${archive}`, 302);
                }

                if (sourceId === "com.kapeli.cheatsheet") {
                    if (!cheatsheetKeys.has(docsetId)) {
                        set.status = 404;
                        return "Not found";
                    }
                    return redirect(`https://${mirror}/feeds/zzz/cheatsheets/${docsetId}.tgz`, 302);
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
