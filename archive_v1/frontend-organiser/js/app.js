// Navigation logic
window.showView = function (viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    // Show/hide global nav based on view
    const nav = document.getElementById('global-nav');
    if (viewId === 'view-login' || viewId === 'view-scanner') {
        nav.style.display = 'none';
        if (viewId === 'view-scanner') startScanner();
        else stopScanner();
    } else {
        nav.style.display = 'flex';
        stopScanner();
    }
};

window.switchSetupTab = function (tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
};

// Mock Login System
document.getElementById('btn-google-login').addEventListener('click', () => {
    showView('view-events');
    setTimeout(initMap, 100);
});

// ── Leaflet Map Setup ──────────────────────────────────────────────────────
let venueMap = null;
let planLayerGroup = null;
const VENUE_LAT = 13.0627, VENUE_LNG = 80.2791;

// ── Constants ──────────────────────────────────────────────────────────────────
const FETCH_M = 1000;  // reduced to 1000m to speed up OSM fetch (we only need 380m + 500m display)
const DISPLAY_M = 500;   // green roads only shown if within this distance of stadium
const PERI_MIN_M = 180;   // inner edge of perimeter band
const PERI_MAX_M = 380;   // outer edge of perimeter band
const ANGLE_BINS = 60;    // 6-degree bins for perimeter polygon

// Metre ↔ degree helpers (Chennai latitude)
const R_LAT = 111000;
const R_LNG = 111000 * Math.cos(VENUE_LAT * Math.PI / 180);
function distM(lat, lng) {
    return Math.hypot((lat - VENUE_LAT) * R_LAT, (lng - VENUE_LNG) * R_LNG);
}

// ── OSM Road Cache ─────────────────────────────────────────────────────────────
let osmRoadCache = {};
let osmCacheReady = false;
let osmPreloadPromise = null;   // stored so renderPlanOnMap can await it
let perimeterGateMarkers = [];
let staffMarkers = [];

function normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }

async function preloadRoadsFromOSM() {
    let json = null;

    // 1. Primary: load static pre-fetched file (guarantees performance & 100% uptime for demo)
    try {
        const localRes = await fetch('osm_roads.json?v=' + new Date().getTime());
        if (localRes.ok) {
            json = await localRes.json();
            console.log('OSM ✅ Loaded data from local file');
        }
    } catch (e) { console.warn('Local OSM fetch failed:', e); }

    // 2. Secondary: fallback to live API
    if (!json || !json.elements) {
        const query = `[out:json][timeout:15];
way["highway"]["name"](around:${FETCH_M},${VENUE_LAT},${VENUE_LNG});
out tags geom;`;
        const endpoints = [
            'https://lz4.overpass-api.de/api/interpreter', // often faster/more reliable
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter'
        ];
        for (const ep of endpoints) {
            try {
                const res = await fetch(ep, { method: 'POST', body: query });
                if (res.ok) {
                    json = await res.json();
                    break;
                }
            } catch (e) { console.warn(`OSM fetch failed at ${ep}`); }
        }
    }

    if (!json || !json.elements) {
        console.error('All OSM sources failed!');
        return;
    }

    try {
        for (const el of json.elements) {
            if (!el.tags?.name || !el.geometry?.length) continue;
            const key = normName(el.tags.name);
            // Clip to FETCH_M radius
            const clipped = el.geometry.filter(p =>
                Math.hypot((p.lat - VENUE_LAT) * R_LAT, (p.lon - VENUE_LNG) * R_LNG) < FETCH_M
            );
            if (clipped.length < 2) continue;
            const mid = clipped[Math.floor(clipped.length / 2)];
            const d = distM(mid.lat, mid.lon);
            if (!osmRoadCache[key] || d < osmRoadCache[key]._d) {
                const pts = clipped.map(p => [p.lat, p.lon]);
                pts._d = d;
                osmRoadCache[key] = pts;
            }
        }
        osmCacheReady = true;
        console.log(`OSM ✅ Preloaded ${Object.keys(osmRoadCache).length} roads within ${FETCH_M}m`);
    } catch (e) { console.warn('OSM preload error:', e); }
}

