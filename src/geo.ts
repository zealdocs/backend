const mirrors = [
    { host: "frankfurt.kapeli.com", lat: 50.1, lon: 8.7 },
    { host: "london.kapeli.com", lat: 51.5, lon: -0.1 },
    { host: "newyork.kapeli.com", lat: 40.7, lon: -74.0 },
    { host: "sanfrancisco.kapeli.com", lat: 37.8, lon: -122.4 },
    { host: "tokyo.kapeli.com", lat: 35.7, lon: 139.7 },
];

export const defaultMirror = mirrors[0].host;

function distance(lat: number, lon: number, mirror: (typeof mirrors)[number]): number {
    const dLat = mirror.lat - lat;
    // Raw longitude difference can exceed 180° when a point and a mirror straddle the antimeridian
    // (e.g. -175° and +170° are 15° apart, not 345°). Adding 540 (= 360 + 180) before the modulo
    // keeps the value positive before wrapping, then subtracting 180 maps the result to [-180, 180].
    const dLonDegrees = ((mirror.lon - lon + 540) % 360) - 180;
    const dLon = dLonDegrees * Math.cos((lat * Math.PI) / 180);
    return dLat * dLat + dLon * dLon;
}

export function getMirror(lat?: string, lon?: string): string {
    const la = parseFloat(lat ?? "");
    const lo = parseFloat(lon ?? "");
    if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) {
        return defaultMirror;
    }
    return mirrors.reduce((a, b) => (distance(la, lo, a) < distance(la, lo, b) ? a : b)).host;
}
