import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "edge"; // 'nodejs' is the default

type LinkMap = {
    [id: string]: string;
};

const linkMap: LinkMap = {
    contact: "https://zealdocs.org/contact.html",
    download: "https://zealdocs.org/download.html",

    github: "https://github.com/zealdocs/zeal",
    gitter: "https://gitter.im/zealdocs/zeal",
    twitter: "https://twitter.com/zealdocs",

    "report-bug": "https://github.com/zealdocs/zeal/issues",

    dash: "https://kapeli.com/dash",
};

export function GET(request: NextRequest) {
    const linkId = request.nextUrl.searchParams.get("linkId")!;
    const url = linkMap[linkId];
    console.log(linkId, url);
    if (url === undefined) {
        return new NextResponse("Not found", { status: 404 });
        // notFound();
    }

    return NextResponse.redirect(url);
}
