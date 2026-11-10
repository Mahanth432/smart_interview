"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';
import {
  MAX_TRANSCRIBE_AUDIO_BYTES,
  resolveRecordingFilename,
} from '@/lib/audio/validation';

interface CandidateOption {
  id: string;
  name: string;
  email: string | null;
}

interface SessionData {
  id: string;
  candidateId: string;
  candidateName?: string;
}

interface QuestionData {
  id: string;
  content: string;
  questionNumber: number;
  topic?: string;
  difficulty?: string;
  expectedAnswer?: string;
}

interface EvaluationFeedback {
  score: number;
  correctness?: string;
  completeness?: string;
  technicalAccuracy?: string;
  feedback?: string;
  mentionedKeywords?: string[];
  missingKeywords?: string[];
  [key: string]: unknown;
}

interface EvaluationData {
  question: string;
  answer: string;
  feedback?: EvaluationFeedback | null;
}

interface SuggestionData {
  question: string;
  difficulty?: string;
  type?: string;
  reason?: string;
}

interface DocumentData {
  id: number;
  originalFilename: string;
}

export default function InterviewPage() {
  const router = useRouter();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [isResuming, setIsResuming] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Configuration state
  const [candidateList, setCandidateList] = useState<CandidateOption[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('');
  const [candidateNameInput, setCandidateNameInput] = useState<string>('');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [setupMode, setSetupMode] = useState('standard');
  const [setupData, setSetupData] = useState('');

  // Documents state
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);

  // Live session state
  const [session, setSession] = useState<SessionData | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestionData[]>([]);
  const [lastEvaluation, setLastEvaluation] = useState<EvaluationFeedback | null>(null);

  // Audio / STT state
  const [textAnswer, setTextAnswer] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [sttInfo, setSttInfo] = useState<{ language: string | null; duration: number | null; processingMs: number | null } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch Knowledge Base Documents
  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const res = await fetch('/api/documents');
        const data = await res.json();
        if (res.ok) {
          setDocuments(data.documents || []);
        }
      } catch (e) {
        console.error("Failed to fetch documents:", e);
      }
    };
    fetchDocs();
  }, []);

  // Fetch Candidate List for Interviewer Setup
  useEffect(() => {
    const fetchCandidates = async () => {
      try {
        const res = await fetch('/api/admin/candidates?limit=100');
        if (res.ok) {
          const data = await res.json();
          setCandidateList(data.candidates || []);
        }
      } catch (e) {
        console.error("Failed to fetch candidate list:", e);
      }
    };
    fetchCandidates();
  }, []);

  // Check Search Params for pre-selected candidate
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const searchParams = new URLSearchParams(window.location.search);
    const candId = searchParams.get('candidateId');
    const candName = searchParams.get('candidateName');
    if (candId) setSelectedCandidateId(candId);
    if (candName) setCandidateNameInput(candName);
  }, []);

  // Restore Active Session & Enforce Candidate Guard
  useEffect(() => {
    const resumeSession = async () => {
      try {
        const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const querySessionId = searchParams?.get('sessionId');
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('activeInterviewSession') : null;

        let url = '/api/interview/resume';
        if (querySessionId) {
          url += `?sessionId=${encodeURIComponent(querySessionId)}`;
        } else if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed?.id) url += `?sessionId=${encodeURIComponent(parsed.id)}`;
          } catch {
            // ignore JSON parse error
          }
        }

        const res = await fetch(url);
        const data = await res.json();

        if (data?.userRole) {
          setUserRole(data.userRole);
          // STRICT CANDIDATE GUARD: Redirect candidate directly to candidate portal
          if (data.userRole === 'CANDIDATE') {
            router.push('/candidate');
            return;
          }
        }

        if (res.ok && data.activeSession && (data.sessionId || data.session?.id)) {
          const activeId = data.sessionId || data.session?.id;
          const candidateId = data.candidate?.id || data.session?.candidateId || '';
          const candidateName = data.candidate?.name || 'Candidate';

          setSession({ id: activeId, candidateId, candidateName });

          if (data.currentQuestion) {
            setCurrentQuestion(data.currentQuestion);
          }
          if (data.evaluations) {
            setEvaluations(data.evaluations);
            if (data.evaluations.length > 0) {
              setLastEvaluation(data.evaluations[data.evaluations.length - 1].feedback || null);
            }
          }

          const scope = data.session?.scope || {};
          if (scope.mode) setSetupMode(scope.mode);
          if (Array.isArray(scope.selectedDocumentIds)) setSelectedDocIds(scope.selectedDocumentIds);
          if (data.session?.difficulty) setDifficulty(data.session.difficulty);

          localStorage.setItem('activeInterviewSession', JSON.stringify({ id: activeId, candidateId }));
        } else {
          localStorage.removeItem('activeInterviewSession');
        }
      } catch (e) {
        console.error("Resume interview error:", e);
        localStorage.removeItem('activeInterviewSession');
      } finally {
        setIsResuming(false);
      }
    };
    resumeSession();
  }, [router]);

  // Start Live Interview Handler
  const startLiveInterview = async () => {
    let activeCandidateName = candidateNameInput.trim();
    if (selectedCandidateId) {
      const found = candidateList.find(c => c.id === selectedCandidateId);
      if (found) activeCandidateName = found.name;
    }

    if (!activeCandidateName) {
      alert("Please select or enter a candidate name.");
      return;
    }

    if (setupMode === 'knowledge-base' && selectedDocIds.length === 0) {
      alert("Please select at least one Knowledge Base document.");
      return;
    }

    setIsProcessing(true);
    let finalSetupData = setupData;
    if (setupMode === 'knowledge-base' || setupMode === 'knowledge') {
      finalSetupData = JSON.stringify(selectedDocIds);
    }

    try {
      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: selectedCandidateId || undefined,
          candidateName: activeCandidateName,
          difficulty: difficulty,
          mode: setupMode,
          setupData: finalSetupData,
          selectedDocumentIds: selectedDocIds
        })
      });

      const data = await res.json();
      if (!res.ok) {
        alert("Failed to start interview: " + (data.error || "Unknown error"));
        setIsProcessing(false);
        return;
      }

      if (data.sessionId) {
        const newSession = {
          id: data.sessionId,
          candidateId: data.candidate.id,
          candidateName: data.candidate.name || activeCandidateName
        };
        setSession(newSession);
        setCurrentQuestion(data.firstQuestion);
        setEvaluations([]);
        setSuggestedQuestions([]);
        setLastEvaluation(null);
        setTextAnswer("");

        localStorage.setItem('activeInterviewSession', JSON.stringify({ id: data.sessionId, candidateId: data.candidate.id }));
      }
    } catch (error) {
      console.error("Failed to start live interview", error);
      alert("Error initializing interview session.");
    }
    setIsProcessing(false);
  };

  // Submit Answer & Evaluate Handler
  const submitTextAnswer = async () => {
    if (!textAnswer.trim() || !session || !currentQuestion || isProcessing) return;
    setIsProcessing(true);

    try {
      const evalRes = await fetch("/api/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          questionId: currentQuestion?.id,
          transcript: textAnswer
        })
      });

      const evalData = await evalRes.json();
      if (!evalRes.ok) {
        throw new Error(evalData.error || evalData.message || "Failed to evaluate candidate answer");
      }

      const evalFeedback = evalData.evaluation;
      setLastEvaluation(evalFeedback);

      const isDuplicate = evaluations.some(e => e.question === currentQuestion?.content);
      if (!isDuplicate) {
        setEvaluations(prev => [...prev, {
          question: currentQuestion?.content || "",
          answer: textAnswer,
          feedback: evalFeedback
        }]);
      }

      if (evalData.suggestedQuestions && evalData.suggestedQuestions.length > 0) {
        setSuggestedQuestions(evalData.suggestedQuestions);
      } else if (evalData.nextQuestion) {
        setCurrentQuestion(evalData.nextQuestion);
        setTextAnswer("");
        setSttInfo(null);
        setMicError(null);
        setSuggestedQuestions([]);
      } else {
        setSuggestedQuestions([{ question: "Can you elaborate on a practical example of your solution?", difficulty: "medium" }]);
      }
    } catch (error: unknown) {
      console.error("Evaluation failed:", error);
      const msg = error instanceof Error ? error.message : "Unable to submit answer";
      alert("Evaluation failed: " + msg);
    }
    setIsProcessing(false);
  };

  const selectNextQuestion = async (suggestion: SuggestionData) => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/interview/select-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session?.id,
          questionNumber: (currentQuestion?.questionNumber || 0) + 1,
          suggestion
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCurrentQuestion(data.question);
        setSuggestedQuestions([]);
        setTextAnswer("");
        setSttInfo(null);
        setMicError(null);
      } else {
        alert("Failed to load question: " + data.error);
      }
    } catch (e) {
      console.error("Failed to select question", e);
    }
    setIsProcessing(false);
  };

  // End Interview Handler
  const endInterview = async () => {
    if (!session) return;
    if (!window.confirm("End the live interview session and generate the final candidate report?")) {
      return;
    }
    setIsProcessing(true);
    try {
      const res = await fetch("/api/interview/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id })
      });
      const data = await res.json();
      localStorage.removeItem('activeInterviewSession');
      if (data.reportId || session.id) {
        router.push(`/report/${session.id}`);
      } else {
        window.location.reload();
      }
    } catch (e) {
      console.error("Failed to end interview", e);
      localStorage.removeItem('activeInterviewSession');
      window.location.reload();
    }
    setIsProcessing(false);
  };

  // Audio Recording / Whisper STT Integration
  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
      'audio/wav',
    ];
    for (const t of types) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  };

  const startRecording = async () => {
    if (isProcessing || isRecording || isTranscribing) return;
    setMicError(null);
    setSttInfo(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError("Audio recording not supported in this browser. Please type your answer manually.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      let mediaRecorder: MediaRecorder;
      try {
        const options: MediaRecorderOptions = { audioBitsPerSecond: 32_000 };
        if (mimeType) options.mimeType = mimeType;
        mediaRecorder = new MediaRecorder(stream, options);
      } catch {
        mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setRecordingDuration(0);
        setIsRecording(false);
        stream.getTracks().forEach((track) => track.stop());

        const recordedType = mediaRecorder.mimeType || mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: recordedType });
        chunksRef.current = [];

        if (audioBlob.size <= 0) {
          setMicError("No audio was captured. Please try again or type your answer manually.");
          return;
        }

        if (audioBlob.size < 1000) {
          setMicError("Recording was too short. Please speak longer or type your answer manually.");
          return;
        }

        if (audioBlob.size > MAX_TRANSCRIBE_AUDIO_BYTES) {
          setMicError("Recording exceeds the 4 MB upload limit. Please record a shorter segment or enter your answer manually.");
          return;
        }

        setIsTranscribing(true);
        try {
          const filename = resolveRecordingFilename(recordedType);
          const formData = new FormData();
          formData.append('audio', audioBlob, filename);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 50_000);

          let response: Response;
          try {
            response = await fetch('/api/interview/transcribe', {
              method: 'POST',
              body: formData,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeoutId);
          }

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            setMicError(
              data.error ||
                "Speech-to-text transcription failed. You can continue by typing the answer manually."
            );
            return;
          }

          const transcriptText = typeof data.transcript === 'string' ? data.transcript.trim() : '';
          if (transcriptText) {
            setTextAnswer((prev) => {
              const base = prev ? prev.trim() + ' ' : '';
              return base + transcriptText;
            });
            setSttInfo({
              language: typeof data.language === 'string' ? data.language : null,
              duration: typeof data.duration === 'number' ? data.duration : null,
              processingMs: typeof data.processingMs === 'number' ? data.processingMs : null,
            });
          } else {
            setMicError("No clear speech was detected in the recording. Please retry or type manually.");
          }
        } catch (err: unknown) {
          const isAbort = err instanceof Error && err.name === 'AbortError';
          setMicError(
            isAbort
              ? "Transcription timed out. You can enter the candidate's answer manually below."
              : "Unable to reach speech-to-text service. You can type the candidate's answer manually."
          );
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access failed:", err);
      setMicError("Microphone permission denied or device not found.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  if (isResuming) {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--zentra-text-muted)' }}>
          <Icon name="sync" size={32} style={{ marginBottom: '0.75rem', color: '#2563eb' }} />
          <div>Checking for active interview sessions...</div>
        </div>
      </div>
    );
  }

  if (userRole === 'CANDIDATE') {
    return (
      <div className="zentra-page-container">
        <div className="zentra-card" style={{ padding: '4rem', textAlign: 'center' }}>
          <h2>Redirecting to Candidate Results Portal...</h2>
        </div>
      </div>
    );
  }

  const avgScore = evaluations.length > 0
    ? Math.round(evaluations.reduce((sum, ev) => sum + (ev.feedback?.score || 0), 0) / evaluations.length)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px - 40px)', background: 'var(--zentra-bg-canvas)' }}>
      {/* Top Header Row */}
      <div style={{
        padding: '1.25rem 2rem',
        background: 'var(--zentra-bg-surface)',
        borderBottom: '1px solid var(--zentra-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: session ? 'rgba(16, 185, 129, 0.12)' : 'rgba(37, 99, 235, 0.1)',
            color: session ? '#059669' : '#2563eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon name={session ? 'mic' : 'settings_suggest'} size={20} />
          </div>
          <div>
            <h1 style={{ margin: 0, color: 'var(--zentra-text-primary)', fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              {session ? `Live Interview: ${session.candidateName || 'Candidate'}` : 'Live Interviewer Workspace'}
            </h1>
            <p style={{ margin: '0.15rem 0 0 0', color: 'var(--zentra-text-muted)', fontSize: '0.825rem' }}>
              {session ? `Mode: ${setupMode}` : 'Configure and launch adaptive technical assessment.'}
            </p>
          </div>
        </div>

        {session && (
          <button
            onClick={endInterview}
            disabled={isProcessing}
            className="zentra-btn zentra-btn-danger"
          >
            <Icon name="check_circle" size={16} />
            <span>{isProcessing ? 'Finalizing...' : 'End Interview & View Report'}</span>
          </button>
        )}
      </div>

      {/* Main Workspace Grid */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main Content Column */}
        <div style={{ flex: 1, padding: '2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!session ? (
            /* Setup Configuration Card */
            <div className="zentra-card" style={{ maxWidth: '760px', margin: '0 auto', width: '100%', padding: '2.5rem' }}>
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'rgba(37, 99, 235, 0.1)',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1rem auto',
                }}>
                  <Icon name="tune" size={28} />
                </div>
                <h2 style={{ color: 'var(--zentra-text-primary)', margin: '0 0 0.4rem 0', fontSize: '1.5rem', fontWeight: 700 }}>
                  Configure Live Interview
                </h2>
                <p style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                  Select a candidate, target difficulty level, and optional Knowledge Base documents.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Candidate Field */}
                <div>
                  <label style={{ display: 'block', color: 'var(--zentra-text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.45rem' }}>Candidate</label>
                  {candidateList.length > 0 ? (
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <select
                        value={selectedCandidateId}
                        onChange={(e) => {
                          setSelectedCandidateId(e.target.value);
                          const found = candidateList.find(c => c.id === e.target.value);
                          if (found) setCandidateNameInput(found.name);
                        }}
                        className="zentra-select"
                        style={{ flex: 1, minWidth: '220px' }}
                      >
                        <option value="">-- Choose Candidate --</option>
                        {candidateList.map(c => (
                          <option key={c.id} value={c.id}>{c.name} {c.email ? `(${c.email})` : ''}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={candidateNameInput}
                        onChange={(e) => { setCandidateNameInput(e.target.value); setSelectedCandidateId(''); }}
                        placeholder="Or enter candidate name..."
                        className="zentra-input"
                        style={{ flex: 1, minWidth: '200px' }}
                      />
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={candidateNameInput}
                      onChange={(e) => setCandidateNameInput(e.target.value)}
                      placeholder="e.g. Alex Mercer"
                      className="zentra-input"
                    />
                  )}
                </div>

                {/* Difficulty Tier */}
                <div>
                  <label style={{ display: 'block', color: 'var(--zentra-text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.45rem' }}>Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="zentra-select"
                  >
                    <option value="beginner">Beginner (Junior Roles)</option>
                    <option value="intermediate">Intermediate (Mid-Level Roles)</option>
                    <option value="advanced">Advanced (Senior / Architect Roles)</option>
                  </select>
                </div>

                {/* Interview Mode Pills */}
                <div>
                  <label style={{ display: 'block', color: 'var(--zentra-text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Assessment Mode</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {[
                      { id: 'standard', name: 'Standard Adaptive', desc: 'Dynamic AI question curve' },
                      { id: 'keywords', name: 'Keyword Focused', desc: 'Target key concepts' },
                      { id: 'knowledge-base', name: 'Knowledge Base Only', desc: 'Restricted to selected documents' },
                    ].map((mode) => {
                      const isSelected = setupMode === mode.id
                      return (
                        <div
                          key={mode.id}
                          onClick={() => setSetupMode(mode.id)}
                          style={{
                            padding: '1rem',
                            borderRadius: '16px',
                            background: isSelected ? 'rgba(37, 99, 235, 0.08)' : 'var(--zentra-bg-muted)',
                            border: `1.5px solid ${isSelected ? '#2563eb' : 'var(--zentra-border)'}`,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', color: isSelected ? '#2563eb' : 'var(--zentra-text-primary)' }}>
                            {mode.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--zentra-text-muted)', marginTop: '0.2rem' }}>
                            {mode.desc}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Conditional Keyword Input */}
                {setupMode === 'keywords' && (
                  <div>
                    <label style={{ display: 'block', color: 'var(--zentra-text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.45rem' }}>Target Concepts / Keywords</label>
                    <input
                      type="text"
                      value={setupData}
                      onChange={(e) => setSetupData(e.target.value)}
                      placeholder="e.g. System Design, REST APIs, PostgreSQL, Indexing"
                      className="zentra-input"
                    />
                  </div>
                )}

                {/* Conditional Knowledge Base Document Selector */}
                {setupMode === 'knowledge-base' && (
                  <div>
                    <label style={{ display: 'block', color: 'var(--zentra-text-secondary)', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.45rem' }}>Select Knowledge Base Documents</label>
                    {documents.length === 0 ? (
                      <div style={{ color: 'var(--zentra-text-muted)', fontSize: '0.825rem', padding: '1rem', background: 'var(--zentra-bg-muted)', borderRadius: '12px' }}>
                        No documents available. Upload documents in Knowledge Base first.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '160px', overflowY: 'auto', background: 'var(--zentra-bg-muted)', padding: '0.85rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                        {documents.map((doc: DocumentData) => (
                          <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: 'var(--zentra-text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>
                            <input
                              type="checkbox"
                              checked={selectedDocIds.includes(doc.id)}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedDocIds([...selectedDocIds, doc.id]);
                                else setSelectedDocIds(selectedDocIds.filter(id => id !== doc.id));
                              }}
                              style={{ accentColor: '#2563eb' }}
                            />
                            <span>{doc.originalFilename}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}



                {/* Submit Launch Button */}
                <button
                  onClick={startLiveInterview}
                  disabled={isProcessing || (!candidateNameInput.trim() && !selectedCandidateId) || (setupMode === 'knowledge-base' && selectedDocIds.length === 0)}
                  className="zentra-btn zentra-btn-primary"
                  style={{ width: '100%', padding: '0.9rem', fontSize: '0.95rem', justifyContent: 'center', marginTop: '0.5rem' }}
                >
                  <Icon name="play_arrow" size={18} />
                  <span>{isProcessing ? 'Initializing Session...' : 'Launch Live Technical Interview'}</span>
                </button>
              </div>
            </div>
          ) : currentQuestion && (
            /* Live Interview Workspace */
            <>
              {/* Question Card */}
              <div className="zentra-card">
                <div className="zentra-card-header" style={{ marginBottom: '1rem' }}>
                  <span className="zentra-badge info" style={{ fontWeight: 700 }}>
                    QUESTION {currentQuestion.questionNumber}
                  </span>
                  <span className="zentra-pill-tag">
                    {currentQuestion.topic || 'Technical Question'} &bull; <span style={{ textTransform: 'capitalize' }}>{currentQuestion.difficulty || difficulty}</span>
                  </span>
                </div>

                <h2 style={{ color: 'var(--zentra-text-primary)', fontSize: '1.35rem', lineHeight: 1.5, margin: '0 0 1.5rem 0', fontWeight: 600, letterSpacing: '-0.01em' }}>
                  {currentQuestion.content}
                </h2>

                <div style={{ height: '1px', background: 'var(--zentra-border-subtle)', margin: '1.25rem 0' }}></div>

                {/* Candidate Answer Box */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ color: 'var(--zentra-text-primary)', fontSize: '0.875rem', fontWeight: 600 }}>Candidate Response &amp; Transcript</label>
                    <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.75rem' }}>
                      English &amp; Hindi supported (review transcript). Telugu STT is experimental; manual typing recommended.
                    </span>
                  </div>

                  <textarea
                    value={textAnswer}
                    onChange={(e) => setTextAnswer(e.target.value)}
                    placeholder="Enter candidate's answer or click record below..."
                    disabled={isProcessing || isRecording}
                    className="zentra-input"
                    style={{ minHeight: '140px', resize: 'vertical', lineHeight: 1.6 }}
                  />

                  {sttInfo && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--zentra-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {sttInfo.language && <span>Detected language: <strong style={{ textTransform: 'uppercase' }}>{sttInfo.language}</strong></span>}
                        {typeof sttInfo.duration === 'number' && <span>Audio length: <strong>{sttInfo.duration.toFixed(1)}s</strong></span>}
                        {typeof sttInfo.processingMs === 'number' && <span>Transcribed in <strong>{(sttInfo.processingMs / 1000).toFixed(2)}s</strong></span>}
                      </div>
                      {sttInfo.language?.toLowerCase() === 'te' && (
                        <div style={{ color: '#b45309', fontWeight: 500 }}>
                          Telugu transcript is experimental — please review and edit.
                        </div>
                      )}
                    </div>
                  )}

                  {micError && (
                    <div style={{ padding: '0.6rem 1rem', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.08)', color: '#dc2626', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Icon name="warning" size={16} />
                      <span>{micError}</span>
                    </div>
                  )}

                  {/* Action Toolbar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      {isRecording ? (
                        <button
                          onClick={stopRecording}
                          type="button"
                          className="zentra-btn zentra-btn-danger"
                        >
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626', display: 'inline-block' }}></span>
                          <span>Stop Recording ({String(Math.floor(recordingDuration / 60)).padStart(2, '0')}:{String(recordingDuration % 60).padStart(2, '0')})</span>
                        </button>
                      ) : isTranscribing ? (
                        <button disabled type="button" className="zentra-btn zentra-btn-secondary">
                          <Icon name="sync" size={16} />
                          <span>Transcribing with Whisper...</span>
                        </button>
                      ) : (
                        <button
                          onClick={startRecording}
                          disabled={isProcessing}
                          type="button"
                          className="zentra-btn zentra-btn-secondary"
                        >
                          <Icon name="mic" size={16} />
                          <span>Record Answer (Whisper STT)</span>
                        </button>
                      )}

                      {textAnswer.trim().length > 0 && !isRecording && !isTranscribing && (
                        <button
                          onClick={() => { setTextAnswer(''); setSttInfo(null); setMicError(null); }}
                          type="button"
                          className="zentra-btn zentra-btn-secondary"
                          style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <button
                      onClick={submitTextAnswer}
                      disabled={isProcessing || isRecording || isTranscribing || !textAnswer.trim()}
                      className="zentra-btn zentra-btn-primary"
                    >
                      <Icon name="check" size={16} />
                      <span>{isProcessing ? 'Evaluating Answer...' : 'Submit & Evaluate Answer'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Evaluation Panel */}
              {lastEvaluation && (
                <div className="zentra-card" style={{ borderColor: 'rgba(37, 99, 235, 0.25)', background: 'linear-gradient(180deg, rgba(239, 246, 255, 0.5) 0%, rgba(255, 255, 255, 1) 100%)' }}>
                  <div className="zentra-card-header" style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#059669', fontWeight: 700 }}>
                      <Icon name="check_circle" size={18} />
                      <span>Answer Evaluated</span>
                    </div>
                    <span style={{ fontSize: '1.35rem', fontWeight: 800, color: (lastEvaluation.score || 0) >= 75 ? '#059669' : (lastEvaluation.score || 0) >= 50 ? '#d97706' : '#dc2626' }}>
                      {lastEvaluation.score}/100
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    {lastEvaluation.correctness && (
                      <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.85rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                        <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.725rem', fontWeight: 600 }}>Correctness</span>
                        <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 600 }}>{lastEvaluation.correctness}</span>
                      </div>
                    )}
                    {lastEvaluation.completeness && (
                      <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.85rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                        <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.725rem', fontWeight: 600 }}>Completeness</span>
                        <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 600 }}>{lastEvaluation.completeness}</span>
                      </div>
                    )}
                    {lastEvaluation.technicalAccuracy && (
                      <div style={{ background: 'var(--zentra-bg-surface)', padding: '0.85rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                        <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.725rem', fontWeight: 600 }}>Technical Accuracy</span>
                        <span style={{ color: 'var(--zentra-text-primary)', fontWeight: 600 }}>{lastEvaluation.technicalAccuracy}</span>
                      </div>
                    )}
                  </div>

                  {lastEvaluation.feedback && (
                    <div style={{ fontSize: '0.875rem', color: 'var(--zentra-text-secondary)', lineHeight: 1.6, background: 'var(--zentra-bg-surface)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--zentra-border)' }}>
                      <strong style={{ color: 'var(--zentra-text-primary)' }}>Feedback: </strong>
                      {lastEvaluation.feedback}
                    </div>
                  )}
                </div>
              )}

              {/* Follow-up Questions Suggestions */}
              {suggestedQuestions.length > 0 && (
                <div className="zentra-card">
                  <div className="zentra-card-header">
                    <div>
                      <h3 className="zentra-card-title">Adaptive Follow-Up Questions</h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--zentra-text-muted)' }}>Choose next question dynamically adapted to candidate score</span>
                    </div>
                    <span className="zentra-dot-menu">&bull;&bull;&bull;</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {suggestedQuestions.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectNextQuestion(s)}
                        disabled={isProcessing}
                        className="zentra-card"
                        style={{
                          textAlign: 'left',
                          padding: '1.15rem 1.35rem',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        <div style={{ color: 'var(--zentra-text-primary)', fontSize: '0.95rem', fontWeight: 600 }}>{s.question}</div>
                        {s.reason && <div style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}><strong>Adaptive rationale:</strong> {s.reason}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Side Panel: Interview Status & Assistant */}
        <div style={{
          width: '320px',
          background: 'var(--zentra-bg-surface)',
          borderLeft: '1px solid var(--zentra-border)',
          padding: '1.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
          overflowY: 'auto',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <Icon name="smart_toy" size={20} style={{ color: '#2563eb' }} />
              <h3 style={{ margin: 0, color: 'var(--zentra-text-primary)', fontSize: '1rem', fontWeight: 700 }}>Interviewer Assistant</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.775rem', color: 'var(--zentra-text-muted)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: session ? '#10b981' : '#64748b', display: 'inline-block' }}></span>
              <span>{session ? 'Session Active' : 'Waiting for Launch'}</span>
            </div>
          </div>

          {session && (
            <>
              {/* Candidate Pill Card */}
              <div style={{ background: 'var(--zentra-bg-muted)', border: '1px solid var(--zentra-border)', borderRadius: '16px', padding: '1rem' }}>
                <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.725rem', fontWeight: 600, textTransform: 'uppercase' }}>Candidate</span>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--zentra-text-primary)', marginTop: '0.2rem' }}>
                  {session.candidateName || 'Candidate'}
                </div>
              </div>

              {/* Progress & Live Score */}
              <div style={{ background: 'var(--zentra-bg-muted)', border: '1px solid var(--zentra-border)', borderRadius: '16px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>Evaluated</span>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--zentra-text-primary)' }}>{evaluations.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: 'var(--zentra-text-muted)', fontSize: '0.8rem' }}>Live Score</span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 700, color: avgScore >= 75 ? '#059669' : avgScore >= 50 ? '#d97706' : '#dc2626' }}>
                    {evaluations.length > 0 ? `${avgScore}%` : '—'}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Guidelines Box */}
          <div style={{ marginTop: 'auto', background: 'var(--zentra-bg-muted)', border: '1px solid var(--zentra-border)', borderRadius: '16px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem', color: '#2563eb', fontSize: '0.825rem', fontWeight: 600 }}>
              <Icon name="lightbulb" size={16} />
              <span>Interviewer Notice</span>
            </div>
            <div style={{ color: 'var(--zentra-text-secondary)', fontSize: '0.775rem', lineHeight: 1.5 }}>
              Candidate will access results upon evaluation completion. Ask questions and record responses directly.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
