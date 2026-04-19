import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

# Ensure repo root is on sys.path when running as a file path.
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from backend.services.gemini import generate_road_plan


async def main() -> None:
    load_dotenv(".env.local")

    evt = {
        "eventName": "CSK vs MI 2026",
        "totalCapacity": 50000,
        "eventStartTime": "19:30",
    }
    plan = await generate_road_plan(evt, {})

    print("keys:", sorted(plan.keys()))
    print("blockedRoads:", len(plan.get("blockedRoads") or []))
    print("openRoads:", len(plan.get("openRoads") or []))
    print("gates:", len(plan.get("gates") or []))
    print("staffPositions:", len(plan.get("staffPositions") or []))
    br = plan.get("blockedRoads") or []
    if br:
        coords = br[0].get("coords")
        print("blockedRoads[0].coords type:", type(coords).__name__)
        print("blockedRoads[0].coords value:", coords)


if __name__ == "__main__":
    asyncio.run(main())
