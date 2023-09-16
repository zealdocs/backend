import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// TODO: Use `edge` once https://github.com/vercel/next.js/issues/48295 is fixed.
export const runtime = "nodejs";

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

export function GET(request: NextRequest, { params }: { params: { linkId: string } }) {
    // const linkId = request.nextUrl.searchParams.get("linkId")!;

    const url = linkMap[params.linkId];
    if (url === undefined) {
        return new NextResponse("Not found", { status: 404 });
    }

    return NextResponse.redirect(url);
}
