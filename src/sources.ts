export type SourceConfig = {
    /** Whether docsets from this source ship a tarix index alongside the archive. */
    hasTarix: boolean;
};

export const SOURCES: Record<string, SourceConfig> = {
    "com.kapeli.dash": { hasTarix: true },
    "com.kapeli.contrib": { hasTarix: true },
    "com.kapeli.cheatsheet": { hasTarix: false },
};

/** Defaults to true for unknown sources so they are still probed rather than assumed tarix-less. */
export function sourceHasTarix(sourceId: string): boolean {
    return SOURCES[sourceId]?.hasTarix ?? true;
}
