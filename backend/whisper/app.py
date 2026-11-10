import os
import io
import re
import time
import uuid
import asyncio
import logging
import hmac
import threading
import multiprocessing
from multiprocessing.connection import Connection
from typing import Any, Optional
from fastapi import FastAPI, UploadFile, File, Request, HTTPException, Header, Depends, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

try:
    from dotenv import load_dotenv
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
WHISPER_ENV = os.getenv("WHISPER_ENV", os.getenv("NODE_ENV", os.getenv("ENV", "development"))).lower().strip() or "development"


def validate_startup_config() -> str:
    """
    Validates that WHISPER_API_SECRET is configured.
    Refuses to start in ALL environments if WHISPER_API_SECRET is missing.
    """
    secret = os.getenv("WHISPER_API_SECRET", "").strip()
    if not secret:
        logger.critical(
            f"FATAL: WHISPER_API_SECRET is not configured (WHISPER_ENV='{WHISPER_ENV}')! "
            "Refusing to start Whisper service."
        )
        raise RuntimeError(
            f"FATAL: WHISPER_API_SECRET environment variable is missing (WHISPER_ENV='{WHISPER_ENV}')."
        )
    return secret


validate_startup_config()

# === Validation Constants & Timeout/Resource Limits ===
MAX_AUDIO_BYTES = int(os.getenv("WHISPER_MAX_AUDIO_BYTES", str(4 * 1024 * 1024)))  # 4 MB default
MAX_AUDIO_SECONDS = float(os.getenv("WHISPER_MAX_AUDIO_SECONDS", "180"))  # 3 min max clip
INFERENCE_TIMEOUT_SECONDS = float(os.getenv("WHISPER_INFERENCE_TIMEOUT_SECONDS", "35"))
QUEUE_TIMEOUT_SECONDS = float(os.getenv("WHISPER_QUEUE_TIMEOUT_SECONDS", "5"))

MODEL_NAME = os.getenv("WHISPER_MODEL", "small").strip() or "small"
DEVICE = os.getenv("WHISPER_DEVICE", "cpu").strip() or "cpu"
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"
BEAM_SIZE = max(1, min(int(os.getenv("WHISPER_BEAM_SIZE", "2")), 5))

_raw_default_lang = os.getenv("WHISPER_LANGUAGE", "").strip().lower()
DEFAULT_LANGUAGE: Optional[str] = (
    _raw_default_lang if re.fullmatch(r"[a-z]{2,3}", _raw_default_lang) else None
)

ALLOWED_AUDIO_EXTENSIONS = {
    ".webm",
    ".mp4",
    ".m4a",
    ".ogg",
    ".oga",
    ".wav",
    ".mp3",
    ".mpeg",
    ".flac",
}

ALLOWED_AUDIO_MIME_TYPES = {
    "audio/webm",
    "video/webm",
    "audio/mp4",
    "video/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/ogg",
    "application/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/vnd.wave",
    "audio/mpeg",
    "audio/mp3",
    "audio/flac",
    "audio/x-flac",
}

MIME_TO_EXTENSION = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/mp4": ".mp4",
    "video/mp4": ".mp4",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/ogg": ".ogg",
    "application/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/vnd.wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
}


