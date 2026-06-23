import { geolocation, waitUntil } from "@vercel/functions";

const TINYBIRD_URL = process.env.TINYBIRD_URL ?? "https://api.us-east.aws.tinybird.co/v0/events";
const TINYBIRD_DATASOURCE = process.env.TINYBIRD_DATASOURCE ?? "events";
const TINYBIRD_TIMEOUT_MS = 1000;

// Read at call time, not import time, so the token isn't frozen before the
// runtime env is populated (and so tests can toggle tracking per-case).
const tinybirdToken = (): string | undefined => process.env.TINYBIRD_TOKEN;

// Micro-batch events into one POST so Tinybird's Gatherer writes fewer, larger
// parts. One single-row POST per event creates one part each; at our trickle of
// a few events per second that floods the datasource with tiny parts and trips
// the plan's accumulated-inserts limit during bursts (e.g. the daily catalog
// sweep). Buffering coalesces events that share a warm instance into a single
// insert. Tunable without a code change via env; defaults keep the flush window
// invisible (track is fire-and-forget, so the delay never touches a response).
const BATCH_MAX = Number(process.env.TINYBIRD_BATCH_MAX ?? 20);
const BATCH_DELAY_MS = Number(process.env.TINYBIRD_BATCH_DELAY_MS ?? 1000);

export type EventName = "download" | "catalog" | "releases" | "link";

export type EventBase = {
    event: EventName;
    source_id?: string;
    source_id_raw?: string;
    docset_id?: string;
    version?: string;
    link_id?: string;
    mirror?: string;
};

type ZealUaApp = { version?: unknown; qt_version?: unknown; install_id?: unknown };
type ZealUaOs = {
    arch?: unknown;
    name?: unknown;
    product_type?: unknown;
    product_version?: unknown;
    kernel_type?: unknown;
    kernel_version?: unknown;
    locale?: unknown;
};
type ZealUa = { app?: ZealUaApp; os?: ZealUaOs };

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseZealUa(header: string | null): ZealUa {
    if (!header) return {};
    try {
        const v = JSON.parse(header);
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as ZealUa) : {};
    } catch {
        return {};
    }
}

export function buildEvent(request: Request, base: EventBase): Record<string, unknown> {
    const zua = parseZealUa(request.headers.get("x-zeal-user-agent"));
    let country: string | undefined;
    let region: string | undefined;
    try {
        const geo = geolocation(request);
        country = geo.country;
        region = geo.countryRegion;
    } catch {
        // Not on Vercel — geolocation unavailable.
    }
    return {
        ts: new Date().toISOString(),
        event: base.event,
        method: request.method,
        source_id: base.source_id,
        source_id_raw: base.source_id_raw,
        docset_id: base.docset_id,
        version: base.version,
        link_id: base.link_id,
        mirror: base.mirror,
        country,
        region,
        app_version: str(zua.app?.version),
        qt_version: str(zua.app?.qt_version),
        install_id: str(zua.app?.install_id),
        os_name: str(zua.os?.name),
        os_arch: str(zua.os?.arch),
        os_product_type: str(zua.os?.product_type),
        os_product_version: str(zua.os?.product_version),
        kernel_type: str(zua.os?.kernel_type),
        kernel_version: str(zua.os?.kernel_version),
        locale: str(zua.os?.locale),
        ua_raw: request.headers.get("user-agent") ?? undefined,
    };
}

async function postBatch(lines: string[]): Promise<void> {
    try {
        const res = await fetch(`${TINYBIRD_URL}?name=${encodeURIComponent(TINYBIRD_DATASOURCE)}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-ndjson",
                Authorization: `Bearer ${tinybirdToken()}`,
            },
            body: `${lines.join("\n")}\n`,
            signal: AbortSignal.timeout(TINYBIRD_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.warn(`[track] tinybird responded ${res.status} (batch of ${lines.length})`);
        }
    } catch (err) {
        console.warn("[track] failed:", (err as Error).message);
    }
}

// Shared buffer for the current flush cycle. `pending` resolves once the buffered
// lines have been POSTed; every enqueued event hands it to waitUntil so the
// serverless instance stays alive until the batch is sent.
let buffer: string[] = [];
let pending: Promise<void> | null = null;
let resolvePending: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    const lines = buffer;
    const done = resolvePending;
    buffer = [];
    pending = null;
    resolvePending = null;
    if (lines.length === 0) {
        done?.();
        return;
    }
    void postBatch(lines).finally(() => done?.());
}

function enqueue(line: string): Promise<void> {
    if (!pending) {
        pending = new Promise<void>((res) => {
            resolvePending = res;
        });
    }
    const cycle = pending;
    buffer.push(line);
    if (buffer.length >= BATCH_MAX) {
        flush();
    } else if (!timer) {
        timer = setTimeout(flush, BATCH_DELAY_MS);
    }
    return cycle;
}

export function track(request: Request, base: EventBase): void {
    if (!tinybirdToken()) return;
    waitUntil(enqueue(JSON.stringify(buildEvent(request, base))));
}
