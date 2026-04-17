# VenueOS
AI-Powered Crowd Lifecycle Management Platform built on FastAPI, Firebase, and Gemini.

## Folder Structure
- `/backend`: FastAPI Python backend
- `/frontend-organiser`: Static HTML/CSS/JS files for desktop dashboard
- `/frontend-attendee`: Static HTML/CSS/JS files for mobile app
- `/functions`: Cloud Functions
- `deploy.sh`: Script to deploy backend to Cloud Run

## Getting Started

1. Set up a GCP Project with Firestore (Native), Firebase Auth (Phone OTP, Google SignIn), and Maps API.
2. Put your secrets into a `.env.local` file at the root.
```env
GEMINI_API_KEY=your_gemini_api_key
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_SERVICE_ACCOUNT_JSON=./service-account.json
HMAC_SECRET=generate_a_random_secure_string_here
GOOGLE_MAPS_API_KEY=your_google_maps_key
CLOUD_STORAGE_BUCKET=your_project_id.appspot.com
ADMIN_EMAILS=comma_separated_admin_emails
STAFF_TOKEN_SECRET=generate_another_random_string_here
```
3. Run backend locally:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```
