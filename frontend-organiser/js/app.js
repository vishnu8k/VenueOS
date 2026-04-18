// Navigation logic
window.showView = function(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    // Show/hide global nav based on view
    const nav = document.getElementById('global-nav');
    if(viewId === 'view-login' || viewId === 'view-scanner') {
        nav.style.display = 'none';
        if(viewId === 'view-scanner') startScanner();
        else stopScanner();
    } else {
        nav.style.display = 'flex';
        stopScanner();
    }
};

window.switchSetupTab = function(tabId) {
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

// ── Road cache: ONE bulk Overpass query at map init, keyed by normalised name ──
let osmRoadCache = {};
let osmCacheReady = false;
function normName(s) { return (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').trim(); }

async function preloadRoadsFromOSM() {
    const query = `[out:json][timeout:25];
way["name"](around:1500,${VENUE_LAT},${VENUE_LNG});
out geom;`;
    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:query });
        if (!res.ok) return;
        const json = await res.json();
        const CLIP_DEG = 0.007; // ~700m — only keep road nodes within this of the stadium
        for (const el of (json.elements||[])) {
            if (!el.tags?.name || !el.geometry || el.geometry.length < 2) continue;
            const key = normName(el.tags.name);
            // Clip to nodes within 700m of stadium
            let clipped = el.geometry.filter(p =>
                Math.hypot(p.lat - VENUE_LAT, p.lon - VENUE_LNG) < CLIP_DEG
            );
            if (clipped.length < 2) clipped = el.geometry; // fallback: keep full way
            const mid = clipped[Math.floor(clipped.length/2)];
            const d = Math.hypot(mid.lat - VENUE_LAT, mid.lon - VENUE_LNG);
            if (!osmRoadCache[key] || d < osmRoadCache[key]._dist) {
                const pts = clipped.map(p => [p.lat, p.lon]);
                pts._dist = d;
                osmRoadCache[key] = pts;
            }
        }
        osmCacheReady = true;
        console.log(`OSM ✅ Preloaded ${Object.keys(osmRoadCache).length} roads near stadium`);
    } catch(e) { console.warn('OSM preload error:', e); }
}

function lookupRoad(roadName) {
    const needle = normName(roadName);
    if (osmRoadCache[needle]) return osmRoadCache[needle];
    // Partial word match fallback
    const words = needle.split(' ').filter(w => w.length > 3);
    for (const [key, coords] of Object.entries(osmRoadCache)) {
        if (words.some(w => key.includes(w))) return coords;
    }
    return null;
}

