const VENUE_LAT = 13.0627, VENUE_LNG = 80.2791;
const FETCH_M     = 1000;
const DISPLAY_M   = 500;
const PERI_MIN_M  = 180;
const PERI_MAX_M  = 380;
const ANGLE_BINS  = 60;
const R_LAT = 111000;
const R_LNG = 111000 * Math.cos(VENUE_LAT * Math.PI / 180);
function distM(lat, lng) { return Math.hypot((lat - VENUE_LAT) * R_LAT, (lng - VENUE_LNG) * R_LNG); }

const osmRoadCache = {};

function normName(s) { return (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim(); }

async function preloadRoadsFromOSM() {
    const query = `[out:json][timeout:15];way["name"](around:${FETCH_M},${VENUE_LAT},${VENUE_LNG});out tags geom;`;
    const res = await fetch('https://lz4.overpass-api.de/api/interpreter', { method:'POST', body:query });
    const json = await res.json();
    console.log("Fetched OSM elements:", json.elements.length);
    for (const el of json.elements) {
        if (!el.tags?.name || !el.geometry?.length) continue;
        const key = normName(el.tags.name);
        const clipped = el.geometry.filter(p => Math.hypot((p.lat-VENUE_LAT)*R_LAT, (p.lon-VENUE_LNG)*R_LNG) < FETCH_M);
        if (clipped.length < 2) continue;
        const mid = clipped[Math.floor(clipped.length/2)];
        const d = distM(mid.lat, mid.lon);
        if (!osmRoadCache[key] || d < osmRoadCache[key]._d) {
            const pts = clipped.map(p => [p.lat, p.lon]);
            pts._d = d;
            osmRoadCache[key] = pts;
        }
    }
    console.log("Cached roads:", Object.keys(osmRoadCache).length);
}

function buildPerimeterPolygon() {
    const bins = new Array(ANGLE_BINS).fill(null);
    for (const coords of Object.values(osmRoadCache)) {
        for (const [lat, lng] of coords) {
            const d = distM(lat, lng);
            if (d < PERI_MIN_M || d > PERI_MAX_M) continue;
            const angle = Math.atan2(lat - VENUE_LAT, lng - VENUE_LNG);
            const idx = Math.floor((angle + Math.PI) / (2 * Math.PI) * ANGLE_BINS) % ANGLE_BINS;
            if (!bins[idx] || Math.abs(d - 280) < Math.abs(distM(bins[idx][0], bins[idx][1]) - 280)) {
                bins[idx] = [lat, lng];
            }
        }
    }
    const filled = [];
    for (let i = 0; i < ANGLE_BINS; i++) {
        if (bins[i]) { filled.push(bins[i]); continue; }
        let prev = null, next = null;
        for (let d = 1; d < ANGLE_BINS; d++) {
            if (!prev && bins[(i-d+ANGLE_BINS)%ANGLE_BINS]) prev = bins[(i-d+ANGLE_BINS)%ANGLE_BINS];
            if (!next && bins[(i+d)%ANGLE_BINS]) next = bins[(i+d)%ANGLE_BINS];
            if (prev && next) break;
        }
        if (prev && next) filled.push([(prev[0]+next[0])/2, (prev[1]+next[1])/2]);
        else if (prev) filled.push(prev);
    }
    return filled.length >= 6 ? filled : null;
}

preloadRoadsFromOSM().then(() => {
    const poly = buildPerimeterPolygon();
    console.log("Polygon points:", poly ? poly.length : "NULL");
});
