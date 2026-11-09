import os
import tempfile
import logging
import hmac
from typing import Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

try:
    from dotenv import load_dotenv
    # Load .env.local first if it exists, then .env
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_local = os.path.join(base_dir, ".env.local")
    env_main = os.path.join(base_dir, ".env")
    if os.path.exists(env_local):
        load_dotenv(env_local)
    if os.path.exists(env_main):
        load_dotenv(env_main)
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper-service")

# === Environment & Startup Configuration ===
# WHISPER_ENV: "development" | "production"
WHISPER_ENV = os.getenv("WHISPER_ENV", os.getenv("NODE_ENV", os.getenv("ENV", "development"))).lower().strip()
if not WHISPER_ENV:
    WHISPER_ENV = "development"

def validate_startup_config() -> str:
    """
    Validates that WHISPER_API_SECRET is configured.
    Refuses to start in ALL environments (development and production) if WHISPER_API_SECRET is missing.
    No hardcoded development fallback secrets are permitted.
    """
    secret = os.getenv("WHISPER_API_SECRET", "").strip()
    if not secret:
        logger.critical(
            f"FATAL: WHISPER_API_SECRET is not configured (WHISPER_ENV='{WHISPER_ENV}')! "
            "Refusing to start Whisper service. Configure WHISPER_API_SECRET in .env.local or environment."
        )
        raise RuntimeError(
            f"FATAL: WHISPER_API_SECRET environment variable is missing (WHISPER_ENV='{WHISPER_ENV}'). "
            "A strong shared secret must be configured in all environments."
        )
    return secret

# Validate immediately at import/boot time: fails closed in every environment
validate_startup_config()

app = FastAPI(
    title="Local Whisper Speech-to-Text Service",
    description="Internal transcription service with server-to-server authentication, size limits, and privacy protection",
    version="2.2.0",
)

@app.on_event("startup")
def on_startup():
    """FastAPI startup hook to re-verify environment integrity on application initialization."""
    validate_startup_config()
    logger.info(f"Whisper service startup configuration verified (WHISPER_ENV='{WHISPER_ENV}').")

# === Request Size Limiting Middleware ===
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25MB

class RequestSizeLimitMiddleware:
    """
    Pure ASGI middleware that rejects oversized payloads before multipart parsing.
    Checks Content-Length header upfront and limits streamed chunk sizes to prevent
    unbounded memory or disk spooling attacks.
    """
    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "POST" and scope["path"] == "/transcribe":
            headers = dict(scope.get("headers", []))
            cl_raw = headers.get(b"content-length")

            # 1. Upfront Content-Length rejection (before any body spooling)
            if cl_raw:
                try:
                    content_length = int(cl_raw.decode("latin1"))
                    if content_length > self.max_bytes:
                        logger.warning(f"Rejected oversized upload: Content-Length {content_length} exceeds {self.max_bytes} limit.")
                        resp = JSONResponse(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            content={"detail": "Payload too large: Audio upload exceeds 25MB limit."},
                        )
                        await resp(scope, receive, send)
                        return
                except ValueError:
                    resp = JSONResponse(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        content={"detail": "Invalid Content-Length header."},
                    )
                    await resp(scope, receive, send)
                    return

            # 2. Guard against chunked / streamed oversized uploads without Content-Length
            total_bytes = 0
            async def bounded_receive():
                nonlocal total_bytes
                message = await receive()
                if message.get("type") == "http.request":
                    body = message.get("body", b"")
                    total_bytes += len(body)
                    if total_bytes > self.max_bytes:
                        logger.warning(f"Rejected oversized stream: Received {total_bytes} bytes exceeding {self.max_bytes} limit.")
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Payload too large: Audio upload stream exceeds 25MB limit.",
                        )
                return message

            try:
                await self.app(scope, bounded_receive, send)
            except HTTPException as exc:
                resp = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
                await resp(scope, receive, send)
            return

        await self.app(scope, receive, send)

# Add middleware (executed outermost -> innermost)
app.add_middleware(RequestSizeLimitMiddleware, max_bytes=MAX_AUDIO_BYTES)

# === CORS Configuration ===
# Remove wildcard origins; enforce explicit trusted origins
ALLOWED_ORIGINS_ENV = os.getenv("WHISPER_ALLOWED_ORIGINS", "").strip()
if ALLOWED_ORIGINS_ENV:
    allowed_origins = [orig.strip() for orig in ALLOWED_ORIGINS_ENV.split(",") if orig.strip()]
else:
    # Default trusted origins: local Next.js application dev & prod ports
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Whisper-Secret"],
)

