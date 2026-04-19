import os
import firebase_admin
from firebase_admin import credentials, firestore
from typing import Dict, Any, Optional

_db = None

def get_db():
    global _db
    if _db is not None:
        return _db
        
    cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if not firebase_admin._apps:
        if cred_path and os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        else:
            # Fallback to Application Default Credentials for seamless secure Cloud Run 
            firebase_admin.initialize_app()
        
    _db = firestore.client()
    return _db

def create_event(event_id: str, event_data: Dict[str, Any]) -> str:
    db = get_db()
    db.collection('events').document(event_id).set(event_data)
    return event_id

def get_event(event_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    doc = db.collection('events').document(event_id).get()
    if doc.exists:
        return doc.to_dict()
    return None

def update_event(event_id: str, event_data: Dict[str, Any]):
    db = get_db()
    db.collection('events').document(event_id).update(event_data)

def create_attendee(attendee_data: Dict[str, Any]) -> str:
    db = get_db()
    uid = attendee_data.get('uid')
    if uid:
        db.collection('attendees').document(uid).set(attendee_data)
        return uid
    else:
        # Auto-id if uid somehow missing
        ref = db.collection('attendees').document()
        attendee_data['uid'] = ref.id
        ref.set(attendee_data)
        return ref.id

def get_attendee_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    docs = db.collection('attendees').where('phone', '==', phone).limit(1).stream()
    for doc in docs:
        return doc.to_dict()
    return None

def update_attendee_checkpoint(attendee_id: str, checkpoint_stage: str, timestamp_field: str):
    db = get_db()
    db.collection('attendees').document(attendee_id).update({
        'checkpointStage': checkpoint_stage,
        f'checkpointTimestamps.{timestamp_field}': firestore.SERVER_TIMESTAMP
    })

def write_gps_ping(ping_data: Dict[str, Any]) -> str:
    db = get_db()
    # Ensure pingId is injected if not sent
    if 'pingId' not in ping_data or not ping_data['pingId']:
        ref = db.collection('gps_pings').document()
        ping_data['pingId'] = ref.id
        ref.set(ping_data)
        return ref.id
    
    db.collection('gps_pings').document(ping_data['pingId']).set(ping_data)
    return ping_data['pingId']

def write_scan_event(scan_data: Dict[str, Any]) -> str:
    db = get_db()
    if 'scanId' not in scan_data or not scan_data['scanId']:
        ref = db.collection('scan_events').document()
        scan_data['scanId'] = ref.id
        ref.set(scan_data)
        return ref.id
    
    db.collection('scan_events').document(scan_data['scanId']).set(scan_data)
    return scan_data['scanId']

def write_density_snapshot(snapshot_data: Dict[str, Any]) -> str:
    db = get_db()
    if 'snapshotId' not in snapshot_data or not snapshot_data['snapshotId']:
        ref = db.collection('density_snapshots').document()
        snapshot_data['snapshotId'] = ref.id
        ref.set(snapshot_data)
        return ref.id
        
    db.collection('density_snapshots').document(snapshot_data['snapshotId']).set(snapshot_data)
    return snapshot_data['snapshotId']

def write_incident_report(report_data: Dict[str, Any]) -> str:
    db = get_db()
    if 'reportId' not in report_data or not report_data['reportId']:
        ref = db.collection('incident_reports').document()
        report_data['reportId'] = ref.id
        ref.set(report_data)
        return ref.id
        
    db.collection('incident_reports').document(report_data['reportId']).set(report_data)
    return report_data['reportId']

def get_latest_density_snapshot(event_id: str) -> Optional[Dict[str, Any]]:
    db = get_db()
    docs = db.collection('density_snapshots').where('eventId', '==', event_id).order_by(
        'timestamp', direction=firestore.Query.DESCENDING
    ).limit(1).stream()
    
    for doc in docs:
        return doc.to_dict()
    return None
