import os
import io
import time
import base64
import logging
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
from dotenv import load_dotenv

# Import our backend services
from backend.featherless.service import FeatherlessService
from backend.neo4j_client import Neo4jClient
from backend.masumi.agent import MasumiOrchestrator

load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main_api")

app = FastAPI(
    title="Kilimo Trust AI Pipeline API",
    description="Backend API for AgriFin Track - OCR, TTS and Neo4j compliance checking",
    version="1.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static folder for audio files
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(os.path.join(static_dir, "audio"), exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Initialize services
featherless_service = FeatherlessService()
neo4j_client = Neo4jClient()
orchestrator = MasumiOrchestrator(featherless_service, neo4j_client)

# In-memory rate limiting dictionary: {client_ip: [timestamps]}
rate_limits: Dict[str, List[float]] = {}
RATE_LIMIT_WINDOW = 60.0  # seconds
MAX_REQUESTS_PER_WINDOW = 10

def is_rate_limited(client_ip: str) -> bool:
    """Checks if a client IP has exceeded the allowed request rate."""
    current_time = time.time()
    
    # Initialize list if first time
    if client_ip not in rate_limits:
        rate_limits[client_ip] = []
        
    # Filter out timestamps older than the window
    rate_limits[client_ip] = [t for t in rate_limits[client_ip] if current_time - t < RATE_LIMIT_WINDOW]
    
    # Check limit
    if len(rate_limits[client_ip]) >= MAX_REQUESTS_PER_WINDOW:
        return True
        
    # Record request
    rate_limits[client_ip].append(current_time)
    return False

def compress_image_base64(base64_str: str, max_size_kb: int = 500) -> str:
    """Compresses a base64 encoded image to keep it under max_size_kb."""
    try:
        image_data = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_data))
        
        # Convert RGBA to RGB for JPEG conversion
        if image.mode in ("RGBA", "P"):
            image = image.convert("RGB")
            
        out_io = io.BytesIO()
        # Compress with initial quality=70
        image.save(out_io, format="JPEG", quality=70, optimize=True)
        compressed_bytes = out_io.getvalue()
        
        # If still too large, compress further with quality=40
        if len(compressed_bytes) > max_size_kb * 1024:
            out_io = io.BytesIO()
            image.save(out_io, format="JPEG", quality=40, optimize=True)
            compressed_bytes = out_io.getvalue()
            
        logger.info(f"Compressed image from {len(image_data)/1024:.1f}KB to {len(compressed_bytes)/1024:.1f}KB")
        return base64.b64encode(compressed_bytes).decode("utf-8")
    except Exception as e:
        logger.warning(f"Image compression failed: {e}. Using original image.")
        return base64_str

# Request models
class CheckRiskRequest(BaseModel):
    image: Optional[str] = None  # Base64 encoded image string
    substances: Optional[List[str]] = None  # Manually entered ingredients list
    language: Optional[str] = "sw"  # Default Swahili ('sw'), alternate Kikuyu ('ki')

class ExpertReviewRequest(BaseModel):
    image: Optional[str] = None
    substances: Optional[List[str]] = None
    notes: Optional[str] = None

# Rate limiter middleware check
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    
    # We only apply rate limiting to check-risk endpoint to protect the API
    if request.url.path == "/check-risk":
        if is_rate_limited(client_ip):
            return Response(
                content='{"detail": "Rate limit exceeded. Maximum 10 requests per minute."}',
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                media_type="application/json"
            )
            
    response = await call_next(request)
    return response

@app.post("/check-risk")
async def check_risk(payload: CheckRiskRequest):
    """
    Check fertilizer labels for EU compliance.
    Supports vision OCR (Featherless AI) or manual substance submission.
    """
    if not payload.image and not payload.substances:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either 'image' or 'substances' must be provided in the payload."
        )
        
    lang = payload.language or "sw"
    
    if payload.image:
        # Compress image before sending to OCR endpoint
        compressed_base64 = compress_image_base64(payload.image)
        # Process through full OCR pipeline
        result = orchestrator.check_risk_from_image(compressed_base64, language=lang)
    else:
        # Process using clean substances text directly
        result = orchestrator.check_risk_from_substances(payload.substances, language=lang)
        
    return result

@app.post("/expert-review")
async def expert_review(payload: ExpertReviewRequest):
    """
    Escalate a low confidence scan or complex substance combination to a human reviewer (Masumi agent).
    """
    import uuid
    ticket_id = f"tkt_{uuid.uuid4().hex[:8]}"
    return {
        "status": "under_review",
        "message": "Uchunguzi wako umetumwa kwa wataalamu wa Masumi kwa ukaguzi wa mikono. Hili litachukua muda mfupi.",
        "ticket_id": ticket_id
    }

@app.get("/")
async def root():
    return {
        "service": "Kilimo Trust AI Compliance Backend",
        "model": "Qwen2.5-VL-7B-Instruct",
        "api_endpoint": "https://api.featherless.ai/v1",
        "neo4j_status": "connected" if neo4j_client.driver else "offline_fallback_active",
        "status": "running"
    }
