import { Elysia } from "elysia";
import { geolocation } from "@vercel/functions";

import { getMirror } from "./geo";
import { linkMap } from "./links";
import docsets from "../docsets.json";
import releasesData from "../public/_api/v1/releases.json";
import docsetsData from "../public/_api/v1/docsets.json";

type CatalogEntry = { name: string; versions: string[] };

export function createApp(catalog: CatalogEntry[] = docsetsData as CatalogEntry[]) {
    const catalogFirstVersion = new Map<string, string>(
        catalog.filter((d) => d.versions.length > 0).map((d) => [d.name, d.versions[0]]),
    );

    return new Elysia()
        .get("/", ({ redirect }) => redirect("https://zealdocs.org", 302))
        .get("/v1/releases", () =>
            Response.json(releasesData, { headers: { "Cache-Control": "public, s-maxage=3600" } }),
        )
        .get("/v1/docsets", () => Response.json(catalog, { headers: { "Cache-Control": "public, s-maxage=3600" } }))
        .get("/l/:linkId", ({ params: { linkId }, redirect, set }) => {
            const url = linkMap[linkId];
            if (!url) {
                set.status = 404;
                return "Not found";
            }
            return redirect(url, 302);
        })
        .get("/d/:sourceId/:docsetId/:version", ({ params, request, redirect, set }) => {
            const { sourceId, docsetId, version } = params;

            if (sourceId !== "com.kapeli" || !Object.hasOwn(docsets, docsetId)) {
                set.status = 404;
                return "Not found";
            }

            const { latitude, longitude } = geolocation(request);
            const mirror = getMirror(latitude, longitude);

            const resolvedVersion = version === "latest" ? catalogFirstVersion.get(docsetId) : version;
            const url = resolvedVersion
                ? `https://${mirror}/feeds/zzz/versions/${docsetId}/${resolvedVersion}/${docsetId}.tgz`
                : `https://${mirror}/feeds/${docsetId}.tgz`;
            return redirect(url, 302);
        });
}

if (import.meta.main) {
    createApp().listen(3000);
}

export default createApp();
