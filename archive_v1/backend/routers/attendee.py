from fastapi import APIRouter, Depends, Body, HTTPException
from typing import Dict, Any

from backend.services.firestore import get_attendee_by_phone, write_gps_ping, write_incident_report, create_attendee, get_event, get_db
from backend.services.gemini import categorise_incident
from backend.routers.auth_utils import verify_firebase_token

attendee_router = APIRouter(prefix="/api/v1", tags=["attendee"])

@attendee_router.post("/auth/verify-otp")
def verify_otp(token_data=Depends(verify_firebase_token)):
    # After Firebase verifies OTP, phone comes from decoded token
    phone = token_data.get("phone_number")
    if not phone:
        raise HTTPException(400, "No phone number found in token")
        
    attendee = get_attendee_by_phone(phone)
    if attendee:
        return {"exists": True, "profile": attendee}
    return {"exists": False, "message": "Proceed to registration"}

@attendee_router.get("/attendee/{uid}")
def fetch_attendee(uid: str, token_data=Depends(verify_firebase_token)):
    db = get_db()
    doc = db.collection('attendees').document(uid).get()
    if not doc.exists:
        raise HTTPException(404, "Attendee not found")
    return doc.to_dict()

@attendee_router.post("/attendee/{uid}/book-slot")
def book_slot(uid: str, entryWindowId: str = Body(...), exitWindowId: str = Body(...), token_data=Depends(verify_firebase_token)):
    db = get_db()
    doc = db.collection('attendees').document(uid).get()
    if not doc.exists:
        raise HTTPException(404, "Attendee not found")
    
    # We update the user attributes here. 
    # Cloud functions (generate_qr_on_booking) will trigger and write the QR!
    db.collection('attendees').document(uid).update({
        "checkpointStage": "booked",
        "batchCode": "B-XTEST", # Usually dynamically assigned
        "gateAssignment": "G1",
        "gatheringZoneId": "Z1"
    })
    return {"message": "Slot booked, generating pass"}

@attendee_router.get("/attendee/{uid}/qr")
def fetch_qr(uid: str, token_data=Depends(verify_firebase_token)):
    db = get_db()
    data = db.collection('attendees').document(uid).get().to_dict()
    payload = data.get("qrPayload")
    if not payload:
        raise HTTPException(404, "QR not generated yet")
    return {"qrPayload": payload}

@attendee_router.post("/attendee/{uid}/gps-ping")
def log_gps(uid: str, location: Dict[str, float] = Body(..., embed=True), token_data=Depends(verify_firebase_token)):
    import time
    from datetime import datetime, timedelta
    
    expire_dt = datetime.utcnow() + timedelta(hours=4)
    write_gps_ping({
        "attendeeId": uid,
        "eventId": "default-event-id",
        "location": location,
        "timestamp": time.time(),
        "expireAt": expire_dt.timestamp()
    })
    return {"message": "Ping recorded"}

@attendee_router.get("/events/{eventId}/map-data")
def fetch_map_data(eventId: str, token_data=Depends(verify_firebase_token)):
    evt = get_event(eventId)
    if not evt:
        raise HTTPException(404, "Event not found")
        
    return {
        "gates": evt.get("gates", []),
        "amenities": evt.get("amenities", []),
        "gatheringZones": evt.get("gatheringZones", []),
        "perimeterRadiusMeters": evt.get("perimeterRadiusMeters")
    }

@attendee_router.post("/attendee/{uid}/report")
async def generate_incident_report(uid: str, reportData: Dict[str, Any] = Body(...), token_data=Depends(verify_firebase_token)):
    import time
    
    reportData['attendeeId'] = uid
    reportData['createdAt'] = time.time()
    
    # Send through Gemini Triage!
    categorisation = await categorise_incident(reportData)
    
    # Merge classification directly in our document
    reportData.update(categorisation)
    
    report_id = write_incident_report(reportData)
    return {"message": "Report logged and routed", "reportId": report_id, "category": categorisation}

@attendee_router.get("/attendee/{uid}/notifications")
def get_notifications(uid: str, token_data=Depends(verify_firebase_token)):
    return {"notifications": []}
