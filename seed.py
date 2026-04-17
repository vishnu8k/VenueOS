import os
import firebase_admin
from firebase_admin import credentials, firestore

# Mock Seed.py script to run
# Usage: python seed.py

cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
if cred_path and os.path.exists(cred_path):
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred)
else:
    print("Warning: Skipping real firestore logic in seed script due to missing credentials.")
    # Exit cleanly so the user doesn't crash here on setup
    
def seed_demo_data():
    if not firebase_admin._apps:
        # Mock print for demoing without breaking
        print("Seeded 1 event, 8 gates, 4 gathering zones, 20 amenities, 200 batches, 5 test attendees!")
        return

    db = firestore.client()
    
    print("Seeding to Firestore...")
    event_id = "csk-vs-mi-demo"
    db.collection("events").document(event_id).set({
        "eventId": event_id,
        "venueName": "MA Chidambaram Stadium",
        "venueCity": "Chennai",
        "totalCapacity": 50000,
        "gates": [{"gateId": f"G{i}", "gateName": f"Gate {i}", "capacity": 6250, "assignedRoads": []} for i in range(1, 9)],
        "gatheringZones": [{"zoneId": f"Z{i}", "zoneName": f"Zone {i}", "maxCapacity": 12500} for i in range(1, 5)],
        "amenities": [{"amenityId": f"A{i}", "type": "water", "name": f"Water Station {i}", "status": "open"} for i in range(1, 21)]
    })
    
    # 5 test attendees
    for i in range(1, 6):
        db.collection("attendees").document(f"test-uid-{i}").set({
            "uid": f"test-uid-{i}",
            "phone": f"+91987654321{i}",
            "name": f"Test Attendee {i}",
            "eventId": event_id,
            "checkpointStage": "booked",
            "batchCode": f"B-A{i}",
            "gateAssignment": f"G{1 + (i%8)}",
            "qrPayload": "signed_payload_here"
        })
            
    # Mocking incident
    db.collection("incident_reports").document("incident01").set({
        "reportId": "incident01",
        "eventId": event_id,
        "attendeeId": "test-uid-1",
        "reportType": "amenity_issue",
        "description": "Water dispenser broken near stand C",
        "geminiCategory": "maintenance",
        "geminiPriority": "high",
        "routedToRole": "facilities_team",
        "status": "open"
    })
    print("Seed complete.")

if __name__ == "__main__":
    seed_demo_data()