# === Isolated Single-Inference Worker Process ===
def _whisper_worker_loop(
    conn: Connection,
    model_name: str,
    device: str,
    compute_type: str,
    beam_size: int,
    default_language: Optional[str],
) -> None:
    """
    Runs faster-whisper inside a single isolated subprocess so stalled/long CTranslate2
    decodes can be hard-terminated on timeout or cancellation without duplicating model weights.
    """
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception:
        model = WhisperModel(model_name, device=device, compute_type="default")

    conn.send({"ready": True})

    while True:
        try:
            task = conn.recv()
        except EOFError:
            break

        if task is None:
            break

        req_id = task.get("id")
        audio_array = task["audio"]
        t0 = time.perf_counter()
        try:
            segments, info = model.transcribe(
                audio_array,
                language=default_language,  # None preserves multilingual auto-detection
                beam_size=beam_size,
                vad_filter=True,
                condition_on_previous_text=False,
                no_repeat_ngram_size=4,
                repetition_penalty=1.1,
                max_new_tokens=224,
            )
            transcript_text = " ".join([segment.text.strip() for segment in segments]).strip()
            processing_ms = round((time.perf_counter() - t0) * 1000)
            detected_lang = getattr(info, "language", None) or "unknown"
            lang_prob = round(float(getattr(info, "language_probability", 0.0) or 0.0), 4)
            audio_duration = round(float(getattr(info, "duration", 0.0) or 0.0), 2)

            conn.send({
                "id": req_id,
                "ok": True,
                "text": transcript_text,
                "language": detected_lang,
                "language_probability": lang_prob,
                "duration": audio_duration,
                "processing_ms": processing_ms,
            })
        except Exception as exc:
            conn.send({
                "id": req_id,
                "ok": False,
                "error_type": type(exc).__name__,
            })


