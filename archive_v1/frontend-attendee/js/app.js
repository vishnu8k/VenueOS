// View Router
function showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    const btns = document.querySelectorAll('.nav-item');
    btns.forEach(b => b.classList.remove('active'));
    if(event && event.currentTarget && event.currentTarget.classList) {
        event.currentTarget.classList.add('active');
    }
}

// ----------------------------------------------------
// OTP Flow
function sendOtp() {
    const phone = document.getElementById('input-phone').value;
    if(phone.length > 5) {
        // Assume Firebase logic hits
        document.getElementById('otp-section').style.display = 'block';
    }
}

function verifyOtp() {
    // Show booking window normally, or if booked, show home
    showView('view-booking');
    document.getElementById('bottom-nav').style.display = 'flex';
}

// ----------------------------------------------------
// Booking Flow
function selectSlot(element) {
    if(element.classList.contains('disabled')) return;
    
    // Quick ui toggle
    const siblings = element.parentElement.querySelectorAll('.slot-card');
    siblings.forEach(node => {
        if(!node.classList.contains('disabled')) node.classList.remove('active');
    });
    element.classList.add('active');
}

function confirmBooking() {
    // Simulate API return QR payload
    generateLocalQR();
    showView('view-home');
}

// ----------------------------------------------------
// QR Logic Structure (Offline Resilience Caching logic structure)
function generateLocalQR() {
    // We utilize qrcode.js locally
    const qrbox = document.getElementById('qrcode-box');
    qrbox.innerHTML = "";
    
    // Normally base64 encoded JWT. Emulated for view.
    const mockPayload = "eyJ2IjoxLCJhaWQiOiJmYWtlX3VpZCIsImVpZCI6ImNzay12cy1taSJ9...";
    new QRCode(qrbox, {
        text: mockPayload,
        width: 200,
        height: 200,
        colorDark : "#1d4ed8",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

// ----------------------------------------------------
// Haversine Perimeter Distance Check
const PERIMETER = {
    lat: 13.0628, lng: 80.2793,
    radiusMeters: 200 
};

function haversineDistanceMeters(lat1, lng1, lat2, lng2) { 
    const R = 6371000; 
    const dLat = (lat2-lat1)*Math.PI/180; 
    const dLng = (lng2-lng1)*Math.PI/180; 
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2; 
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
}

// Emulate checking every 30s as per spec
setInterval(() => {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            const dist = haversineDistanceMeters(
                position.coords.latitude, position.coords.longitude,
                PERIMETER.lat, PERIMETER.lng
            );
            
            // Assume the user arrived early
            if(dist <= PERIMETER.radiusMeters) {
                document.getElementById('perimeter-alert').style.display = "block";
                document.getElementById('perimeter-msg').innerText = "You have arrived 2 hrs early. Please wait at the gathering zone to avoid congestion.";
            }

            // Implicitly fire GPS Ping backend endpoint
            fetch('/api/v1/attendee/mock-uid/gps-ping', {
                method: 'POST',
                body: JSON.stringify({ location: {lat: position.coords.latitude, lng: position.coords.longitude}})
            }).catch(() => {});
        });
    }
}, 30000);

// ----------------------------------------------------
// Incident API Hook
function submitReport() {
    alert("Report sent to Gemini triage. Ticket received.");
    showView('view-map');
}

// Map Chip Logic
function toggleChip(element) {
    const chips = element.parentElement.querySelectorAll('.chip');
    chips.forEach(c => c.classList.remove('active'));
    element.classList.add('active');
}

// Handle Photo Upload UI
function handlePhotoUpload(input) {
    if (input.files && input.files[0]) {
        const btn = document.getElementById('btn-upload');
        let fname = input.files[0].name;
        if(fname.length > 20) fname = fname.substring(0, 17) + '...';
        
        btn.innerText = "Attached: " + fname;
        btn.style.border = "2px solid var(--primary)";
        btn.style.color = "var(--primary)";
        btn.style.background = "#eff6ff";
    }
}
