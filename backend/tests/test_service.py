import os
import json
import base64
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
import httpx

from backend.main import app, compress_image_base64
from backend.featherless.service import FeatherlessService
from backend.neo4j_client import Neo4jClient
from backend.masumi.agent import MasumiOrchestrator

# Initialize test client
client = TestClient(app)

# Helper to create a dummy 1x1 pixel base64 image string for testing
DUMMY_IMAGE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

@pytest.fixture
def mock_featherless_env(monkeypatch):
    monkeypatch.setenv("FEATHERLESS_API_KEY", "test_api_key_123")
    monkeypatch.setenv("FEATHERLESS_API_BASE", "https://api.featherless.ai/v1")

def test_compress_image_base64():
    """Verify that image compression runs and outputs a valid base64 string."""
    compressed = compress_image_base64(DUMMY_IMAGE_B64)
    assert isinstance(compressed, str)
    assert len(compressed) > 0

# --- Featherless Service Tests ---

@patch("backend.featherless.service.httpx.Client")
def test_featherless_service_extract_substances_success(mock_client_class, mock_featherless_env):
    """Test successful OCR extraction from image."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({
                        "substances": ["Cadmium", "Phosphonates"],
                        "confidence": 0.85
                    })
                }
            }
        ]
    }
    
    mock_client = MagicMock()
    mock_client.post.return_value = mock_response
    mock_client_class.return_value.__enter__.return_value = mock_client
    
    service = FeatherlessService()
    substances, confidence, error = service.extract_substances(DUMMY_IMAGE_B64)
    
    assert not error
    assert substances == ["Cadmium", "Phosphonates"]
    assert confidence == 0.85

@patch("backend.featherless.service.httpx.Client")
def test_featherless_service_extract_substances_timeout(mock_client_class, mock_featherless_env):
    """Test graceful handling of Featherless API timeout."""
    mock_client = MagicMock()
    mock_client.post.side_effect = httpx.TimeoutException("API timeout after 30s")
    mock_client_class.return_value.__enter__.return_value = mock_client
    
    service = FeatherlessService()
    substances, confidence, error = service.extract_substances(DUMMY_IMAGE_B64)
    
    assert error
    assert substances == []
    assert confidence == 0.0

def test_featherless_service_generate_tts_warning():
    """Test generating a static audio warning MP3 using gTTS."""
    service = FeatherlessService()
    
    # Test Swahili HIGH risk
    url_sw = service.generate_tts_warning("HIGH", ["Cadmium"], "sw")
    assert url_sw.startswith("/static/audio/")
    assert url_sw.endswith(".mp3")
    
    # Check that file exists on disk
    filename = url_sw.split("/")[-1]
    filepath = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "audio", filename)
    assert os.path.exists(filepath)
    
    # Cleanup file
    if os.path.exists(filepath):
        os.remove(filepath)
        
    # Test Kikuyu LOW risk
    url_ki = service.generate_tts_warning("LOW", [], "ki")
    assert url_ki.startswith("/static/audio/")
    assert url_ki.endswith(".mp3")
    
    filename_ki = url_ki.split("/")[-1]
    filepath_ki = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "audio", filename_ki)
    assert os.path.exists(filepath_ki)
    
    # Cleanup file
    if os.path.exists(filepath_ki):
        os.remove(filepath_ki)

# --- Neo4j Client Tests ---

def test_neo4j_client_check_substance_fallback():
    """Test local fallback catalog when Neo4j credentials are not provided."""
    # Ensure client falls back since we are passing empty credentials
    client_local = Neo4jClient()
    
    # Test high risk regulated substance
    res_cadmium = client_local.check_substance("Cadmium")
    assert res_cadmium["regulated"] is True
    assert res_cadmium["risk_level"] == "HIGH"
    assert "Organic Compost" in res_cadmium["alternatives"]
    
    # Test low risk non-regulated substance
    res_nitrogen = client_local.check_substance("Nitrogen")
    assert res_nitrogen["regulated"] is False
    assert res_nitrogen["risk_level"] == "LOW"
    
    # Test unknown substance
    res_unknown = client_local.check_substance("RandomUnknownSubstance")
    assert res_unknown["regulated"] is False
    assert res_unknown["risk_level"] == "LOW"
    assert res_unknown["alternatives"] == []

# --- Masumi Orchestrator Tests ---

def test_masumi_orchestrator_calculate_score():
    """Verify Export Ready Score deduction calculations."""
    service = FeatherlessService()
    db_client = Neo4jClient()
    orch = MasumiOrchestrator(service, db_client)
    
    # 1. Clear compliant substances -> score 100
    score_1 = orch.calculate_export_ready_score([
        {"risk_level": "LOW", "regulated": False},
        {"risk_level": "LOW", "regulated": False}
    ])
    assert score_1 == 100
    
    # 2. One HIGH risk regulated (Cadmium: -45) -> score 55
    score_2 = orch.calculate_export_ready_score([
        {"risk_level": "HIGH", "regulated": True},
        {"risk_level": "LOW", "regulated": False}
    ])
    assert score_2 == 55
    
    # 3. Two HIGH risk regulated (-90) -> score 10
    score_3 = orch.calculate_export_ready_score([
        {"risk_level": "HIGH", "regulated": True},
        {"risk_level": "HIGH", "regulated": True}
    ])
    assert score_3 == 10
    
    # 4. Underflow cap at 0
    score_4 = orch.calculate_export_ready_score([
        {"risk_level": "HIGH", "regulated": True},
        {"risk_level": "HIGH", "regulated": True},
        {"risk_level": "HIGH", "regulated": True}
    ])
    assert score_4 == 0

@patch("backend.featherless.service.FeatherlessService.extract_substances")
def test_masumi_orchestrator_check_risk_from_image_low_confidence(mock_ocr):
    """Verify escalation to manual review when OCR confidence is under 70%."""
    mock_ocr.return_value = (["Cadmium"], 0.65, False)
    
    service = FeatherlessService()
    db_client = Neo4jClient()
    orch = MasumiOrchestrator(service, db_client)
    
    result = orch.check_risk_from_image(DUMMY_IMAGE_B64, "sw")
    
    assert result["manual_entry_required"] is True
    assert result["risk_level"] == "UNKNOWN"
    assert "Uaminifu: 65%" in result["verdict"]

# --- FastAPI Router & Rate Limiting Tests ---

def test_fastapi_root_endpoint():
    """Verify endpoint description and connection states on root."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Kilimo Trust AI Compliance Backend"
    assert "neo4j_status" in data

