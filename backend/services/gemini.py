import os
import json
import google.generativeai as genai
from typing import Dict, Any

# Ensure we configure if key is present
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# We use SystemInstruction to pass the system prompt context
def get_model(system_instruction: str):
    return genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=system_instruction,
        generation_config={"response_mime_type": "application/json"}
    )

async def generate_road_plan(event_data: Dict[str, Any], gate_road_mapping: Dict[str, Any]) -> Dict[str, Any]:
    system_instruction = (
        "You are an expert crowd management consultant for large sporting venues in India. "
        "You think in terms of safety, flow efficiency, and stampede prevention. Always output valid JSON."
    )
    user_prompt = (
        f"You are planning crowd management for {event_data.get('eventName')} at "
        f"{event_data.get('venueName')}, {event_data.get('venueCity')}. "
        f"The venue is MA Chidambaram Stadium at lat 13.0627, lng 80.2791. "
        f"Expected attendance: {event_data.get('totalCapacity')}. "
        f"Event start: {event_data.get('eventStartTime')}. "
        "Generate a detailed road-blocking and crowd routing plan for real roads near this stadium. "
        "IMPORTANT: For every road and staff position, return REAL geographic coordinates "
        "(lat/lng) that fall ON the actual road near MA Chidambaram Stadium Chennai. "
        "Return JSON with this exact schema: "
        '{ "blockedRoads": [{"roadName": string, "reason": string, '
        '"coords": [[lat, lng], [lat, lng]]}], '
        '"openRoads": [{"roadName": string, "designatedGate": string, "instructions": string, '
        '"coords": [[lat, lng], [lat, lng]]}], '
        '"staffPositions": [{"location": string, "role": string, "count": number, '
        '"lat": number, "lng": number}], '
        '"summary": string }'
    )
    try:
        model = get_model(system_instruction)
        response = await model.generate_content_async(user_prompt)
        import re
        match = re.search(r'\{.*\}', response.text, re.DOTALL)
        text = match.group(0) if match else response.text
        return json.loads(text)
    except Exception as e:
        print(f"Gemini API error in generate_road_plan: {e}")
        return {}

async def generate_batch_schedule(event_data: Dict[str, Any], total_attendees: int, transport_capacity: int) -> Dict[str, Any]:
    system_instruction = (
        "You are an expert event operations planner. Generate batch schedules that prevent "
        "simultaneous crowd surges at gates. Always output valid JSON. Batch sizes should be between 100 and 200 people."
    )
    user_prompt = (
        f"Plan batch entry and exit scheduling for {event_data.get('eventName')}. "
        f"Total attendees: {total_attendees}. "
        f"Number of gates: {len(event_data.get('gates', []))}. "
        f"Gate capacities: {[{g['gateId']: g['capacity']} for g in event_data.get('gates', [])]}. "
        f"Event start: {event_data.get('eventStartTime')}. "
        f"Event end (estimated): {event_data.get('eventEndTime', 'TBD')}. "
        f"Transport capacity per trip: {transport_capacity}. "
        f"Number of gathering zones: {len(event_data.get('gatheringZones', []))}. "
        "Generate a complete batch schedule. Return JSON with: "
        '{ "batches": [{ "batchCode": string, "gateId": string, "gatheringZoneId": string, '
        '"size": number, "entryWindowStart": "HH:MM", "entryWindowEnd": "HH:MM", '
        '"exitWindowStart": "HH:MM", "exitWindowEnd": "HH:MM", "transportDepartureTime": "HH:MM" }], '
        '"summary": string }'
    )
    try:
        model = get_model(system_instruction)
        response = await model.generate_content_async(user_prompt)
        return json.loads(response.text)
    except Exception as e:
        print(f"Gemini API error in generate_batch_schedule: {e}")
        return {}

async def analyse_density(density_snapshot: Dict[str, Any], match_state: str) -> Dict[str, Any]:
    system_instruction = (
        "You are an AI operations co-pilot for a live sporting event. "
        "Analyse crowd density data and predict congestion before it happens. "
        "Be specific about time estimates. Always output valid JSON."
    )
    user_prompt = (
        f"Live crowd data for {density_snapshot.get('eventId')} at {density_snapshot.get('timestamp')}. "
        f"Match state: {match_state}. "
        f"Zone density: {density_snapshot.get('zoneData')}. "
        "Each zone has: headcount in last 5 minutes, rate of change per minute (positive = growing), gate capacity. "
        "Predict congestion for the next 15 minutes. Return JSON with: "
        '{ "predictions": [{ "zoneId": string, "predictedPeakMinutes": number, "confidence": number (0-1), '
        '"severity": "low"|"medium"|"high"|"critical", "recommendedAction": string }], '
        '"redirectAdvisories": [{ "fromZoneId": string, "toZoneId": string, "messageToAttendees": string, '
        '"targetRadiusMeters": number }], '
        '"staffInstructions": [{ "instruction": string, "zone": string, "urgency": "low"|"medium"|"high" }], '
        '"summary": string }'
    )
    try:
        model = get_model(system_instruction)
        response = await model.generate_content_async(user_prompt)
        return json.loads(response.text)
    except Exception as e:
        print(f"Gemini API error in analyse_density: {e}")
        return {}

async def categorise_incident(report_data: Dict[str, Any]) -> Dict[str, Any]:
    system_instruction = (
        "You are an operations triage assistant at a sporting venue. "
        "Classify incoming incident reports and route them to the right team. Always output valid JSON."
    )
    user_prompt = (
        f"Incident report at {report_data.get('eventId')}. "
        f"Time: {report_data.get('createdAt')}. "
        f"Reporter location: {report_data.get('location')}. "
        f"Report type: {report_data.get('reportType')}. "
        f"Description: {report_data.get('description')}. "
        f"Amenity affected (if any): {report_data.get('amenityId', 'None')}. "
        f"Issue type (if any): {report_data.get('issueType', 'None')}. "
        "Classify this report. Return JSON with: "
        '{ "category": "medical"|"security"|"maintenance"|"operations"|"fire"|"crowd_safety", '
        '"priority": "low"|"medium"|"high"|"urgent", '
        '"routedToRole": "medical_team"|"security"|"maintenance"|"operations_manager", '
        '"actionRequired": string, "estimatedResponseTime": string }'
    )
    try:
        model = get_model(system_instruction)
        response = await model.generate_content_async(user_prompt)
        return json.loads(response.text)
    except Exception as e:
        print(f"Gemini API error in categorise_incident: {e}")
        return {}
