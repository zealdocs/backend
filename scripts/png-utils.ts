import { readFileSync, existsSync } from "node:fs";

const PNG_CHUNK_WHITELIST = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readIcon(filename: string): string {
    if (!existsSync(filename)) {
        throw new Error(`Cannot find file: ${filename}`);
    }

    const data = readFileSync(filename);

    if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error(`Not a valid PNG file: ${filename}`);
    }

    const chunks: Buffer[] = [PNG_SIGNATURE];
    let offset = 8;

    while (offset < data.length) {
        if (offset + 12 > data.length) break;
        const length = data.readUInt32BE(offset);
        const type = data.subarray(offset + 4, offset + 8).toString("ascii");
        const chunkTotal = 12 + length;
        if (offset + chunkTotal > data.length) break;

        if (PNG_CHUNK_WHITELIST.has(type)) {
            chunks.push(data.subarray(offset, offset + chunkTotal));
        }

        offset += chunkTotal;
    }

    return Buffer.concat(chunks).toString("base64");
}
