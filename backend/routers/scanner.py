import time
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from typing import Dict, Any

from backend.services.qr import validate_qr_payload
from backend.routers.auth_utils import verify_staff_token
from backend.services.firestore import update_attendee_checkpoint, write_scan_event

scanner_router = APIRouter(prefix="/api/v1/scanner", tags=["scanner"])

class ScanRequest(BaseModel):
    qrPayload: str
    checkpointType: str
    checkpointId: str
    scannerLocation: Dict[str, float]
    staffToken: str

@scanner_router.post("/validate")
def validate_scan(scan_req: ScanRequest):
    # Verify staff middleware manually since staffToken is in body
    staff_data = verify_staff_token(scan_req.staffToken)
    
    # Current unix timestamp
    current_time = int(time.time())
    
    # We don't know the user's current stage without querying DB, but for this hackathon
    # let's assume we decode first, get the aid (attendee id), fetch their document,
    # then pass their current stage to validate_qr_payload.
    from backend.services.firestore import get_db
    db = get_db()
    
    try:
        # Decode base64 to peak inside (without verifying HMAC) to fetch user
        import base64
        import json
        raw = base64.b64decode(scan_req.qrPayload).decode('utf-8')
        aid = json.loads(raw).get('aid')
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed QR payload")
        
    doc = db.collection('attendees').document(aid).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Attendee not found")
        
    attendee_data = doc.to_dict()
    current_stage = attendee_data.get('checkpointStage', 'booked')
    
    # Validate!
    result = validate_qr_payload(
        qr_string=scan_req.qrPayload, 
        checkpoint_type=scan_req.checkpointType, 
        current_time=current_time, 
        current_stage=current_stage
    )
    
    if result["valid"]:
        # Update stage
        new_stage = result["stage"]
        update_attendee_checkpoint(aid, new_stage, f"{new_stage}_at")
        
    # Write audit log
    write_scan_event({
        "attendeeId": aid,
        "eventId": staff_data.get("event_id", "unknown"),
        "checkpointType": scan_req.checkpointType,
        "checkpointId": scan_req.checkpointId,
        "location": scan_req.scannerLocation,
        "result": "success" if result["valid"] else "error",
        "errorReason": result["error_reason"],
        "scannedAt": time.time(),
        "scannedBy": "staff_scanner"
    })
    
    return {
        "valid": result["valid"],
        "stage": result["stage"],
        "attendeeName": attendee_data.get("name", "Unknown"),
        "errorReason": result["error_reason"]
    }
