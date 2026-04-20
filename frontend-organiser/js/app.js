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
const CLIP_M = 1500;   // Fetch roads within 1.5km internally for intersection calculations
const DISPLAY_CLIP_M = 500; // Visually draw only within 500m
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
let osmRoadCache = {};       // key: normName → [[lat,lng],…]  (clipped to CLIP_M)
let osmCacheReady = false;
let perimeterGateMarkers = [];  // {marker, label} for zoom updates
let staffMarkers = [];           // {marker} for zoom updates

function normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }

async function preloadRoadsFromOSM() {
    const query = `[out:json][timeout:25];
way["name"](around:${CLIP_M},${VENUE_LAT},${VENUE_LNG});
out tags geom;`;
    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
        if (!res.ok) { console.warn('OSM fetch failed:', res.status); return; }
        const json = await res.json();
        const clipDeg = CLIP_M / R_LAT;
        for (const el of (json.elements || [])) {
            if (!el.tags?.name || !el.geometry?.length) continue;
            const key = normName(el.tags.name);
            // Clip to CLIP_M radius
            const clipped = el.geometry.filter(p =>
                Math.hypot((p.lat - VENUE_LAT) * R_LAT, (p.lon - VENUE_LNG) * R_LNG) < CLIP_M
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
        console.log(`OSM ✅ Preloaded ${Object.keys(osmRoadCache).length} roads within ${CLIP_M}m:`,
            Object.keys(osmRoadCache).sort());
    } catch (e) { console.warn('OSM preload error:', e); }
}

// ── Perimeter: angle-binned road nodes in 180-380m band ───────────────────────
function buildPerimeterPolygon() {
    // One representative road node per 6° angle bin, closest to 280m target
    const bins = new Array(ANGLE_BINS).fill(null);
    for (const coords of Object.values(osmRoadCache)) {
        for (const [lat, lng] of coords) {
            const d = distM(lat, lng);
            if (d < PERI_MIN_M || d > PERI_MAX_M) continue;
            const angle = Math.atan2(lat - VENUE_LAT, lng - VENUE_LNG); // -π … π
            const idx = Math.floor((angle + Math.PI) / (2 * Math.PI) * ANGLE_BINS) % ANGLE_BINS;
            if (!bins[idx] || Math.abs(d - 280) < Math.abs(distM(...bins[idx]) - 280)) {
                bins[idx] = [lat, lng];
            }
        }
    }
    // Fill empty bins by interpolating neighbours
    const filled = [];
    for (let i = 0; i < ANGLE_BINS; i++) {
        if (bins[i]) { filled.push(bins[i]); continue; }
        // find nearest non-null before and after
        let prev = null, next = null;
        for (let d = 1; d < ANGLE_BINS; d++) {
            if (!prev && bins[(i - d + ANGLE_BINS) % ANGLE_BINS]) prev = bins[(i - d + ANGLE_BINS) % ANGLE_BINS];
            if (!next && bins[(i + d) % ANGLE_BINS]) next = bins[(i + d) % ANGLE_BINS];
            if (prev && next) break;
        }
        if (prev && next) filled.push([(prev[0] + next[0]) / 2, (prev[1] + next[1]) / 2]);
        else if (prev) filled.push(prev);
    }
    
    if (filled.length < 6) return null;
    
    // Apply a double-pass moving average filter to normalize and smooth the spiky zigzag geometry
    let smoothed = [...filled];
    for(let passes = 0; passes < 2; passes++) {
        const temp = [];
        const len = smoothed.length;
        for (let i = 0; i < len; i++) {
            const prev = smoothed[(i - 1 + len) % len];
            const curr = smoothed[i];
            const next = smoothed[(i + 1) % len];
            temp.push([
                prev[0]*0.25 + curr[0]*0.5 + next[0]*0.25,
                prev[1]*0.25 + curr[1]*0.5 + next[1]*0.25
            ]);
        }
        smoothed = temp;
    }
    
    return smoothed;
}

// Place N gates at equidistant positions along the perimeter polygon
function placeGatesOnPolygon(poly, count) {
    if (!poly || poly.length < 3 || count < 1) return [];
    const n = poly.length;
    let totalLen = 0;
    const cumLen = [0];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        totalLen += Math.hypot(poly[i][0] - poly[j][0], poly[i][1] - poly[j][1]);
        cumLen.push(totalLen);
    }
    const gates = [];
    for (let g = 0; g < count; g++) {
        const target = (g / count) * totalLen;
        let seg = 0;
        while (seg < n - 1 && cumLen[seg + 1] < target) seg++;
        const segLen = cumLen[seg + 1] - cumLen[seg];
        const t = segLen > 0 ? (target - cumLen[seg]) / segLen : 0;
        const j = (seg + 1) % n;
        gates.push([poly[seg][0] + t * (poly[j][0] - poly[seg][0]),
        poly[seg][1] + t * (poly[j][1] - poly[seg][1])]);
    }
    return gates;
}

