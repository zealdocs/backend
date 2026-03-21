interface GitHubRelease {
    tag_name: string;
    published_at: string;
    draft: boolean;
}

export interface ReleaseEntry {
    version: string;
    date: string;
}

export async function fetchReleases(): Promise<ReleaseEntry[]> {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "github.com/zealdocs/backend",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const releases: GitHubRelease[] = [];
    let url: string | null = "https://api.github.com/repos/zealdocs/zeal/releases?per_page=100";

    while (url) {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }
        releases.push(...((await response.json()) as GitHubRelease[]));
        url = parseNextLink(response.headers.get("Link"));
    }

    return releases
        .filter((r) => !r.draft)
        .map((r) => ({
            version: r.tag_name.replace(/^v/, ""),
            date: r.published_at,
        }));
}

function parseNextLink(link: string | null): string | null {
    if (!link) return null;
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    return match?.[1] ?? null;
}
