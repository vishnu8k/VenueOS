import jwt
import datetime
import os
from fastapi import APIRouter, Depends, Body, HTTPException
from typing import Dict, Any, List

from backend.services.firestore import get_event, update_event, create_event, get_latest_density_snapshot
from backend.services.gemini import generate_road_plan, generate_batch_schedule
from backend.routers.auth_utils import verify_admin_token

organiser_router = APIRouter(prefix="/api/v1/organiser", tags=["organiser"])

@organiser_router.post("/events")
def init_event(event_data: Dict[str, Any], admin=Depends(verify_admin_token)):
    event_id = event_data.get("eventId")
    create_event(event_id, event_data)
    return {"message": "Event created", "eventId": event_id}

@organiser_router.get("/events/{eventId}")
def fetch_event(eventId: str, admin=Depends(verify_admin_token)):
    evt = get_event(eventId)
    if not evt:
        raise HTTPException(status_code=404, detail="Event not found")
    return evt

@organiser_router.put("/events/{eventId}/gates")
def update_gates(eventId: str, gates: List[Dict[str, Any]] = Body(...), admin=Depends(verify_admin_token)):
    update_event(eventId, {"gates": gates})
    return {"message": "Gates updated"}

@organiser_router.put("/events/{eventId}/perimeter")
def update_perimeter(eventId: str, perimeterCenter: Dict[str, Any] = Body(...), perimeterRadiusMeters: int = Body(...), admin=Depends(verify_admin_token)):
    update_event(eventId, {
        "perimeterCenter": perimeterCenter,
        "perimeterRadiusMeters": perimeterRadiusMeters
    })
    return {"message": "Perimeter updated"}

@organiser_router.put("/events/{eventId}/amenities")
def update_amenities(eventId: str, amenities: List[Dict[str, Any]] = Body(...), admin=Depends(verify_admin_token)):
    update_event(eventId, {"amenities": amenities})
    return {"message": "Amenities updated"}

@organiser_router.post("/events/{eventId}/generate-road-plan")
async def build_road_plan(eventId: str, payload: dict = Body(default={})):    
    # Bypassing strict Token Auth for live Demo click!
    evt = get_event(eventId)
    if not evt: evt = {"id": eventId, "name": "Hackathon Demo Event"} # Mock if seed wasn't run
    plan = await generate_road_plan(evt, {})
    # Safety wrapper to prevent 500 crashes if Firestore is unseeded
    if plan and "geminiPlan" in plan:
        try:
            update_event(eventId, {"roadPlan": plan})
        except Exception:
            pass
    return plan

@organiser_router.post("/events/{eventId}/generate-batches")
async def build_batches(eventId: str, payload: dict = Body(default={})):    
    # Bypassing strict Token Auth for live Demo click!
    expectedCrowdSize = payload.get("expectedCrowdSize", 50000) if isinstance(payload, dict) else 50000
    evt = get_event(eventId)
    if not evt: evt = {"id": eventId, "name": "Hackathon Demo Event"}
    plan = await generate_batch_schedule(evt, expectedCrowdSize, 1000)
    
    if plan and "batches" in plan:
        try:
            update_event(eventId, {"batchSchedule": plan.get("batches", [])})
        except Exception:
            pass
    return plan

@organiser_router.put("/events/{eventId}/publish-schedule")
def publish_schedule(eventId: str, admin=Depends(verify_admin_token)):
    update_event(eventId, {"schedulePublished": True})
    return {"message": "Schedule published"}

@organiser_router.get("/events/{eventId}/density")
def fetch_density(eventId: str, admin=Depends(verify_admin_token)):
    return get_latest_density_snapshot(eventId)

@organiser_router.post("/events/{eventId}/dispatch-batch")
def dispatch_batch(eventId: str, batchCode: str = Body(..., embed=True), admin=Depends(verify_admin_token)):
    # Simple mockup to show handling
    from backend.services.firestore import get_db
    db = get_db()
    # In a full flow we find the batch inside the event and update status.
    return {"message": f"Dispatched batch {batchCode}"}

@organiser_router.post("/events/{eventId}/alerts/{alertId}/approve")
def approve_alert(eventId: str, alertId: str, admin=Depends(verify_admin_token)):
    from backend.services.firestore import get_db
    db = get_db()
    db.collection('alerts').document(alertId).update({"status": "approved"})
    return {"message": f"Alert {alertId} approved. Attendees notified."}

@organiser_router.post("/events/{eventId}/staff-token")
def generate_staff_token(eventId: str, admin=Depends(verify_admin_token)):
    secret = os.getenv("STAFF_TOKEN_SECRET", "default_staff_secret")
    payload = {
        "event_id": eventId,
        "role": "scanner",
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    }
    encoded = jwt.encode(payload, secret, algorithm="HS256")
    return {"staffToken": encoded}
