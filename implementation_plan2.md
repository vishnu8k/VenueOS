# Phase 10: Production Deployment Packaging

Since the judges must evaluate the project purely by navigating to your **Cloud Run URL**, we must pivot the architecture from local isolation into a fully integrated package. The FastAPI backend must be upgraded to serve both its REST API *and* host your frontend HTML files simultaneously.

## User Review Required

> [!IMPORTANT]  
> **API Wiring Decision**
> How deep do you want the frontend-to-backend integration to go?
> 
> **Option A (Safe Mock & Host):** I simply mount your existing Frontends into FastAPI. The judges visit your Cloud Run URL and see the beautiful UI, but all processes (like generating batches) use the safe Javascript simulation we built. This guarantees a smooth demo with zero risk of database/API crashes during grading.
> 
> **Option B (Full API Wiring):** I rewrite your Frontend Javascript to actually `fetch()` the endpoints in `/api/v1/...` and wait for the real Python Server to run Gemini logic. This proves full system integration, but runs the risk of a crash if your Cloud Run default service account doesn't load identical to your local machine.
> 
> *Which option do you prefer?*

## Proposed Changes

### 1. Docker Build Context Changes
We must change the Cloud Build context from the `./backend` directory to the root `.` directory, ensuring the frontend folders are pulled into the container image.

#### [MODIFY] [backend/Dockerfile](file:///e:/Prompt%20Wars/Project%201/backend/Dockerfile)
- Update Dockerfile to `COPY frontend-organiser` and `frontend-attendee` into the container.

#### [MODIFY] [deploy.sh](file:///e:/Prompt%20Wars/Project%201/deploy.sh) & [cloudbuild.yaml](file:///e:/Prompt%20Wars/Project%201/cloudbuild.yaml)
- Shift build parameter from `./backend` to `.` specifying `-f backend/Dockerfile`.

---

### 2. FastAPI Static Hosting

#### [MODIFY] [backend/main.py](file:///e:/Prompt%20Wars/Project%201/backend/main.py)
- Import `from fastapi.staticfiles import StaticFiles`.
- Mount `/organiser` -> `frontend-organiser`
- Mount `/attendee` -> `frontend-attendee`
- Add a root target `/` that gives a simple landing page pointing to both entryways so judges don't just see a raw `{status: ok}` JSON file.

---

## Open Questions
- Do you have a preference between **Option A (Safe)** and **Option B (Full API Wire)**? 
- Will you be deploying utilizing Google Cloud Application Default Credentials, or are you injecting the `.env` Service Account keys manually?

## Verification Plan
1. Ensure `python backend/main.py` (or `uvicorn`) locally serves `/organiser` correctly without CORS stripping local assets.
2. Verify `deploy.sh` builds the expanded image successfully.