function initMap() {
    if (venueMap) return;
    venueMap = L.map('leaflet-map').setView([VENUE_LAT, VENUE_LNG], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(venueMap);
    L.marker([VENUE_LAT, VENUE_LNG]).addTo(venueMap)
        .bindPopup('<b>🏟️ MA Chidambaram Stadium</b><br>CSK vs MI 2026').openPopup();
    planLayerGroup = L.layerGroup().addTo(venueMap);
    preloadRoadsFromOSM(); // Single background fetch of all nearby roads
}

// Perimeter polygon: actual road intersection coordinates around the stadium
// These corners are snapped to real road junctions forming a closed security zone
const PERIMETER_POLYGON = [
    [13.0662, 80.2748], // NW: Wallajah Rd × Triplicane High Rd junction
    [13.0662, 80.2800], // N: Wallajah Rd × Babu Jagjivan Ram Salai
    [13.0658, 80.2828], // NE: Wallajah Rd × Kamarajar Salai (Wallajah Bridge)
    [13.0608, 80.2832], // E: Kamarajar Salai mid-section
    [13.0578, 80.2820], // SE: Kamarajar Salai × Victoria Hostel Rd
    [13.0572, 80.2758], // S: Bharathi Salai × OVM Street Rd
    [13.0602, 80.2745], // SW: OVM Street × Bells Road junction
    [13.0635, 80.2745], // W: Triplicane High Rd near stadium west entrance
    [13.0662, 80.2748], // close polygon back to NW
];

// Gate entry points at each corner of the perimeter polygon (except closing point)
const PERIMETER_GATES = [
    { name: 'Gate 1 – NW (Wallajah × Triplicane)', idx: 0 },
    { name: 'Gate 2 – North (Wallajah × BCR Salai)',idx: 1 },
    { name: 'Gate 3 – NE (Wallajah Bridge)',         idx: 2 },
    { name: 'Gate 4 – East (Kamarajar Salai)',       idx: 3 },
    { name: 'Gate 5 – SE (Victoria Hostel Rd)',      idx: 4 },
    { name: 'Gate 6 – South (Bharathi Salai)',       idx: 5 },
    { name: 'Gate 7 – SW (OVM × Bells Rd)',         idx: 6 },
];

function drawPerimeter(geminiGates) {
    // Road-following closed polygon perimeter
    L.polygon(PERIMETER_POLYGON, {
        color: '#3b82f6', weight: 3,
        dashArray: '12,7', fillColor: '#3b82f6', fillOpacity: 0.05
    }).addTo(planLayerGroup)
      .bindPopup('<b>🔵 Security Perimeter</b><br>Controlled access zone — road-following boundary');

    // Gate icons placed AT the polygon corners / road junctions
    PERIMETER_GATES.forEach((g, i) => {
        const [lat, lng] = PERIMETER_POLYGON[g.idx];
        // Try to match this gate to Gemini gate info if provided
        const geminiGate = geminiGates && geminiGates[i];
        const label = geminiGate?.gateId || `G${i + 1}`;
        const assignedRoad = geminiGate?.assignedRoad || 'Entry point';
        const icon = L.divIcon({
            html: `<div style="background:#1d4ed8;color:white;border-radius:5px;
                   width:34px;height:34px;display:flex;flex-direction:column;align-items:center;
                   justify-content:center;font-weight:700;border:2px solid white;
                   box-shadow:0 2px 8px rgba(0,0,0,0.6);line-height:1.2">
                   🚪<span style="font-size:9px">${label}</span></div>`,
            iconSize: [34, 34], iconAnchor: [17, 17]
        });
        L.marker([lat, lng], { icon })
            .addTo(planLayerGroup)
            .bindPopup(`<b>${g.name}</b><br>${assignedRoad}`);
    });
}

function renderPlanOnMap(data) {
    if (!venueMap) return;
    planLayerGroup.clearLayers();

    // ── Step 1: Road-following security perimeter + gate icons ────────────────
    drawPerimeter(data.gates || []);

    // ── Step 2: Mark BLOCKED roads in RED ────────────────────────────────────
    const blockedKeys = new Set();
    (data.blockedRoads || []).forEach(r => {
        const needle = normName(r.roadName);
        let coords = osmRoadCache[needle];
        if (!coords) {
            const words = needle.split(' ').filter(w => w.length > 3);
            for (const [k, c] of Object.entries(osmRoadCache)) {
                if (!blockedKeys.has(k) && words.some(w => k.includes(w))) { coords = c; break; }
            }
        }
        if (!coords || coords.length < 2) coords = r.coords?.length >= 2 ? r.coords : null;
        if (!coords) return;
        blockedKeys.add(needle);
        L.polyline(coords, { color: '#ef4444', weight: 7, opacity: 0.95 })
            .addTo(planLayerGroup)
            .bindPopup(`<b>🚧 BLOCKED: ${r.roadName}</b><br>${r.reason}`);
        const mid = coords[Math.floor(coords.length / 2)];
        L.circleMarker(mid, { radius: 10, color: '#ef4444', fillColor: '#b91c1c', fillOpacity: 1, weight: 2 })
            .addTo(planLayerGroup).bindPopup(`🚫 ${r.roadName}`);
    });

    // ── Step 3: ALL cached OSM roads not blocked → GREEN ─────────────────────
    // Use osmRoadCache directly so we never miss a road due to whitelist mismatch
    Object.entries(osmRoadCache).forEach(([key, coords]) => {
        if (blockedKeys.has(key)) return;
        if (!coords || coords.length < 2) return;
        // Skip very short segments (tiny lanes < ~100m)
        const len = Math.hypot(
            coords[0][0] - coords[coords.length-1][0],
            coords[0][1] - coords[coords.length-1][1]
        );
        if (len < 0.0005) return; // skip very tiny unnamed lanes
        const label = key.replace(/\b\w/g, c => c.toUpperCase());
        L.polyline(coords, { color: '#22c55e', weight: 5, opacity: 0.85, dashArray: '10,5' })
            .addTo(planLayerGroup)
            .bindPopup(`<b>✅ OPEN: ${label}</b><br>Pedestrian access permitted`);
    });

    // ── Step 4: Staff positions ───────────────────────────────────────────────
    (data.staffPositions || []).forEach((r, i) => {
        const lat = r.lat || (VENUE_LAT - 0.002 + i * 0.001);
        const lng = r.lng || (VENUE_LNG - 0.002 + i * 0.001);
        const icon = L.divIcon({
            html: `<div style="background:#7c3aed;color:white;border-radius:50%;width:30px;height:30px;
                   display:flex;align-items:center;justify-content:center;font-size:15px;
                   border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5)">👮</div>`,
            iconSize: [30, 30], iconAnchor: [15, 15]
        });
        L.marker([lat, lng], { icon })
            .addTo(planLayerGroup)
            .bindPopup(`<b>${r.location}</b><br>${r.role} — ${r.count} staff`);
    });

    try { venueMap.fitBounds(L.polygon(PERIMETER_POLYGON).getBounds().pad(0.15), { maxZoom: 16, minZoom: 15 }); } catch(e) {}
}


// Gemini Logic for Generation with Circuit Breaker Fallback
document.getElementById('btn-gen-plan').addEventListener('click', async () => {
    const btn = document.getElementById('btn-gen-plan');
    btn.innerText = "Generating with API...";
    const crowdSize = document.getElementById('input-crowd-size').value || 50000;
    
    try {
        const response = await fetch('/api/v1/organiser/events/csk-vs-mi-demo/generate-road-plan', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ expectedCrowdSize: parseInt(crowdSize) })
        });
        if(!response.ok) throw new Error("API Error " + response.status);
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
    } catch(err) {
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
            headers: {'Content-Type': 'application/json'}
        });
        if(!response.ok) throw new Error("API Error " + response.status);
        const data = await response.json();
        
        btn.innerText = "Batches Generated";
        showView('view-scheduler');
        const tbody = document.getElementById('batch-table-body');
        tbody.innerHTML = '';
        data.batches.forEach(b => {
            tbody.innerHTML += `<tr><td>${b.batchCode || 'BXX'}</td><td>${b.gateId || b.assignedGate || 'TBD'}</td><td>${b.gatheringZoneId || b.assignedZone || 'TBD'}</td><td>${b.entryWindowStart || b.entryWindowStr || 'TBD'}</td><td><span class="badge grey-badge">Pending</span></td><td><button class="btn-small">Dispatch</button></td></tr>`;
        });
    } catch(err) {
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
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function(stream) {
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