// ── Venue Configuration Profile (Mocked Database Fetch) ──────────────────────
// In the production VenueOS platform, each stadium's physical footprint is 
// configured in their database profile, avoiding hardcoding in the engine.
const VENUE_PROFILE = {
    boundaryRoads: ['wallajah', 'kamarajar', 'bharathi', 'babu jagjivan']
};

// ── 1. Structural Inner Gates ───────────────────────────────────────────
// Generate physical inner stadium gates at a close radius (~100m).
function generateInnerGates(count) {
    const gates = [];
    for (let i = 0; i < count; i++) {
        // Distribute mathematically around the stadium
        const ang = (i / count) * 2 * Math.PI;
        const dx = (100 / (111320 * Math.cos(VENUE_LAT * Math.PI / 180))) * Math.cos(ang);
        const dy = (100 / 111320) * Math.sin(ang);
        gates.push([VENUE_LAT + dy, VENUE_LNG + dx]);
    }
    return gates;
}

// ── 2. Perimeter: Gate-First Topology Generation ────────────────────────────
function buildPerimeterPolygon(gateCount) {
    const innerGates = generateInnerGates(gateCount);

    // 1. Snapping Rays: Every physical gate shoots a radar beam out to find its nearest major road
    const boundingNames = new Set();
    for (const gate of innerGates) {
        let closestRoad = '';
        let minDist = 9999;

        for (const [key, coords] of Object.entries(osmRoadCache)) {
            for (const p of coords) {
                const dCenter = distM(p[0], p[1]);
                if (dCenter < 140 || dCenter > 600) continue; // Bypass deep inner tracks and distant grids

                // Distance from physical Gate to this road pixel
                const dGate = Math.hypot((p[0] - gate[0]) * 111320, (p[1] - gate[1]) * 111320 * Math.cos(gate[0] * Math.PI / 180));

                if (dGate < minDist) {
                    minDist = dGate;
                    closestRoad = key;
                }
            }
        }
        if (closestRoad) boundingNames.add(closestRoad);
    }

    const boundaryRoadNames = Array.from(boundingNames);
    if (boundaryRoadNames.length < 2) return { poly: null, innerGates }; // Only fallback if mapping is entirely dead

    // 2. Topological Extraction & Array-Level Sorting
    const extractedArrays = [];
    for (const [key, coords] of Object.entries(osmRoadCache)) {
        if (boundaryRoadNames.includes(key)) {
            // Cut the long tails off the roads leading away into the city
            const clipped = coords.filter(p => distM(p[0], p[1]) < 450);
            if (clipped.length > 2) extractedArrays.push(clipped);
        }
    }
    
    if (extractedArrays.length < 2) return { poly: null, innerGates };

    // Sort the chunks topologically based on their center of mass relative to the stadium
    extractedArrays.sort((a, b) => {
        const midA = a[Math.floor(a.length / 2)];
        const midB = b[Math.floor(b.length / 2)];
        return Math.atan2(midA[0] - VENUE_LAT, midA[1] - VENUE_LNG) - Math.atan2(midB[0] - VENUE_LAT, midB[1] - VENUE_LNG);
    });

    // 3. Pure Topological End-to-End Splice
    // This perfectly traces the native OSM bezier curves without zigzagging across boundaries
    const poly = [...extractedArrays[0]];
    for (let i = 1; i < extractedArrays.length; i++) {
        const currentArr = extractedArrays[i];
        const lastPt = poly[poly.length - 1];

        const distToStart = Math.hypot(currentArr[0][0] - lastPt[0], currentArr[0][1] - lastPt[1]);
        const distToEnd = Math.hypot(currentArr[currentArr.length - 1][0] - lastPt[0], currentArr[currentArr.length - 1][1] - lastPt[1]);

        if (distToStart <= distToEnd) poly.push(...currentArr);
        else poly.push(...[...currentArr].reverse());
    }

    return { poly, innerGates };
}

// ── 3. Projection: Perimeter Entry Points ────────────────────────────────────
// Mathematically project the inner gates onto the nearest segment of the perimeter polygon
function projectGatesOnPolygon(poly, innerGates) {
    if (!poly || poly.length < 3) return [];
    return innerGates.map(g => {
        let bestPt = poly[0], minDist = Infinity;
        for (const p of poly) {
            const d = Math.hypot(p[0] - g[0], p[1] - g[1]);
            if (d < minDist) { minDist = d; bestPt = p; }
        }
        return bestPt;
    });
}

