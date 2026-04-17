import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Load simple environment variabls for local dev
load_dotenv("../.env.local")

app = FastAPI(title="VenueOS API", version="1.0.0")

# Allow all origins for the hackathon prototype
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "VenueOS Backend is running"}

@app.get("/debug")
async def debug_env():
    import google.generativeai as genai
    gemini_key = os.getenv("GEMINI_API_KEY", "NOT_SET")
    key_preview = gemini_key[:8] + "..." if len(gemini_key) > 8 else gemini_key
    
    # Try a live Gemini ping
    gemini_status = "untested"
    gemini_error = None
    if gemini_key != "NOT_SET" and len(gemini_key) > 10:
        try:
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel(model_name="gemini-2.0-flash")
            resp = await model.generate_content_async("Say OK")
            gemini_status = "working"
        except Exception as e:
            gemini_status = "failed"
            gemini_error = str(e)
    
    return {
        "GEMINI_API_KEY_SET": gemini_key != "NOT_SET",
        "GEMINI_KEY_PREVIEW": key_preview,
        "GEMINI_STATUS": gemini_status,
        "GEMINI_ERROR": gemini_error,
        "FIREBASE_PROJECT_ID": os.getenv("FIREBASE_PROJECT_ID", "NOT_SET"),
    }

@app.get("/debug/models")
async def list_models():
    import google.generativeai as genai
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    if not gemini_key:
        return {"error": "GEMINI_API_KEY not set"}
    try:
        genai.configure(api_key=gemini_key)
        models = [m.name for m in genai.list_models() if "generateContent" in m.supported_generation_methods]
        return {"available_models": models}
    except Exception as e:
        return {"error": str(e)}

from backend.routers.organiser import organiser_router
from backend.routers.attendee import attendee_router
from backend.routers.scanner import scanner_router

app.include_router(organiser_router)
app.include_router(attendee_router)
app.include_router(scanner_router)

# Serve Frontend UIs gracefully mapping to the root directory from Docker
app.mount("/organiser", StaticFiles(directory="frontend-organiser", html=True), name="organiser")
app.mount("/attendee", StaticFiles(directory="frontend-attendee", html=True), name="attendee")

# Redirect root to organiser dashboard for easy judging demo
@app.get("/")
def redirect_root():
    return RedirectResponse(url="/organiser")
