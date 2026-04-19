// VenueOS App Logic
let map;
let currentMode = 'road-plan';
let activeLayers = {
    roads: L.layerGroup(),
    perimeter: L.layerGroup(),
    staging: L.layerGroup(),
    staff: L.layerGroup()
};

// Map center for stadium (Chennai stadium dummy coords)
const STADIUM_COORDS = [13.0627, 80.2791];

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initSidebar();
    renderControls(currentMode);
});

function initMap() {
    // Dark matter theme
    map = L.map('leaflet-map', {
        center: STADIUM_COORDS,
        zoom: 16,
        zoomControl: false // custom placement later if needed
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Add layer groups to map
    Object.values(activeLayers).forEach(layer => map.addLayer(layer));
}

function initSidebar() {
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            navBtns.forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            
            currentMode = target.dataset.mode;
            renderControls(currentMode);
        });
    });
}

function renderControls(mode) {
    const container = document.getElementById('controls-container');
    container.innerHTML = ''; // clear
    let html = '';

    switch(mode) {
        case 'road-plan':
            html = `
                <div class="context-panel">
                    <h3>Road Planning Options</h3>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Map blockades and clear transit routes for the venue.</p>
                    <button class="btn-primary" onclick="drawRoad('blocked')">Draw Blocked Road</button>
                    <button class="btn-secondary mt-16" onclick="drawRoad('green')">Draw Green Road</button>
                    <button class="btn-primary mt-16" id="btn-suggest-roads" onclick="callGeminiRoads()" style="background: linear-gradient(135deg, #8b5cf6, #3b82f6);">
                        ✨ Auto-Suggest via AI
                    </button>
                    <div id="ai-road-status" class="info-card mt-16" style="display:none"></div>
                    <div class="info-card mt-16">
                        <h4>Usage</h4>
                        <p>Click map to draw lines. Click last point to finish.</p>
                    </div>
                </div>
            `;
            break;
        case 'perimeter-plan':
            html = `
                <div class="context-panel">
                    <h3>Perimeter & Entry Points</h3>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Define the secure physical boundary and mark entry gates.</p>
                    <button class="btn-primary" onclick="drawPolygon('perimeter')">Draw Perimeter</button>
                    <button class="btn-secondary mt-16" onclick="addMarker('gate')">Add Entry Gate</button>
                </div>
            `;
            break;
        case 'staging-area':
            html = `
                 <div class="context-panel">
                    <h3>Staging Areas</h3>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Designate safe gathering zones for the crowd outside perimeter.</p>
                    <button class="btn-primary" onclick="drawPolygon('staging')">Draw Gathering Zone</button>
                </div>
            `;
            break;
        case 'staff-positioning':
            html = `
                 <div class="context-panel">
                    <h3>Staff Positioning</h3>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Allocate security and operations staff strategically.</p>
                    <button class="btn-secondary" onclick="addMarker('staff')">Manual Staff Pin</button>
                    <button class="btn-primary mt-16" id="btn-suggest-staff" onclick="callGeminiStaffing()">
                        ✨ Auto-Suggest via AI
                    </button>
                    <div id="ai-staff-status" class="info-card mt-16" style="display:none"></div>
                </div>
            `;
            break;
        case 'batch-generation':
            html = `
                <div class="context-panel">
                    <h3>Batch Scheduling</h3>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px;">Auto-generate attendee dispatch schedules.</p>
                    <div class="info-card" style="margin-bottom:16px; background:rgba(255,255,255,0.02)">
                        <div style="display:flex; justify-content:space-between; margin-bottom:8px">
                            <span style="color:var(--text-secondary)">Est. Crowd</span>
                            <strong>5,000</strong>
                        </div>
                        <div style="display:flex; justify-content:space-between;">
                            <span style="color:var(--text-secondary)">Active Gates</span>
                            <strong>4</strong>
                        </div>
                    </div>
                    <button class="btn-primary" onclick="generateBatches()">✨ Generate Batches</button>
                    
                    <div id="batch-results" style="margin-top:20px; display:none;">
                        <h4>Generated Schedule</h4>
                        <table class="data-table">
                            <thead><tr><th>ID</th><th>Gate</th><th>Time</th></tr></thead>
                            <tbody id="batch-tbody"></tbody>
                        </table>
                    </div>
                </div>
            `;
            break;
        case 'staff-coordination':
             html = `
                <div class="context-panel">
                    <h3>Staff Overview</h3>
                    <div class="info-card">
                        <h4>Deployed Units</h4>
                        <ul style="list-style:none; margin-top:8px; font-size:0.9rem;" id="staff-list">
                            <li>Check map to view staff points.</li>
                        </ul>
                    </div>
                </div>
            `;
            break;
    }
    container.innerHTML = html;
}

// ---------------- Mapping Tools Logic ----------------

let currentDrawControl = null;