// ── Zoom-responsive icon sizing ────────────────────────────────────────────────
function iconSize(zoom) {
    return {
        s: zoom >= 18 ? 44 : zoom >= 16 ? 32 : zoom >= 15 ? 24 : 16,
        fs: zoom >= 18 ? 14 : zoom >= 16 ? 12 : zoom >= 15 ? 10 : 8,
        emoji: zoom >= 16
    };
}
function gateIcon(label, zoom) {
    const { s, fs, emoji } = iconSize(zoom);
    const color = label.includes('G') ? '#f59e0b' : '#3b82f6';
    return L.divIcon({
        html: `<div style="background:${color};border-radius:50%;width:${s}px;height:${s}px;
               display:flex;align-items:center;justify-content:center;color:white;font-weight:700;
               border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.45);font-size:${fs}px;
               transition:all .2s">${emoji ? '🚪' : ''}</div>`,
        iconSize: [s, s], iconAnchor: [s / 2, s / 2], className: ''
    });
}
function entryIcon(zoom) {
    const { s, fs, emoji } = iconSize(zoom);
    return L.divIcon({
        html: `<div style="background:#10b981;border-radius:50%;width:${s}px;height:${s}px;
               display:flex;align-items:center;justify-content:center;color:white;font-weight:700;
               border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.45);font-size:${fs - 2}px;
               transition:all .2s">${emoji ? '🔽' : ''}</div>`,
        iconSize: [s, s], iconAnchor: [s / 2, s / 2], className: ''
    });
}
function staffIcon(zoom) {
    const { s, fs, emoji } = iconSize(zoom);
    return L.divIcon({
        html: `<div style="background:#8b5cf6;border-radius:50%;width:${s}px;height:${s}px;
               display:flex;align-items:center;justify-content:center;color:white;font-weight:700;
               border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.45);font-size:${fs}px;
               transition:all .2s">${emoji ? '👮' : ''}</div>`,
        iconSize: [s, s], iconAnchor: [s / 2, s / 2], className: ''
    });
}
function registerZoomHandler() {
    venueMap.on('zoomend', () => {
        const z = venueMap.getZoom();
        perimeterGateMarkers.forEach(({ marker, label, type }) => {
            if (type === 'entry') marker.setIcon(entryIcon(z));
            else marker.setIcon(gateIcon(label, z));
        });
        staffMarkers.forEach(({ marker }) => marker.setIcon(staffIcon(z)));
    });
};

