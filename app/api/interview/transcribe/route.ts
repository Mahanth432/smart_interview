import { NextRequest, NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({});
    const session = await getAppSession(req as unknown as Request, res as unknown as Response);

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = (formData.get("audio") || formData.get("file")) as File | null;

    if (!file) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Audio file too large (max 10MB)" }, { status: 400 });
    }

    // Fail-closed verification: WHISPER_API_SECRET is strictly required in ALL environments
    const whisperSecret = process.env.WHISPER_API_SECRET?.trim();
    if (!whisperSecret) {
      console.error("[Transcribe API] Configuration Error: WHISPER_API_SECRET is missing. Halting request.");
      return NextResponse.json(
        { error: "Transcription service configuration error. Please contact the administrator." },
        { status: 500 }
      );
    }

    const whisperUrl = process.env.WHISPER_SERVICE_URL || "http://127.0.0.1:8000";
    const targetEndpoint = `${whisperUrl.replace(/\/$/, "")}/transcribe`;

    // Forward uploaded audio file to local Python Whisper service
    const outboundData = new FormData();
    outboundData.append("file", file, file.name || "recording.webm");

    // Server-to-server authentication headers
    const whisperHeaders: Record<string, string> = {
      "X-Whisper-Secret": whisperSecret,
      "Authorization": `Bearer ${whisperSecret}`,
    };

    let whisperRes: Response;

    // Phase 1: Attempt outbound request to Whisper service
    try {
      whisperRes = await fetch(targetEndpoint, {
        method: "POST",
        headers: whisperHeaders,
        body: outboundData,
      });
    } catch (netErr) {
      // Network/Connection failure (e.g. ECONNREFUSED, socket hangup, service offline)
      console.warn("[Transcribe API] Local Whisper service unreachable. Attempting cloud fallback:", netErr);
      const fallbackText = await fallbackTranscription(file);
      if (fallbackText) {
        return NextResponse.json({ text: fallbackText, transcript: fallbackText });
      }
      return NextResponse.json(
        { error: "Transcription service is temporarily unavailable. You can type your answer manually." },
        { status: 503 }
      );
    }

    // Phase 2: Inspect response from Whisper service
    if (!whisperRes.ok) {
      const status = whisperRes.status;
      console.error(`[Transcribe API] Whisper service returned HTTP ${status}`);

      // 1. Authentication / Permission errors (HTTP 401 / 403)
      // Strictly FAIL-CLOSED: DO NOT invoke cloud fallback for auth or config errors
      if (status === 401 || status === 403) {
        console.error("[Transcribe API] Authentication failure between Next.js and Whisper. Halting without fallback.");
        return NextResponse.json(
          { error: "Transcription service authentication error. Please contact the administrator." },
          { status: 500 }
        );
      }

      // 2. Client validation errors (HTTP 400 Bad Request, HTTP 413 Payload Too Large)
      // Request is inherently invalid; do not invoke fallback
      if (status === 400 || status === 413) {
        const errJson = await whisperRes.json().catch(() => null);
        const detail = errJson?.detail || (status === 413 ? "Audio file too large." : "Invalid audio upload.");
        return NextResponse.json({ error: detail }, { status });
      }

      // 3. Temporary availability failures (HTTP 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout)
      // Eligible for cloud fallback
      if (status === 502 || status === 503 || status === 504) {
        console.warn(`[Transcribe API] Whisper service reported temporary failure (HTTP ${status}). Attempting cloud fallback.`);
        const fallbackText = await fallbackTranscription(file);
        if (fallbackText) {
          return NextResponse.json({ text: fallbackText, transcript: fallbackText });
        }
      }

      // Default server error
      return NextResponse.json(
        { error: "Transcription service failed to process audio. You can type your answer manually." },
        { status: 503 }
      );
    }

    // Success response
    const data = await whisperRes.json();
    const transcriptText = (data.text || "").trim();

    return NextResponse.json({
      text: transcriptText,
      transcript: transcriptText,
    });
  } catch (error: unknown) {
    console.error("Transcription route error:", error);
    return NextResponse.json(
      { error: "Internal transcription server error. You can type your answer manually." },
      { status: 500 }
    );
  }
}

import { getGenAI } from "@/lib/llm/gemini";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _transcribeModel: any = null;

function getTranscribeModel() {
  if (!_transcribeModel) {
    const genAI = getGenAI();
    _transcribeModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  }
  return _transcribeModel;
}

async function fallbackTranscription(file: File): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  try {
    const model = getTranscribeModel();

    const buffer = await file.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString("base64");
    const rawMime = file.type || "audio/webm";
    const mimeType = rawMime.split(";")[0] || "audio/webm";

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
      "Transcribe the spoken audio accurately. Output only the verbatim transcribed text, without any conversational prefix or commentary.",
    ]);

    const text = result.response.text()?.trim();
    if (text) {
      console.log("[Transcribe API] Fallback to Gemini successful");
      return text;
    }
  } catch (err) {
    console.warn("[Transcribe API] Gemini fallback failed:", err);
  }
  return null;
}
