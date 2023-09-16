import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { geolocation } from "@vercel/edge";

import docsets from "../../../../../../../docsets.json";

// TODO: Use `edge` once https://github.com/vercel/next.js/issues/48295 is fixed.
export const runtime = "nodejs";

const defaultMirror = "frankfurt.kapeli.com";

type RegionMap = {
    [id: string]: {
        name: string;
        city: string;
        mirror: string;
    };
};

const regionMap: RegionMap = {
    arn1: {
        name: "eu-north-1",
        city: "Stockholm, Sweden",
        mirror: "frankfurt.kapeli.com",
    },
    bom1: {
        name: "ap-south-1",
        city: "Mumbai, India",
        mirror: "tokyo.kapeli.com",
    },
    cdg1: {
        name: "eu-west-3",
        city: "Paris, France",
        mirror: "london.kapeli.com",
    },
    cle1: {
        name: "us-east-2",
        city: "Cleveland, USA",
        mirror: "newyork.kapeli.com",
    },
    cpt1: {
        name: "af-south-1",
        city: "Cape Town, South Africa",
        mirror: "frankfurt.kapeli.com",
    },
    dub1: {
        name: "eu-west-1",
        city: "Dublin, Ireland",
        mirror: "london.kapeli.com",
    },
    fra1: {
        name: "eu-central-1",
        city: "Frankfurt, Germany",
        mirror: "frankfurt.kapeli.com",
    },
    gru1: {
        name: "sa-east-1",
        city: "São Paulo, Brazil",
        mirror: "newyork.kapeli.com",
    },
    hkg1: {
        name: "ap-east-1",
        city: "Hong Kong",
        mirror: "tokyo.kapeli.com",
    },
    hnd1: {
        name: "ap-northeast-1",
        city: "Tokyo, Japan",
        mirror: "tokyo.kapeli.com",
    },
    iad1: {
        name: "us-east-1",
        city: "Washington, D.C., USA",
        mirror: "newyork.kapeli.com",
    },
    icn1: {
        name: "ap-northeast-2",
        city: "Seoul, South Korea",
        mirror: "tokyo.kapeli.com",
    },
    kix1: {
        name: "ap-northeast-3",
        city: "Osaka, Japan",
        mirror: "tokyo.kapeli.com",
    },
    lhr1: {
        name: "eu-west-2",
        city: "London, United Kingdom",
        mirror: "london.kapeli.com",
    },
    pdx1: {
        name: "us-west-2",
        city: "Portland, USA",
        mirror: "sanfrancisco.kapeli.com",
    },
    sfo1: {
        name: "us-west-1",
        city: "San Francisco, USA",
        mirror: "sanfrancisco.kapeli.com",
    },
    sin1: {
        name: "ap-southeast-1",
        city: "Singapore",
        mirror: "tokyo.kapeli.com",
    },
    syd1: {
        name: "ap-southeast-2",
        city: "Sydney, Australia",
        mirror: "tokyo.kapeli.com",
    },
};

export function GET(request: NextRequest, { params }: { params: { sourceId: string, docsetId: string } }) {
    const { sourceId, docsetId } = params;
    if (sourceId != "com.kapeli" || !Object.hasOwn(docsets, docsetId)) {
        return new NextResponse("Not found", { status: 404 });
    }

    const regionCode = geolocation(request).region;
    if (regionCode === undefined) {
        return NextResponse.redirect(`https://${defaultMirror}/feeds/${docsetId}.tgz`);
    }

    const region = regionMap[regionCode];
    if (region === undefined) {
        console.error("Unknown region:", region);
        return NextResponse.redirect(`https://${defaultMirror}/feeds/${docsetId}.tgz`);
    }

    return NextResponse.redirect(`https://${region.mirror}/feeds/${docsetId}.tgz`);
}
