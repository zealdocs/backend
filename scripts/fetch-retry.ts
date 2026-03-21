export async function fetchWithRetry(url: string, retries = 2, timeoutMs = 10_000): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (response.ok) return response;
        if (attempt < retries) {
            console.warn(`  Attempt ${attempt + 1} failed (${response.status}), retrying...`);
            await Bun.sleep(1000);
        } else {
            throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
        }
    }
    throw new Error("unreachable");
}