// ── Map Init ───────────────────────────────────────────────────────────────────
function initMap() {
    if (venueMap) return;
    venueMap = L.map('leaflet-map').setView([VENUE_LAT, VENUE_LNG], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(venueMap);
    L.marker([VENUE_LAT, VENUE_LNG]).addTo(venueMap)
        .bindPopup('<b>🏟️ MA Chidambaram Stadium</b><br>CSK vs MI 2026').openPopup();
    planLayerGroup = L.layerGroup().addTo(venueMap);
    // Create a dedicated pane for perimeter so it always renders above road lines
    venueMap.createPane('perimeterPane');
    venueMap.getPane('perimeterPane').style.zIndex = 450;
    registerZoomHandler();
    osmPreloadPromise = preloadRoadsFromOSM(); // store promise for awaiting
}

// ── Main render (async — awaits OSM preload before drawing) ───────────────────
async function renderPlanOnMap(data) {
    if (!venueMap) return;

    // Wait for the OSM preload to finish before drawing anything
    if (osmPreloadPromise) await osmPreloadPromise;

    planLayerGroup.clearLayers();
    perimeterGateMarkers = [];
    staffMarkers = [];
    const zoom = venueMap.getZoom();

    // ── 1. Perimeter polygon (drawn on dedicated high-z pane) ─────────────────
    // ── 2. Render both Inner Gates and Perimeter Entry Points ─────────────
    const gateCount = data.gates?.length || 7;
    const { poly, innerGates } = buildPerimeterPolygon(gateCount);

    if (poly) {
        // Thick white outline + thin blue dashed — always visible above road lines
        L.polygon(poly, {
            color: '#3b82f6', weight: 5, opacity: 1,
            dashArray: '14,6', fillColor: '#3b82f6', fillOpacity: 0.05,
            pane: 'perimeterPane'
        }).addTo(planLayerGroup)
            .bindPopup('<b>🔵 Security Perimeter</b><br>Follows directly mapped infrastructure roads');

        // Render physical doors (Inner)
        innerGates.forEach((pos, i) => {
            const g = data.gates?.[i] || {};
            const label = g.gateId || `G${i + 1}`;
            const name = g.gateName || `Gate ${i + 1}`;
            const m = L.marker(pos, { icon: gateIcon(label, zoom) })
                .addTo(planLayerGroup)
                .bindPopup(`<b>🚪 Physical ${name}</b>`);
            perimeterGateMarkers.push({ marker: m, label, type: 'gate' });
        });

        // Render Perimeter Entry checkpoints
        const entryPositions = projectGatesOnPolygon(poly, innerGates);
        entryPositions.forEach((pos, i) => {
            const g = data.gates?.[i] || {};
            const name = g.gateName || `Gate ${i + 1}`;
            const road = g.assignedRoad || '';
            const m = L.marker(pos, { icon: entryIcon(zoom) })
                .addTo(planLayerGroup)
                .bindPopup(`<b>🔽 Perimeter Entry for ${name}</b>${road ? '<br>Street Access: ' + road : ''}`);
            perimeterGateMarkers.push({ marker: m, label: '', type: 'entry' });
        });
    } else {
        // Fallback: perfectly circular perimeter and gates if OSM completely fails
        L.circle([VENUE_LAT, VENUE_LNG], {
            radius: 320, color: '#3b82f6', weight: 5, opacity: 1,
            dashArray: '14,6', fillColor: '#3b82f6', fillOpacity: 0.05,
            pane: 'perimeterPane'
        }).addTo(planLayerGroup)
            .bindPopup('<b>🔵 Security Perimeter (Fallback)</b>');

        const gateCount = data.gates?.length || 7;
        for (let i = 0; i < gateCount; i++) {
            const angle = (i / gateCount) * Math.PI * 2;
            const lat = VENUE_LAT + (320 / R_LAT) * Math.cos(angle);
            const lng = VENUE_LNG + (320 / R_LNG) * Math.sin(angle);
            const g = data.gates?.[i] || {};
            const label = g.gateId || `G${i + 1}`;
            const m = L.marker([lat, lng], { icon: gateIcon(label, zoom) })
                .addTo(planLayerGroup)
                .bindPopup(`<b>🚪 ${g.gateName || 'Gate ' + i}</b>`);
            perimeterGateMarkers.push({ marker: m, label });
        }
    }

    // ── 3. Blocked roads → RED (Clipped & Styled) ───────────────────────────
    const blockedKeys = new Set();
    const barricadeNodes = [];

    (data.blockedRoads || []).forEach(r => {
        const needle = normName(r.roadName);
        let coords = osmRoadCache[needle];
        let matchedKey = needle;
        if (!coords) {
            const words = needle.split(' ').filter(w => w.length > 3);
            for (const [k, c] of Object.entries(osmRoadCache)) {
                if (!blockedKeys.has(k) && words.some(w => k.includes(w))) { 
                    coords = c; 
                    matchedKey = k;
                    break; 
                }
            }
        }
        if (!coords?.length) coords = r.coords?.length >= 2 ? r.coords : null;
        if (!coords) return;
        
        blockedKeys.add(matchedKey);
        
        // Clip road length to 450m so red barricade lines don't bleed into the city grid
        let clipped = coords.filter(p => distM(p[0], p[1]) < 450);
        if (clipped.length < 2) clipped = coords.slice(0, 5);

        // Layer 1: White stroke background for high-contrast visual distinction
        L.polyline(clipped, { color: '#ffffff', weight: 8, opacity: 1 }).addTo(planLayerGroup);
        // Layer 2: Red dashed barber-pole overlay marking police zone
        L.polyline(clipped, { color: '#ef4444', weight: 8, opacity: 1, dashArray: '15, 10' })
            .addTo(planLayerGroup)
            .bindPopup(`<b>🚧 BLOCKED: ${r.roadName}</b><br>${r.reason}`);

        // Find the node on this road closest to the stadium center to act as the primary barricade point
        let bestPt = clipped[0], bMin = 9999;
        for (const pt of clipped) {
           const d = distM(pt[0], pt[1]);
           if (d < bMin) { bMin = d; bestPt = pt; }
        }
        barricadeNodes.push(bestPt);

        L.circleMarker(bestPt, { radius: 9, color: '#ffffff', fillColor: '#b91c1c', fillOpacity: 1, weight: 2 })
            .addTo(planLayerGroup).bindPopup(`🚫 Police Barricade: ${r.roadName}`);
    });

    // ── 4. Cached roads → GREEN (Excluding Blocked) ─────────────────────────
    Object.entries(osmRoadCache).forEach(([key, coords]) => {
        if (blockedKeys.has(key)) return; // Explicitly prevents double-drawing red and green!
        if (!coords || coords.length < 2) return;
        
        let clipped = coords.filter(p => distM(p[0], p[1]) < 450);
        if (clipped.length < 2) return;

        const label = key.replace(/\b\w/g, c => c.toUpperCase());
        // Bright, solid green to ensure pedestrian access routes are highly visible
        L.polyline(clipped, { color: '#22c55e', weight: 5, opacity: 0.9 })
            .addTo(planLayerGroup)
            .bindPopup(`<b>✅ OPEN: ${label}</b><br>Pedestrian & vehicle access`);
    });

    // ── 5. Staff positions → PURPLE (Snapping to physical barricades) ─────
    (data.staffPositions || []).forEach((r, i) => {
        let targetPt = [VENUE_LAT, VENUE_LNG];

        // Ensure staff are positioned perfectly at the structural choke points
        if (barricadeNodes.length > 0) {
            targetPt = barricadeNodes[i % barricadeNodes.length];
        } else if (poly) {
            targetPt = poly[(i * 47) % poly.length];
        } else {
            targetPt = [r.lat || VENUE_LAT, r.lng || VENUE_LNG];
        }

        const m = L.marker(targetPt, { icon: staffIcon(zoom) })
            .addTo(planLayerGroup)
            .bindPopup(`<b>👮 ${r.location}</b><br>${r.role} — ${r.count} staff`);
        staffMarkers.push({ marker: m });
    });

    // Fit to perimeter bounds
    try {
        const target = poly ? L.polygon(poly) : planLayerGroup;
        venueMap.fitBounds(target.getBounds().pad(0.1), { maxZoom: 16, minZoom: 14 });
    } catch (e) { }
}


// Gemini Logic for Generation with Circuit Breaker Fallback
document.getElementById('btn-gen-plan').addEventListener('click', async () => {
    const btn = document.getElementById('btn-gen-plan');
    btn.innerText = "Generating with API...";
    const crowdSize = document.getElementById('input-crowd-size').value || 50000;

    try {
        const response = await fetch('/api/v1/organiser/events/csk-vs-mi-demo/generate-road-plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedCrowdSize: parseInt(crowdSize) })
        });
        if (!response.ok) throw new Error("API Error " + response.status);
        const data = await response.json();
        btn.innerText = "Plan Generated";
        document.getElementById('plan-output').style.display = "block";
        const summary = data.summary || '';
        const blocked = (data.blockedRoads || []).map(r => `❌ ${r.roadName}: ${r.reason}`).join('<br>');
        const open = (data.openRoads || []).map(r => `✅ ${r.roadName} → ${r.designatedGate}: ${r.instructions}`).join('<br>');
        const staff = (data.staffPositions || []).map(r => `👮 ${r.location} (${r.role}) — ${r.count} staff`).join('<br>');
        document.getElementById('plan-text').innerHTML = `
            <b>📋 Summary:</b><br>${summary}<br><br>
            <b>🚧 Blocked Roads:</b><br>${blocked || 'None'}<br><br>
            <b>🛣️ Open Roads:</b><br>${open || 'None'}<br><br>
            <b>👮 Staff Positions:</b><br>${staff || 'None'}
        `.trim();
        await renderPlanOnMap(data);
    } catch (err) {
        console.error("API failed, falling back to mock UI:", err);
        btn.innerHTML = `<span style="color:#ef4444;">API Err</span> - Faking...`;
        setTimeout(() => {
            btn.innerText = "Plan Generated (Offline Mode)";
            document.getElementById('plan-output').style.display = "block";
            document.getElementById('plan-text').innerHTML = "<b>Offline Gemini Analysis:</b><br/>Block Walajah Road entry. Redirect 30% of traffic to Bell's Road. Position 5 extra staff at Gate 3 due to expected congestion wave at 16:30.";
        }, 1200);
    }
});

