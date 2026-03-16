import { Elysia } from "elysia";
import { geolocation } from "@vercel/functions";

import { getMirror } from "./geo";
import { linkMap } from "./links";
import docsets from "../docsets.json";

async function serveJsonFile(path: string): Promise<Response> {
    const file = Bun.file(new URL(path, import.meta.url));
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
}

const app = new Elysia()
    .get("/", ({ redirect }) => redirect("https://zealdocs.org", 302))
    .get("/v1/releases", () => serveJsonFile("../public/_api/v1/releases.json"))
    .get("/v1/docsets", () => serveJsonFile("../public/_api/v1/docsets.json"))
    .get("/l/:linkId", ({ params: { linkId }, redirect, set }) => {
        const url = linkMap[linkId];
        if (!url) {
            set.status = 404;
            return "Not found";
        }
        return redirect(url, 302);
    })
    .get("/d/:sourceId/:docsetId/latest", ({ params, request, redirect, set }) => {
        let { sourceId, docsetId } = params;

        // Workaround for C++ docset URL bug (https://github.com/zealdocs/zeal/issues/1537).
        if (new URL(request.url).pathname.endsWith("/d/com.kapeli/C++/latest")) {
            docsetId = "C++";
        }

        if (sourceId !== "com.kapeli" || !Object.hasOwn(docsets, docsetId)) {
            set.status = 404;
            return "Not found";
        }

        const mirror = getMirror(geolocation(request).region);
        return redirect(`https://${mirror}/feeds/${docsetId}.tgz`, 302);
    });

if (import.meta.main) {
    app.listen(3000);
}

export default app;
