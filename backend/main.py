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