class WhisperWorkerManager:
    """
    Thread-safe manager for the single warm inference subprocess.
    Uses a threading.Lock + monotonic generation ID so cancelled or timed-out
    threads can never terminate a newer replacement subprocess, and an asyncio.Lock
    so concurrent requests queue safely or fail cleanly without spawning extra models.
    """

    def __init__(self) -> None:
        self._ctx = multiprocessing.get_context("spawn")
        self._proc: Optional[multiprocessing.Process] = None
        self._parent_conn: Optional[Connection] = None
        self._state_lock = threading.Lock()
        self._generation: int = 0
        self._ready = False
        self._async_lock: Optional[asyncio.Lock] = None

    def _get_async_lock(self) -> asyncio.Lock:
        if self._async_lock is None:
            self._async_lock = asyncio.Lock()
        return self._async_lock

    def _stop_locked(self, expected_generation: Optional[int] = None) -> None:
        if expected_generation is not None and expected_generation != self._generation:
            return

        proc = self._proc
        conn = self._parent_conn
        self._ready = False
        self._proc = None
        self._parent_conn = None
        self._generation += 1

        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

        if proc is not None:
            try:
                if proc.is_alive():
                    proc.terminate()
                    proc.join(timeout=2)
                if proc.is_alive():
                    proc.kill()
                    proc.join(timeout=2)
                proc.close()
            except Exception as err:
                logger.warning(f"Error reaping worker process: {type(err).__name__}")

    def ensure_ready_worker(self) -> tuple[Connection, int]:
        with self._state_lock:
            if (
                self._ready
                and self._proc is not None
                and self._proc.is_alive()
                and self._parent_conn is not None
            ):
                return self._parent_conn, self._generation

            self._stop_locked()
            self._generation += 1
            gen = self._generation

            parent_conn, child_conn = self._ctx.Pipe()
            proc = self._ctx.Process(
                target=_whisper_worker_loop,
                args=(child_conn, MODEL_NAME, DEVICE, COMPUTE_TYPE, BEAM_SIZE, DEFAULT_LANGUAGE),
                daemon=True,
            )
            proc.start()
            child_conn.close()

            self._proc = proc
            self._parent_conn = parent_conn
            logger.info(f"Spawning faster-whisper worker gen={gen} pid={proc.pid} ({MODEL_NAME}, {DEVICE}, {COMPUTE_TYPE})...")

            if not parent_conn.poll(120):
                self._stop_locked(expected_generation=gen)
                raise RuntimeError("Timed out initializing faster-whisper worker process")

            ack = parent_conn.recv()
            if not isinstance(ack, dict) or not ack.get("ready"):
                self._stop_locked(expected_generation=gen)
                raise RuntimeError("Failed to initialize faster-whisper worker process")

            self._ready = True
            logger.info(f"faster-whisper inference worker gen={gen} pid={proc.pid} is warm and ready.")
            return parent_conn, gen

    def start(self) -> None:
        self.ensure_ready_worker()

    def stop(self, expected_generation: Optional[int] = None) -> None:
        with self._state_lock:
            self._stop_locked(expected_generation=expected_generation)

    def is_ready(self) -> bool:
        with self._state_lock:
            return bool(
                self._ready
                and self._proc is not None
                and self._proc.is_alive()
                and self._parent_conn is not None
            )

    def _infer_on_worker(
        self,
        conn: Connection,
        gen: int,
        audio_array: Any,
        timeout_s: float,
    ) -> dict[str, Any]:
        req_id = str(uuid.uuid4())
        conn.send({"id": req_id, "audio": audio_array})

        if not conn.poll(timeout_s):
            logger.warning(
                f"Whisper inference gen={gen} exceeded {timeout_s}s deadline; terminating stalled worker."
            )
            self.stop(expected_generation=gen)
            raise TimeoutError("Speech-to-text inference timed out.")

        reply = conn.recv()
        if not isinstance(reply, dict) or reply.get("id") != req_id:
            self.stop(expected_generation=gen)
            raise EOFError("Mismatched worker response correlation ID.")
        return reply

    async def _watch_disconnect(self, request: Request, interval_s: float = 0.2) -> None:
        while True:
            if await request.is_disconnected():
                return
            await asyncio.sleep(interval_s)

    async def transcribe(
        self,
        audio_array: Any,
        timeout_s: float,
        request: Optional[Request] = None,
    ) -> dict[str, Any]:
        lock = self._get_async_lock()
        try:
            await asyncio.wait_for(lock.acquire(), timeout=QUEUE_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Transcription worker is currently busy. Please retry shortly or enter your answer manually.",
            )

        try:
            if request is not None and await request.is_disconnected():
                raise HTTPException(status_code=499, detail="Client disconnected before inference started.")

            try:
                conn, gen = await asyncio.to_thread(self.ensure_ready_worker)
            except (EOFError, BrokenPipeError, OSError, RuntimeError):
                self.stop()
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Transcription worker unavailable. Please retry or enter your answer manually.",
                )

            infer_task = asyncio.create_task(
                asyncio.to_thread(self._infer_on_worker, conn, gen, audio_array, timeout_s)
            )
            disconnect_task = (
                asyncio.create_task(self._watch_disconnect(request))
                if request is not None
                else None
            )

            try:
                if disconnect_task is None:
                    return await infer_task

                done, _ = await asyncio.wait(
                    {infer_task, disconnect_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if disconnect_task in done and not infer_task.done():
                    logger.info(f"Client disconnected during inference gen={gen}; terminating worker.")
                    self.stop(expected_generation=gen)
                    await asyncio.gather(infer_task, return_exceptions=True)
                    raise HTTPException(status_code=499, detail="Client disconnected during transcription.")

                return await infer_task
            except asyncio.CancelledError:
                self.stop(expected_generation=gen)
                await asyncio.gather(infer_task, return_exceptions=True)
                raise
            except TimeoutError:
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail="Transcription timed out while decoding audio. Please try a shorter recording or enter manually.",
                )
            except (EOFError, BrokenPipeError, OSError, ValueError):
                self.stop(expected_generation=gen)
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Transcription worker restarted. Please retry or enter your answer manually.",
                )
            finally:
                if disconnect_task is not None and not disconnect_task.done():
                    disconnect_task.cancel()
                    await asyncio.gather(disconnect_task, return_exceptions=True)
        finally:
            lock.release()


worker_manager = WhisperWorkerManager()

app = FastAPI(
    title="SmartInterview Whisper Speech-to-Text Service",
    description="Authenticated server-to-server transcription service using faster-whisper",
    version="3.2.0",
)