// ── Zoom-responsive icon sizing ────────────────────────────────────────────────
function iconSize(zoom) {
    if (zoom >= 17) return { s: 34, fs: 16, emoji: true };
    if (zoom >= 16) return { s: 26, fs: 13, emoji: true };
    if (zoom >= 15) return { s: 18, fs: 10, emoji: false };
    if (zoom >= 14) return { s: 11, fs: 0, emoji: false };
    return { s: 7, fs: 0, emoji: false };
}
function gateIcon(label, zoom, color = '#f59e0b') {
    const { s, fs, emoji } = iconSize(zoom);
    return L.divIcon({
        html: `<div style="background:${color};border-radius:50%;width:${s}px;height:${s}px;
               display:flex;align-items:center;justify-content:center;color:white;font-weight:700;
               border:2px solid white;box-shadow:0 1px 5px rgba(0,0,0,0.45);font-size:${fs}px;
               transition:all .2s">${emoji ? '🚪' : ''}</div>`,
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
        perimeterGateMarkers.forEach(({ marker, label }) => marker.setIcon(gateIcon(label, z)));
        staffMarkers.forEach(({ marker }) => marker.setIcon(staffIcon(z)));
    });
}

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
    registerZoomHandler();
    preloadRoadsFromOSM();
}

// ── Main render ────────────────────────────────────────────────────────────────
function renderPlanOnMap(data) {
    if (!venueMap) return;
    planLayerGroup.clearLayers();
    perimeterGateMarkers = [];
    staffMarkers = [];
    const zoom = venueMap.getZoom();

    // ── 1. Perimeter polygon ──────────────────────────────────────────────────
    const poly = buildPerimeterPolygon();
    if (poly) {
        L.polygon(poly, {
            color: '#3b82f6', weight: 2.5, dashArray: '10,6',
            fillColor: '#3b82f6', fillOpacity: 0.04
        }).addTo(planLayerGroup)
            .bindPopup('<b>🔵 Security Perimeter</b><br>Follows roads within 180–380 m of stadium');

        // ── 2. Gate icons: count = Gemini gate count (fallback 7) ─────────────
        const gateCount = data.gates?.length || 7;
        const gatePositions = placeGatesOnPolygon(poly, gateCount);
        gatePositions.forEach((pos, i) => {
            const g = data.gates?.[i] || {};
            const label = g.gateId || `G${i + 1}`;
            const name = g.gateName || `Gate ${i + 1}`;
            const road = g.assignedRoad || '';
            const m = L.marker(pos, { icon: gateIcon(label, zoom) })
                .addTo(planLayerGroup)
                .bindPopup(`<b>🚪 ${name}</b>${road ? '<br>Road: ' + road : ''}`);
            perimeterGateMarkers.push({ marker: m, label });
        });
    }

    // ── 3. Blocked roads → RED ────────────────────────────────────────────────
    const blockedKeys = new Set();
    (data.blockedRoads || []).forEach(r => {
        const needle = normName(r.roadName);
        let coords = osmRoadCache[needle];
        let trueMatchedKey = needle;

        if (!coords) {
            const words = needle.split(' ').filter(w => w.length > 3);
            for (const [k, c] of Object.entries(osmRoadCache)) {
                if (!blockedKeys.has(k) && words.some(w => k.includes(w))) {
                    coords = c;
                    trueMatchedKey = k;
                    break;
                }
            }
        }
        if (!coords?.length) coords = r.coords?.length >= 2 ? r.coords : null;
        if (!coords) return;

        blockedKeys.add(trueMatchedKey);

        L.polyline(coords, { color: '#ef4444', weight: 7, opacity: 0.9 })
            .addTo(planLayerGroup)
            .bindPopup(`<b>🚧 BLOCKED: ${r.roadName}</b><br>${r.reason}`);
        const mid = coords[Math.floor(coords.length / 2)];
        L.circleMarker(mid, { radius: 9, color: '#ef4444', fillColor: '#b91c1c', fillOpacity: 1, weight: 2 })
            .addTo(planLayerGroup).bindPopup(`🚫 ${r.roadName}`);
    });

    // ── 4. All other cached roads → GREEN (named roads ≥ 100 m long) ─────────
    Object.entries(osmRoadCache).forEach(([key, coords]) => {
        if (blockedKeys.has(key)) return;
        if (!coords || coords.length < 2) return;
        
        // Ensure we only draw roads that are physically close to the stadium (within 500m)
        const mid = coords[Math.floor(coords.length / 2)];
        if (distM(mid[0], mid[1]) > DISPLAY_CLIP_M) return;

        // Only named roads with meaningful length (~100 m in degrees)
        const span = Math.hypot(
            (coords[0][0] - coords[coords.length - 1][0]) * R_LAT,
            (coords[0][1] - coords[coords.length - 1][1]) * R_LNG
        );
        if (span < 100) return;
        const label = key.replace(/\b\w/g, c => c.toUpperCase());
        L.polyline(coords, { color: '#22c55e', weight: 4.5, opacity: 0.8, dashArray: '10,5' })
            .addTo(planLayerGroup)
            .bindPopup(`<b>✅ OPEN: ${label}</b><br>Pedestrian & vehicle access`);
    });

    // ── 5. Staff positions → PURPLE ───────────────────────────────────────────
    (data.staffPositions || []).forEach((r, i) => {
        const lat = r.lat || (VENUE_LAT - 0.002 + i * 0.001);
        const lng = r.lng || (VENUE_LNG - 0.002 + i * 0.001);
        const m = L.marker([lat, lng], { icon: staffIcon(zoom) })
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
        
        if (!data.summary && (!data.blockedRoads || data.blockedRoads.length === 0)) {
            throw new Error("AI returned empty JSON payload");
        }
        
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
