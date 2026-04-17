import os
import hmac
import hashlib
import json
import base64
from typing import Dict, Any

# Must match exactly as required by the checkpoint evaluation
CHECKPOINT_STAGES = [
    'booked', 
    'boarded', 
    'perimeter_cleared', 
    'gate_entered', 
    'inside', 
    'exited'
]

def generate_qr_payload(attendee_data: Dict[str, Any]) -> str:
    """
    Generates a secure, signed JSON payload using HMAC-SHA256, then encodes to base64.
    """
    secret = os.getenv("HMAC_SECRET", "default_dev_secret").encode('utf-8')
    
    payload = {
        "v": 1,
        "aid": attendee_data.get('uid'),
        "eid": attendee_data.get('eventId'),
        "bc": attendee_data.get('batchCode'),
        "gid": attendee_data.get('gateAssignment'),
        "zid": attendee_data.get('gatheringZoneId'),
        "ews": int(attendee_data.get('entryWindowStart', 0)),
        "ewe": int(attendee_data.get('entryWindowEnd', 0)),
        "xws": int(attendee_data.get('exitWindowStart', 0)),
        "xwe": int(attendee_data.get('exitWindowEnd', 0))
    }
    
    # Sign the JSON string
    payload_str = json.dumps(payload, separators=(',', ':'))
    signature = hmac.new(secret, payload_str.encode('utf-8'), hashlib.sha256).hexdigest()
    
    payload['sig'] = signature
    final_json = json.dumps(payload, separators=(',', ':'))
    return base64.b64encode(final_json.encode('utf-8')).decode('utf-8')

def validate_qr_payload(qr_string: str, checkpoint_type: str, current_time: int, current_stage: str) -> Dict[str, Any]:
    """
    Validates a QR payload. Checks signature, sequence, and timestamps.
    """
    try:
        decoded_json = base64.b64decode(qr_string).decode('utf-8')
        payload = json.loads(decoded_json)
    except Exception:
        return {"valid": False, "stage": current_stage, "attendee_id": None, "error_reason": "Invalid QR format"}
    
    # 1. Verify HMAC
    sig = payload.pop("sig", None)
    if not sig:
        return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Missing signature"}
        
    secret = os.getenv("HMAC_SECRET", "default_dev_secret").encode('utf-8')
    payload_str = json.dumps(payload, separators=(',', ':'))
    expected_sig = hmac.new(secret, payload_str.encode('utf-8'), hashlib.sha256).hexdigest()
    
    if not hmac.compare_digest(sig, expected_sig):
        return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Invalid signature (tampered)"}
        
    # 2. Checkpoint Order Mapping
    checkpoint_to_stage = {
        'transport': 'boarded',
        'perimeter': 'perimeter_cleared',
        'gate': 'gate_entered',
        'inside': 'inside',
        'exit': 'exited'
    }
    
    target_stage = checkpoint_to_stage.get(checkpoint_type)
    if not target_stage:
        return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Unknown checkpoint type"}
        
    # Verify sequence
    try:
        current_idx = CHECKPOINT_STAGES.index(current_stage)
        target_idx = CHECKPOINT_STAGES.index(target_stage)
        
        # We can only advance exactly one step, or if they reached 'gate_entered', they also reach 'inside' after
        allow_advance = False
        if target_idx == current_idx + 1:
            allow_advance = True
        elif target_stage == 'inside' and current_stage == 'gate_entered':
            allow_advance = True
            
        if not allow_advance:
            return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": f"Out of order scan. Expected after {current_stage}"}
            
    except ValueError:
        return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Invalid current stage in DB"}

    # 3. Check Windows
    if checkpoint_type in ['perimeter', 'gate']:
        if current_time < payload['ews']:
            return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Too early for entry window"}
        if current_time > payload['ewe']:
            return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Entry window missed"}
            
    if checkpoint_type == 'exit':
        if current_time < payload['xws']:
            return {"valid": False, "stage": current_stage, "attendee_id": payload.get("aid"), "error_reason": "Too early to exit via standard policy"}

    # Valid! Return the new stage
    return {
        "valid": True,
        "stage": target_stage,
        "attendee_id": payload.get("aid"),
        "error_reason": None
    }