@app.on_event("startup")
def on_startup():
    validate_startup_config()
    worker_manager.start()
    logger.info(f"Whisper service startup configuration verified (WHISPER_ENV='{WHISPER_ENV}').")


@app.on_event("shutdown")
def on_shutdown():
    worker_manager.stop()


class RequestSizeLimitMiddleware:
    """
    Pure ASGI middleware that rejects oversized /transcribe uploads before multipart spooling.
    """
    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "POST" and scope["path"] == "/transcribe":
            headers = dict(scope.get("headers", []))
            cl_raw = headers.get(b"content-length")
            max_request_bytes = self.max_bytes + 65536

            if cl_raw:
                try:
                    content_length = int(cl_raw.decode("latin1"))
                    if content_length > max_request_bytes:
                        logger.warning(f"Rejected oversized upload: Content-Length {content_length} exceeds limit.")
                        resp = JSONResponse(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            content={"detail": f"Audio upload exceeds maximum size limit ({self.max_bytes // (1024 * 1024)}MB)."},
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

            total_bytes = 0

            async def bounded_receive():
                nonlocal total_bytes
                message = await receive()
                if message.get("type") == "http.request":
                    body = message.get("body", b"")
                    total_bytes += len(body)
                    if total_bytes > max_request_bytes:
                        logger.warning(f"Rejected oversized stream: Received {total_bytes} bytes.")
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"Audio upload stream exceeds maximum size limit ({self.max_bytes // (1024 * 1024)}MB).",
                        )
                return message

            try:
                await self.app(scope, bounded_receive, send)
            except HTTPException as exc:
                resp = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
                await resp(scope, receive, send)
            return

        await self.app(scope, receive, send)


app.add_middleware(RequestSizeLimitMiddleware, max_bytes=MAX_AUDIO_BYTES)

ALLOWED_ORIGINS_ENV = os.getenv("WHISPER_ALLOWED_ORIGINS", "").strip()
if ALLOWED_ORIGINS_ENV:
    allowed_origins = [orig.strip() for orig in ALLOWED_ORIGINS_ENV.split(",") if orig.strip() and orig.strip() != "*"]
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization", "X-Whisper-Secret"],
        )