# === Model Initialization ===
MODEL_NAME = os.getenv("WHISPER_MODEL", "tiny.en")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

logger.info(f"Loading local Whisper model '{MODEL_NAME}' on CPU ({COMPUTE_TYPE})...")
try:
    model = WhisperModel(MODEL_NAME, device="cpu", compute_type=COMPUTE_TYPE)
    logger.info("Local Whisper model successfully loaded and ready.")
except Exception as e:
    logger.warning(f"Failed to load with compute_type='{COMPUTE_TYPE}', trying 'default': {e}")
    model = WhisperModel(MODEL_NAME, device="cpu", compute_type="default")
    logger.info("Local Whisper model loaded with default compute type.")


# === Authentication Dependency ===
def verify_whisper_auth(
    x_whisper_secret: Optional[str] = Header(None, alias="X-Whisper-Secret"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> None:
    """
    Validates server-to-server authentication between Next.js and Whisper.
    Supports either 'X-Whisper-Secret' or 'Authorization: Bearer <secret>'.
    Uses constant-time comparison (hmac.compare_digest) to prevent timing side-channel attacks.
    """
    expected_secret = os.getenv("WHISPER_API_SECRET", "").strip()
    if not expected_secret:
        logger.error("WHISPER_API_SECRET is not configured.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Whisper service authentication configuration error.",
        )

    provided_secret: Optional[str] = None
    if x_whisper_secret and x_whisper_secret.strip():
        provided_secret = x_whisper_secret.strip()
    elif authorization and authorization.strip():
        parts = authorization.strip().split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            provided_secret = parts[1]
        elif len(parts) == 1:
            provided_secret = parts[0]

    # Missing credentials -> 401 Unauthorized
    if not provided_secret:
        logger.warning("Unauthorized transcribe request: Missing authentication credentials.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing required authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(provided_secret.encode("utf-8"), expected_secret.encode("utf-8")):
        logger.warning("Forbidden transcribe request: Invalid secret provided.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid authentication credentials.",
        )


@app.get("/health")
def health_check():
    """Public health check endpoint for monitoring and readiness probes."""
    has_secret = bool(os.getenv("WHISPER_API_SECRET", "").strip())
    return {
        "status": "ok",
        "env": WHISPER_ENV,
        "model": MODEL_NAME,
        "device": "cpu",
        "auth_configured": has_secret,
    }


@app.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    _: None = Depends(verify_whisper_auth),
):
    """
    Protected transcription endpoint.
    Requires server-to-server authentication via X-Whisper-Secret or Bearer token.
    Enforces maximum payload size of 25MB.
    Protects candidate privacy: never logs transcript content or leaks internal stack traces.
    """
    if not file:
        raise HTTPException(status_code=400, detail="No audio file uploaded")

    # Save to a temporary file for faster-whisper CTranslate2 reader
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
    if not suffix:
        suffix = ".webm"

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        # Bounded read as defense-in-depth against memory exhaustion
        content = await file.read(MAX_AUDIO_BYTES + 1)
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")
        if len(content) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio file too large (max 25MB)")

        temp_file.write(content)
        temp_file.close()

        logger.info(f"Processing authenticated audio submission ({len(content)} bytes)...")

        # Run local Whisper transcription (English only)
        segments, info = model.transcribe(
            temp_file.name,
            language="en",
            beam_size=1,
            vad_filter=True,
        )

        transcript_text = " ".join([segment.text.strip() for segment in segments]).strip()

        # Operational logging ONLY — candidate transcript content is NEVER logged
        word_count = len(transcript_text.split()) if transcript_text else 0
        logger.info(f"Transcription complete: duration={info.duration:.2f}s, language={info.language}, word_count={word_count}")

        return {
            "text": transcript_text,
            "duration": round(info.duration, 2),
            "language": info.language,
        }
    except HTTPException:
        raise
    except Exception as e:
        # Log exception type on server for diagnostic purposes without leaking audio or transcript
        logger.error(f"Transcription processing error: {type(e).__name__}", exc_info=True)
        # Return generic error to client without exposing filesystem paths or Python stack trace
        raise HTTPException(
            status_code=500,
            detail="Transcription processing failed. Please try again or type your answer.",
        )
    finally:
        # Guarantee temporary file is closed and deleted on Windows & Unix
        try:
            temp_file.close()
        except Exception:
            pass
        if os.path.exists(temp_file.name):
            try:
                os.remove(temp_file.name)
            except Exception as cleanup_err:
                logger.warning(f"Failed to delete temp file {temp_file.name}: {cleanup_err}")


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("WHISPER_HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host=host, port=port)
