import pytest
from fastapi.testclient import TestClient
from backend.main import app

@pytest.fixture
def client():
    # Instantiate the FastAPI testing client directly over the uncoupled app layer
    with TestClient(app) as c:
        yield c