function enableDrawing(type) {
    if(currentDrawControl) {
        currentDrawControl.disable();
    }
    
    // Set up Leaflet draw handler based on type
    let handler;
    if(type === 'polylineBlocked' || type === 'polylineGreen') {
        handler = new L.Draw.Polyline(map, { 
            shapeOptions: { 
                color: type === 'polylineBlocked' ? '#ef4444' : '#10b981', 
                weight: 4 
            } 
        });
    } else if (type === 'polygonPerimeter') {
        handler = new L.Draw.Polygon(map, { 
            shapeOptions: { color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.1 } 
        });
    } else if (type === 'polygonStaging') {
        handler = new L.Draw.Polygon(map, { 
            shapeOptions: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.3 } 
        });
    } else if (type === 'markerGate') {
        handler = new L.Draw.Marker(map, { icon: createIcon('#8b5cf6', 'G') });
    } else if (type === 'markerStaff') {
        handler = new L.Draw.Marker(map, { icon: createIcon('#3b82f6', 'S') });
    }

    if(handler) {
        handler.enable();
        currentDrawControl = handler;
    }
}

// Map Draw Created Event
map.on(L.Draw.Event.CREATED, function (e) {
    const type = e.layerType, layer = e.layer;
    currentLayerTarget().addLayer(layer);
});

function currentLayerTarget() {
    if(currentMode === 'road-plan') return activeLayers.roads;
    if(currentMode === 'perimeter-plan') return activeLayers.perimeter;
    if(currentMode === 'staging-area') return activeLayers.staging;
    if(currentMode === 'staff-positioning') return activeLayers.staff;
    return activeLayers.roads;
}

// Wrapper fns for UI buttons
function drawRoad(type) { enableDrawing(type === 'blocked' ? 'polylineBlocked' : 'polylineGreen'); }
function drawPolygon(type) { enableDrawing(type === 'perimeter' ? 'polygonPerimeter' : 'polygonStaging'); }
function addMarker(type) { enableDrawing(type === 'gate' ? 'markerGate' : 'markerStaff'); }


// Custom markers
function createIcon(color, text) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color:${color}; width:24px; height:24px; border-radius:50%; display:flex; 
        align-items:center; justify-content:center; color:white; font-weight:bold; font-size:12px;
        border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.5);">${text}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
}

// ---------------- API Integration ----------------

async function callGeminiRoads() {
    const btn = document.getElementById('btn-suggest-roads');
    const status = document.getElementById('ai-road-status');
    btn.innerHTML = 'Thinking...';
    btn.disabled = true;
    
    try {
        const payload = { capacity: 5000 };
        const res = await fetch('/api/suggest-roads', {
            method: 'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        status.style.display = 'block';
        status.innerHTML = `<h4>AI Suggestions</h4><p>Placed ${data.blocked_roads.length} roadblocks and ${data.green_roads.length} clear routes.</p>`;
        
        data.blocked_roads.forEach(coords => {
            const polyline = L.polyline(coords, {color: '#ef4444', weight: 4});
            activeLayers.roads.addLayer(polyline);
        });
        data.green_roads.forEach(coords => {
            const polyline = L.polyline(coords, {color: '#10b981', weight: 4});
            activeLayers.roads.addLayer(polyline);
        });

    } catch(err) {
        alert("Failed to reach Gemini Backend for Roads.");
    } finally {
        btn.innerHTML = '✨ Auto-Suggest via AI';
        btn.disabled = false;
    }
}

async function callGeminiStaffing() {
    const btn = document.getElementById('btn-suggest-staff');
    const status = document.getElementById('ai-staff-status');
    btn.innerHTML = 'Thinking...';
    btn.disabled = true;
    
    try {
        const payload = { capacity: 5000, gateCount: 4, gatheringAreaCount: 2 };
        const res = await fetch('/api/suggest-staffing', {
            method: 'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        status.style.display = 'block';
        status.innerHTML = `<h4>AI Suggestions</h4><p>Placed ${data.suggestions.length} unit groups strategically.</p>`;
        
        // Plot them
        data.suggestions.forEach(s => {
            const lat = STADIUM_COORDS[0] + s.latOffset;
            const lng = STADIUM_COORDS[1] + s.lngOffset;
            const marker = L.marker([lat, lng], {icon: createIcon('#3b82f6', s.count)});
            marker.bindPopup(`<b>${s.role}</b><br>Count: ${s.count}`);
            activeLayers.staff.addLayer(marker);
        });

    } catch(err) {
        alert("Failed to reach Gemini Backend. Did you start FastAPI?");
    } finally {
        btn.innerHTML = '✨ Auto-Suggest via AI';
        btn.disabled = false;
    }
}

async function generateBatches() {
    const tbody = document.getElementById('batch-tbody');
    const container = document.getElementById('batch-results');
    
    try {
        const payload = { totalAttendees: 5000, gateCount: 4 };
        const res = await fetch('/api/generate-batches', {
            method: 'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        container.style.display = 'block';
        tbody.innerHTML = '';
        data.batches.forEach(b => {
            tbody.innerHTML += `<tr>
                <td>${b.batchId}</td>
                <td>${b.gate}</td>
                <td>${b.timeWindow}</td>
            </tr>`;
        });
    } catch(e) {
        alert("Batch generation failed.");
    }
}