document.getElementById('btn-gen-batches').addEventListener('click', async () => {
    const btn = document.getElementById('btn-gen-batches');
    btn.innerText = "Generating via API...";

    try {
        const response = await fetch('/api/v1/organiser/events/csk-vs-mi-demo/generate-batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error("API Error " + response.status);
        const data = await response.json();

        btn.innerText = "Batches Generated";
        showView('view-scheduler');
        const tbody = document.getElementById('batch-table-body');
        tbody.innerHTML = '';
        data.batches.forEach(b => {
            tbody.innerHTML += `<tr><td>${b.batchCode || 'BXX'}</td><td>${b.gateId || b.assignedGate || 'TBD'}</td><td>${b.gatheringZoneId || b.assignedZone || 'TBD'}</td><td>${b.entryWindowStart || b.entryWindowStr || 'TBD'}</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>`;
        });
    } catch (err) {
        console.error("API failed, falling back to mock UI:", err);
        btn.innerHTML = `<span style="color:#ef4444;">API Err</span> - Faking...`;
        setTimeout(() => {
            btn.innerText = "Generate Batches (Offline)";
            showView('view-scheduler');
            const tbody = document.getElementById('batch-table-body');
            tbody.innerHTML = `
                <tr><td>B-A1</td><td>Gate 1</td><td>Walajah Zone</td><td>16:00 - 16:15</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>
                <tr><td>B-A2</td><td>Gate 1</td><td>Walajah Zone</td><td>16:15 - 16:30</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>
                <tr><td>B-A3</td><td>Gate 2</td><td>Bells Road Zone</td><td>16:00 - 16:15</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>
                <tr><td>B-A4</td><td>Gate 3</td><td>Marina Zone</td><td>16:30 - 16:45</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>
                <tr><td>B-A5</td><td>Gate 4</td><td>Chepauk Zone</td><td>16:15 - 16:30</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>
            `;
        }, 1200);
    }
});

// Scanner Logic (using jsQR)
let videoStream = null;

function startScanner() {
    const video = document.getElementById("scanner-video");
    const resultBox = document.getElementById("scan-result");
    const msg = document.getElementById("scan-message");

    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (stream) {
        videoStream = stream;
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        video.play();
        requestAnimationFrame(tick);
    }).catch(err => {
        msg.innerText = "Camera access denied.";
        resultBox.className = "result-flash error";
    });

    // We cache a mock API payload mechanism to fulfill offline caching FR
    const cacheValidScan = (payload) => {
        let scans = JSON.parse(localStorage.getItem('offline_scans') || '[]');
        scans.push({ payload, timestamp: Date.now() });
        localStorage.setItem('offline_scans', JSON.stringify(scans.slice(-100))); // keep last 100
    };

    function tick() {
        if (!videoStream) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const canvasElement = document.createElement("canvas");
            canvasElement.height = video.videoHeight;
            canvasElement.width = video.videoWidth;
            const canvas = canvasElement.getContext("2d");
            canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
            const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });

            if (code) {
                // Found QR. Here we would normally hit /api/v1/scanner/validate
                // Assuming success for demo
                resultBox.className = "result-flash success";
                msg.innerText = "Validated! Proceed to entry.";
                cacheValidScan(code.data);

                // Pause scanning briefly
                setTimeout(() => {
                    resultBox.className = "result-flash";
                    msg.innerText = "Awaiting Scan...";
                    requestAnimationFrame(tick);
                }, 2000);
                return;
            }
        }
        requestAnimationFrame(tick);
    }
}

function stopScanner() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
}
