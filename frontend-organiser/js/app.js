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

function initMap() {
    if (venueMap) return;
    venueMap = L.map('leaflet-map').setView([VENUE_LAT, VENUE_LNG], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(venueMap);
    L.marker([VENUE_LAT, VENUE_LNG]).addTo(venueMap)
        .bindPopup('<b>🏟️ MA Chidambaram Stadium</b><br>CSK vs MI 2026').openPopup();
    planLayerGroup = L.layerGroup().addTo(venueMap);
}

// Fetch actual road geometry from OpenStreetMap Overpass API
// Uses `around:1500` so it only fetches the segment physically near the stadium
async function fetchRoadGeometry(roadName) {
    const safeName = roadName.replace(/['"\\]/g, '').trim();
    const query = `[out:json][timeout:12];
way["name"~"${safeName}",i](around:1500,${VENUE_LAT},${VENUE_LNG});
out geom;`;
    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
        if (!res.ok) return null;
        const json = await res.json();
        if (!json.elements || json.elements.length === 0) {
            console.warn(`OSM ⚠️ No match: "${roadName}"`);
            return null;
        }

        // Pick the way whose midpoint is closest to the stadium
        let best = null, bestDist = Infinity;
        for (const el of json.elements) {
            if (!el.geometry || el.geometry.length < 2) continue;
            const mid = el.geometry[Math.floor(el.geometry.length / 2)];
            const d = Math.hypot(mid.lat - VENUE_LAT, mid.lon - VENUE_LNG);
            if (d < bestDist) { bestDist = d; best = el; }
        }
        if (!best) return null;

        // CLIP: only keep nodes within 1.0km of the stadium (prevents lines extending too far)
        const CLIP_DEG = 0.009; // ~1km in degrees
        let pts = best.geometry
            .filter(pt => Math.hypot(pt.lat - VENUE_LAT, pt.lon - VENUE_LNG) < CLIP_DEG)
            .map(pt => [pt.lat, pt.lon]);

        // If clipping removed everything, fallback to full geometry
        if (pts.length < 2) pts = best.geometry.map(pt => [pt.lat, pt.lon]);

        console.log(`OSM ✅ "${roadName}" → ${pts.length} nodes (clipped), dist=${bestDist.toFixed(4)}`);
        return pts;
    } catch (e) {
        console.warn(`Overpass FAILED for "${roadName}":`, e);
        return null;
    }
}

async function renderPlanOnMap(data) {
    if (!venueMap) return;
    planLayerGroup.clearLayers();

    const allRoads = [
        ...(data.blockedRoads || []).map(r => ({ ...r, type: 'blocked' })),
        ...(data.openRoads || []).map(r => ({ ...r, type: 'open' })),
    ];

    // Fetch all road geometries in parallel
    const geometries = await Promise.all(allRoads.map(r => fetchRoadGeometry(r.roadName)));

    allRoads.forEach((r, i) => {
        // Use OSM geometry if found, else fall back to Gemini coords, else fallback line
        let coords = geometries[i];
        if (!coords || coords.length < 2) {
            coords = (r.coords && r.coords.length >= 2) ? r.coords : null;
        }
        if (!coords) {
            // Last resort: tiny offset from stadium
            const o = (i + 1) * 0.002;
            coords = [[VENUE_LAT + o, VENUE_LNG + o], [VENUE_LAT + o * 1.5, VENUE_LNG + o * 1.5]];
        }

        if (r.type === 'blocked') {
            L.polyline(coords, { color: '#ef4444', weight: 7, opacity: 0.95 })
                .addTo(planLayerGroup)
                .bindPopup(`<b>🚧 BLOCKED: ${r.roadName}</b><br>${r.reason}`);
            const mid = coords[Math.floor(coords.length / 2)];
            L.circleMarker(mid, { radius: 10, color: '#ef4444', fillColor: '#b91c1c', fillOpacity: 1, weight: 2 })
                .addTo(planLayerGroup).bindPopup(`🚫 ${r.roadName}`);
        } else {
            L.polyline(coords, { color: '#22c55e', weight: 6, opacity: 0.95, dashArray: '12,6' })
                .addTo(planLayerGroup)
                .bindPopup(`<b>✅ OPEN: ${r.roadName}</b><br>→ ${r.designatedGate}<br>${r.instructions}`);
        }
    });

    // 👮 Staff positions
    (data.staffPositions || []).forEach((r, i) => {
        const lat = r.lat || (VENUE_LAT - 0.002 + i * 0.001);
        const lng = r.lng || (VENUE_LNG - 0.002 + i * 0.001);
        const icon = L.divIcon({
            html: `<div style="background:#3b82f6;color:white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.5)">👮</div>`,
            iconSize: [30, 30], iconAnchor: [15, 15]
        });
        L.marker([lat, lng], { icon })
            .addTo(planLayerGroup)
            .bindPopup(`<b>${r.location}</b><br>${r.role} — ${r.count} staff`);
    });

    try { venueMap.fitBounds(planLayerGroup.getBounds().pad(0.15)); } catch(e) {}
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
