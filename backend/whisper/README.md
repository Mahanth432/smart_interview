# SmartInterview Whisper Speech-to-Text Service

Standalone FastAPI transcription microservice backed by `faster-whisper` (`small`, CPU, `int8`, multilingual automatic language detection).

> **Note:** Vercel Serverless Functions cannot bundle `faster-whisper` / `CTranslate2` or keep the model warm in memory. Deploy this service independently on a Python container host (Railway, Render, Fly.io, Google Cloud Run, or a Docker VM) and wire its URL into Vercel via `WHISPER_SERVICE_URL`.

## Tested Language Support (`small`, CPU, `int8`)
Automatic language detection (`WHISPER_LANGUAGE` unset / `None`) is enabled by default:
- **English**: Supported (`~100%` baseline accuracy on technical speech, ~4.5s warm latency for ~7–8s audio).
- **Hindi**: Supported, with transcript review recommended (~91% baseline accuracy in Devanagari script).
- **Telugu**: Experimental / unreliable with Whisper `small` on CPU (Whisper may output Devanagari transliteration, phonetic errors, or higher decoding latency). Manual text entry or editing the transcript before submission is recommended for Telugu answers.

## Model & Hardware Sizing
- **Model**: `small` (`Systran/faster-whisper-small`, CTranslate2 `int8`)
- **Download size**: **463.69 MB** (cached from Hugging Face / baked into Docker image)
- **Measured process RAM**: ~363 MB idle working set, **~653 MB peak RSS** during CPU `int8` inference
- **Recommended container RAM**: **2 GB minimum** with **1–2 vCPU**

## Worker & Timeout Protection
- Audio is decoded into memory from a temporary file and the temporary file is **deleted immediately before inference begins** (guaranteeing cleanup even on timeouts or client cancellation).
- Inference runs inside a serialized isolated worker process (`WHISPER_INFERENCE_TIMEOUT_SECONDS=35` default, strictly below Next.js's 45s outbound timeout). If a stalled decode exceeds the deadline, the worker is terminated (`HTTP 504`) and respawned cleanly without wedging future requests.

## Required Environment Variables
| Variable | Default | Description |
| :--- | :--- | :--- |
| `WHISPER_API_SECRET` | *(required)* | Shared secret matching Vercel/Next.js `WHISPER_API_SECRET`. Service refuses to boot if unset. |
| `WHISPER_MODEL` | `small` | Whisper model size (`small` recommended; do not use `medium` in <=2 GB CPU containers). |
| `WHISPER_DEVICE` | `cpu` | Inference device (`cpu`). |
| `WHISPER_COMPUTE_TYPE` | `int8` | Quantization (`int8`). |
| `WHISPER_LANGUAGE` | *(unset / None)* | Leave unset for **multilingual automatic language detection**. |
| `WHISPER_MAX_AUDIO_BYTES` | `4194304` | Max accepted audio payload size (4 MB, matching Next.js proxy). |
| `WHISPER_MAX_AUDIO_SECONDS` | `180` | Maximum clip length in seconds before inference. |
| `WHISPER_INFERENCE_TIMEOUT_SECONDS` | `35` | Hard timeout for one inference run before worker reset (`504`). |
| `WHISPER_QUEUE_TIMEOUT_SECONDS` | `5` | Max wait for busy single worker before returning `503`. |
| `WHISPER_BEAM_SIZE` | `2` | Decoding beam size (`1..5`). |

## Run Locally
```bash
cd backend/whisper
pip install -r requirements.txt
set WHISPER_API_SECRET=<your-secret>
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

## Deploy via Docker (Separate from Vercel)
```bash
cd backend/whisper
docker build -t smartinterview-whisper .
docker run -d -p 8000:8000 \
  -e WHISPER_API_SECRET="<strong-random-secret>" \
  -e WHISPER_ENV="production" \
  smartinterview-whisper
```

## Security Recommendations
- Do not expose `/transcribe` without `WHISPER_API_SECRET`.
- In production, prefer private/internal networking, TLS termination, or reverse-proxy IP filtering so only your Next.js backend reaches the FastAPI service.
- Candidate audio is never stored permanently (`Answer.audioPath` remains `null`).