# === Authentication Dependency ===
def verify_whisper_auth(
    x_whisper_secret: Optional[str] = Header(None, alias="X-Whisper-Secret"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> None:
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

    if not provided_secret:
        logger.warning("Unauthorized transcribe request: Missing authentication credentials.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing required authentication credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not hmac.compare_digest(provided_secret.encode("utf-8"), expected_secret.encode("utf-8")):
        logger.warning("Forbidden transcribe request: Invalid secret provided.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid authentication credentials.",
        )


def validate_audio_descriptor(file: UploadFile) -> str:
    raw_mime = (file.content_type or "").split(";")[0].strip().lower()
    raw_name = os.path.basename((file.filename or "").strip())
    raw_ext = os.path.splitext(raw_name)[1].lower() if raw_name else ""

    if raw_ext and raw_ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio file extension '{raw_ext}'.",
        )

    mime_allowed = raw_mime in ALLOWED_AUDIO_MIME_TYPES
    generic_mime_with_valid_ext = (
        raw_mime in ("", "application/octet-stream") and raw_ext in ALLOWED_AUDIO_EXTENSIONS
    )

    if not mime_allowed and not generic_mime_with_valid_ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio MIME type '{raw_mime or 'unknown'}'.",
        )

    if raw_ext in ALLOWED_AUDIO_EXTENSIONS:
        return raw_ext
    return MIME_TO_EXTENSION.get(raw_mime, ".webm")


def _decode_audio_from_memory(content: bytes) -> Any:
    """Decodes uploaded audio bytes into 16 kHz float32 PCM completely in memory."""
    buf = io.BytesIO(content)
    try:
        return decode_audio(buf, sampling_rate=16000)
    finally:
        buf.close()


@app.get("/health")
def health_check():
    """Health and readiness probe endpoint (never exposes secrets)."""
    has_secret = bool(os.getenv("WHISPER_API_SECRET", "").strip())
    return {
        "status": "ok",
        "env": WHISPER_ENV,
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "multilingual": DEFAULT_LANGUAGE is None,
        "max_audio_bytes": MAX_AUDIO_BYTES,
        "inference_timeout_seconds": INFERENCE_TIMEOUT_SECONDS,
        "worker_ready": worker_manager.is_ready(),
        "auth_configured": has_secret,
    }


@app.post("/transcribe")
async def transcribe_audio(
    request: Request,
    file: UploadFile = File(...),
    _: None = Depends(verify_whisper_auth),
):
    """
    Protected multilingual speech-to-text endpoint.
    Decodes validated audio from an in-memory buffer (no temp audio files left on disk
    on Windows or Linux across cancellation, timeout, or decode failure), closes any
    FastAPI SpooledTemporaryFile cleanly, and runs bounded inference in a single worker process.
    """
    if not file:
        raise HTTPException(status_code=400, detail="No audio file uploaded")

    suffix = validate_audio_descriptor(file)
    try:
        content = await file.read(MAX_AUDIO_BYTES + 1)
    finally:
        try:
            await file.close()
        except Exception as close_err:
            logger.error(f"Failed to close uploaded audio stream cleanly: {type(close_err).__name__}")
            raise RuntimeError(f"Audio upload stream cleanup failed: {type(close_err).__name__}") from close_err

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large (max {MAX_AUDIO_BYTES // (1024 * 1024)}MB)",
        )

    try:
        audio_array = await asyncio.to_thread(_decode_audio_from_memory, content)
    except Exception as decode_err:
        err_name = type(decode_err).__name__
        err_module = type(decode_err).__module__ or ""
        if "av." in err_module or "InvalidData" in err_name or isinstance(decode_err, (ValueError, EOFError)):
            logger.warning(f"Rejected unreadable/corrupt audio upload ({err_name})")
            raise HTTPException(
                status_code=400,
                detail="Invalid or corrupted audio file. Please record again or enter your answer manually.",
            )
        raise

    decoded_seconds = float(len(audio_array)) / 16000.0
    if decoded_seconds < 0.1:
        raise HTTPException(
            status_code=400,
            detail="Audio recording is too short or silent. Please try again or type manually.",
        )
    if decoded_seconds > MAX_AUDIO_SECONDS:
        raise HTTPException(
            status_code=413,
            detail=f"Audio recording exceeds maximum {int(MAX_AUDIO_SECONDS)}s duration limit.",
        )

    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Client disconnected.")

    logger.info(f"Processing authenticated audio submission ({len(content)} bytes, {decoded_seconds:.2f}s, ext={suffix})...")
    result = await worker_manager.transcribe(audio_array, INFERENCE_TIMEOUT_SECONDS, request=request)

    if not result.get("ok"):
        logger.error(f"Worker transcription failed: {result.get('error_type')}")
        raise HTTPException(
            status_code=500,
            detail="Transcription processing failed. Please try again or type your answer.",
        )

    transcript_text = result.get("text", "")
    word_count = len(transcript_text.split()) if transcript_text else 0
    logger.info(
        f"Transcription complete: duration={result['duration']:.2f}s, "
        f"language={result['language']} ({result['language_probability']:.2f}), "
        f"words={word_count}, elapsed_ms={result['processing_ms']}"
    )

    return {
        "text": transcript_text,
        "transcript": transcript_text,
        "language": result["language"],
        "language_probability": result["language_probability"],
        "duration": result["duration"],
        "processing_ms": result["processing_ms"],
    }


if __name__ == "__main__":
    multiprocessing.freeze_support()
    import uvicorn
    host = os.getenv("WHISPER_HOST", "127.0.0.1")
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host=host, port=port)
