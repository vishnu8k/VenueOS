from firebase_functions import firestore_fn, https_fn
from firebase_admin import initialize_app, firestore
import google.generativeai as genai
import time
import os
import json
import hmac
import hashlib
import base64

initialize_app()
db = firestore.client()

def generate_qr(attendee_data):
    secret = os.getenv("HMAC_SECRET", "default_secret").encode('utf-8')
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
    payload_str = json.dumps(payload, separators=(',', ':'))
    payload['sig'] = hmac.new(secret, payload_str.encode('utf-8'), hashlib.sha256).hexdigest()
    final_json = json.dumps(payload, separators=(',', ':'))
    return base64.b64encode(final_json.encode('utf-8')).decode('utf-8')

@firestore_fn.on_document_updated(document="attendees/{uid}")
def generate_qr_on_booking(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    # Triggered when checkpointStage becomes 'booked'
    old_data = event.data.before.to_dict()
    new_data = event.data.after.to_dict()
    
    if new_data.get("checkpointStage") == "booked" and old_data.get("checkpointStage") != "booked":
        # Generate QR Payload
        qrPayload = generate_qr(new_data)
        
        # Write back to document
        event.data.after.reference.update({"qrPayload": qrPayload})

@https_fn.on_request()
def density_analysis(req: https_fn.Request) -> https_fn.Response:
    # Trigger by Cloud Scheduler every 60 seconds
    
    # Simple flow representation since full logic requires heavy indexing queries
    event_id = "default-event-id"
    
    # Would calculate actual zone density via:
    # gps = db.collection('gps_pings').where(timestamp > time.time() - 120).get()
    
    snapshot_data = {
        "eventId": event_id,
        "timestamp": time.time(),
        "zoneData": [
            {"zoneId": "Gate 1", "headcount": 1500, "rateOfChange": +50, "intensityLevel": "high"},
            {"zoneId": "Gate 2", "headcount": 200, "rateOfChange": -10, "intensityLevel": "low"},
        ]
    }
    
    # Gemini
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    model = genai.GenerativeModel('gemini-1.5-pro')
    prompt = f"Density snapshot: {json.dumps(snapshot_data)}. Predict congestion."
    
    try:
        response = model.generate_content(prompt)
        res_json = {"geminiPrediction": response.text} # simplified
        snapshot_data.update(res_json)
    except Exception:
        pass
        
    db.collection("density_snapshots").add(snapshot_data)
    
    return https_fn.Response("Density Analysis OK")
