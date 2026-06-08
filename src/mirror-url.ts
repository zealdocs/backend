export type DocsetManifest = Record<string, { source?: string }>;

/** Feed file base name for a Dash docset, or null if the docset is unknown. */
export function dashFeedName(docsetId: string, manifest: DocsetManifest): string | null {
    return Object.hasOwn(manifest, docsetId) ? (manifest[docsetId].source ?? docsetId) : null;
}

/**
 * Mirror URL for a Dash docset archive. Versioned docsets live under a
 * per-version path; those without a version are served from the feed root.
 */
export function dashArchiveUrl(feedName: string, version: string | undefined, mirror: string): string {
    return version
        ? `https://${mirror}/feeds/zzz/versions/${feedName}/${version}/${feedName}.tgz`
        : `https://${mirror}/feeds/${feedName}.tgz`;
}

export function contribArchiveUrl(key: string, archive: string, mirror: string): string {
    return `https://${mirror}/feeds/zzz/user_contributed/build/${key}/${archive}`;
}

export function cheatsheetArchiveUrl(key: string, mirror: string): string {
    return `https://${mirror}/feeds/zzz/cheatsheets/${key}.tgz`;
}

/** The tarix index is served alongside its archive at the same path plus `.tarix`. */
export function tarixUrl(archiveUrl: string): string {
    return `${archiveUrl}.tarix`;
}
