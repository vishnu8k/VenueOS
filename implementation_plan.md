# VenueOS Implementation Plan

VenueOS is an AI-powered crowd lifecycle management platform tailored for large-scale sporting events in India, as outlined in the provided hackathon specification. The solution spans a FastAPI backend, a web-based Organiser Dashboard, and a mobile-first Attendee App, all orchestrated by Google Gemini and Firebase.

## User Review Required

> [!IMPORTANT]
> **Firebase & GCP Project Setup:**
> Before the backend can be fully functional, you will need to set up a Firebase project, enable Firestore in Native Mode, and configure Firebase Auth (Phone OTP, Google Auth).
> I will generate the base structure, but you need to provide the `.env.local` configuration for:
> - `GEMINI_API_KEY`
> - `FIREBASE_PROJECT_ID` 
> - `FIREBASE_SERVICE_ACCOUNT_JSON`
> - `HMAC_SECRET`
> - `GOOGLE_MAPS_API_KEY`
> - `CLOUD_STORAGE_BUCKET`
> - `ADMIN_EMAILS`
> - `STAFF_TOKEN_SECRET`
> Please confirm if I should proceed with building the backend with placeholders, or if you will supply these secrets via a `.env.local` file beforehand.

## Proposed Changes

### Phase 1 & 2: Project Scaffold & Firebase Service

We will establish the foundational structure and implement Firestore wrappers for the data models described in section 3.3.

#### [NEW] [backend/main.py](file:///e:/Prompt%20Wars/Project%201/backend/main.py)
Entry point for the FastAPI server, setting up CORS, and registering routers.
#### [NEW] [backend/requirements.txt](file:///e:/Prompt%20Wars/Project%201/backend/requirements.txt)
Dependencies: `fastapi, uvicorn, firebase-admin, google-generativeai, pydantic, python-dotenv, qrcode, pyjwt`.
#### [NEW] [backend/services/firestore.py](file:///e:/Prompt%20Wars/Project%201/backend/services/firestore.py)
Data access layer for reading/writing Events, Attendees, GPS pings, Scan Events, Density Snapshots, and Incident Reports using `firebase-admin`.

---

### Phase 3 & 4: Gemini AI Service & QR Pass System

Implementation of the four core AI workflows and cryptographic QR generation.

#### [NEW] [backend/services/gemini.py](file:///e:/Prompt%20Wars/Project%201/backend/services/gemini.py)
Integrates `google-generativeai` with the exact prompts from section 3.5:
1. Road & Gate Planning
2. Batch & Slot Generation
3. Density Anomaly Detection
4. Incident Report Categorisation
#### [NEW] [backend/services/qr.py](file:///e:/Prompt%20Wars/Project%201/backend/services/qr.py)
Implements HMAC-SHA256 signing for QR payload creation and validation for checkpoint verification logic (booked -> boarded -> perimeter_cleared -> gate_entered -> inside -> exited).

---

### Phase 5: API Routes

Defining the REST endpoints for both organiser & attendee consumption.

#### [NEW] [backend/routers/organiser.py](file:///e:/Prompt%20Wars/Project%201/backend/routers/organiser.py)
Routes for event creation, configuration, Gemini plan generation, batch dispatch management, and staff scanner token generation.
#### [NEW] [backend/routers/attendee.py](file:///e:/Prompt%20Wars/Project%201/backend/routers/attendee.py)
Routes for slot booking, GPS pings, incident reporting, and data fetching for the mobile app map.
#### [NEW] [backend/routers/scanner.py](file:///e:/Prompt%20Wars/Project%201/backend/routers/scanner.py)
Routes for staff QR validation checkpoints. Include token verification middleware for staff access control.

---

### Phase 6: Organiser Dashboard

Building the desktop-first dashboard for venue staff.

#### [NEW] [frontend-organiser/index.html](file:///e:/Prompt%20Wars/Project%201/frontend-organiser/index.html)
SPA entry point with dynamic routing/tab switching.
#### [NEW] [frontend-organiser/css/style.css](file:///e:/Prompt%20Wars/Project%201/frontend-organiser/css/style.css)
Modern styling using rich aesthetics, glassmorphism elements, dynamic design, and modern Google Fonts.
#### [NEW] [frontend-organiser/js/app.js](file:///e:/Prompt%20Wars/Project%201/frontend-organiser/js/app.js)
Logic for map setup, drawing tools, event scheduling, density heatmaps, and interacting with backend APIs.

---

### Phase 7: Attendee Mobile App

Building the mobile-first attendee interface.

#### [NEW] [frontend-attendee/index.html](file:///e:/Prompt%20Wars/Project%201/frontend-attendee/index.html)
Responsive (max-width 420px) SPA entry point.
#### [NEW] [frontend-attendee/css/style.css](file:///e:/Prompt%20Wars/Project%201/frontend-attendee/css/style.css)
Sleek, native-feeling mobile aesthetic. Must use flat, performant CSS—explicitly do NOT use glassmorphism to guarantee smooth performance on budget phones.
#### [NEW] [frontend-attendee/js/app.js](file:///e:/Prompt%20Wars/Project%201/frontend-attendee/js/app.js)
Handles OTP auth flow, QR rendering, Haversine-based perimeter detection logic, mapping, reporting functionality, periodic GPS pinging, and offline scanner caching using localStorage of HMAC-validated payloads for network resilience.

---

### Phase 8 & 9: Cloud Functions & Deployment 

Scripts for deploying to GCP and scheduled operations.

#### [NEW] [functions/main.py](file:///e:/Prompt%20Wars/Project%201/functions/main.py)
Houses the `density_analysis` HTTP function to be triggered by Cloud Scheduler, and the `generate_qr_on_booking` function triggered on Firestore write to attendees (`checkpointStage` == 'booked') to generate and write qrPayload.
#### [NEW] [deploy.sh](file:///e:/Prompt%20Wars/Project%201/deploy.sh)
Bash script for building and pushing the Docker container to GCR, then deploying via `gcloud run`. Also creates a Cloud Scheduler job named 'density-analysis-scheduler' to call the density analysis URL every 60 seconds.
#### [NEW] [cloudbuild.yaml](file:///e:/Prompt%20Wars/Project%201/cloudbuild.yaml)
Cloud Build CI/CD pipeline definition as specified.
#### [NEW] [firestore.indexes.json](file:///e:/Prompt%20Wars/Project%201/firestore.indexes.json) & [firestore.rules](file:///e:/Prompt%20Wars/Project%201/firestore.rules)
Composite index models, role-based security rules, and TTL policy setup for the `gps_pings` collection (using `expireAt` field).
#### [NEW] [seed.py](file:///e:/Prompt%20Wars/Project%201/seed.py)
Script to populate Firestore with demo data (CSK vs MI event, 8 gates, 4 gathering zones, 20 amenities, 200 batches, 5 test attendees, 3 density snapshots, 1 incident report).

## Open Questions Resolved

> [!IMPORTANT]
> **Resolution:** 
> We will proceed with real Firebase credentials. The GCP project will be ready and a `.env.local` file with all secrets will be provided before running. Build the backend assuming the credentials are valid — **do not add stubs or mock implementations.**

## Verification Plan

### Automated/Local Tests
- I will spin up FastAPI locally and test to verify syntax and path configurations are correct without crashing.
- I will verify the static HTML frontend elements map securely via live-server or FastAPI static serving.

### Manual Verification
- We will require adding test records to Firestore (e.g., seeding the CSK vs MI match) and testing both the organiser desktop map functions and attendee mobile UX using placeholder data.