def test_fastapi_check_risk_substances():
    """Test compliance risk check endpoint with raw substances input."""
    payload = {
        "substances": ["Nitrogen", "Cadmium"],
        "language": "sw"
    }
    response = client.post("/check-risk", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    assert data["manual_entry_required"] is False
    assert data["risk_level"] == "HIGH"
    assert data["export_ready_score"] == 55
    assert len(data["substance_details"]) == 2
    assert data["voice_url"].endswith(".mp3")
    
    # Cleanup static warning audio file generated by this test
    filename = data["voice_url"].split("/")[-1]
    filepath = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "audio", filename)
    if os.path.exists(filepath):
        os.remove(filepath)

def test_fastapi_expert_review():
    """Test simulated expert review escalation endpoint."""
    payload = {
        "substances": ["Cadmium"],
        "notes": "Low contrast label image."
    }
    response = client.post("/expert-review", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "under_review"
    assert "ticket_id" in data

def test_fastapi_check_risk_rate_limiter():
    """Ensure endpoint rate limiting triggers HTTP 429 on the 11th request in a minute."""
    # Reset in-memory rate limits for testing
    from backend.main import rate_limits
    rate_limits.clear()
    
    payload = {
        "substances": ["Potassium"],
        "language": "sw"
    }
    
    # Fire 10 fast requests (all should pass)
    for _ in range(10):
        response = client.post("/check-risk", json=payload)
        assert response.status_code == 200
        
        # Cleanup audio files generated
        data = response.json()
        filename = data["voice_url"].split("/")[-1]
        filepath = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "audio", filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            
    # The 11th request must trigger HTTP 429
    response = client.post("/check-risk", json=payload)
    assert response.status_code == 429
    assert response.json()["detail"] == "Rate limit exceeded. Maximum 10 requests per minute."
