export const dynamic = 'force-dynamic';

import React from "react";
import prisma from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAppSession } from "@/lib/auth";
import Icon from "@/components/Icon";
import { formatInterviewerName } from "@/lib/formatters";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  
  const userSession = await getAppSession();
  const userId = userSession.userId;

  if (!userId) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-primary)' }}>
        Unauthorized access. Please log in.
      </div>
    );
  }
  
  const session = await prisma.interviewSession.findUnique({
    where: { id: resolvedParams.id },
    include: {
      candidate: true,
      interviewer: {
        select: {
          username: true,
          email: true,
          candidate: { select: { name: true } }
        }
      },
      report: true,
      questions: {
        include: {
          answer: {
            include: {
              evaluation: true
            }
          }
        },
        orderBy: { askedAt: "asc" }
      },
      gaps: true
    }
  });

  if (!session) return notFound();

  // Strict server-side ownership authorization
  const isOwner =
    userSession.role === 'ADMIN' ||
    session.interviewerId === userId ||
    (session.candidate?.userId !== null && session.candidate?.userId === userId);

  if (!isOwner) return notFound();

  if (userSession.role === 'CANDIDATE') {
    const { createAuditLog } = await import("@/lib/audit-log");
    createAuditLog({
      userId,
      username: userSession.username,
      action: 'CANDIDATE_REPORT_VIEWED',
      entityType: 'InterviewSession',
      entityId: session.id,
      metadata: { candidateId: session.candidateId }
    });
  }

  const scope = (session.scope as { subject?: string; mode?: string } | null);
  const subject = scope?.subject || session.interviewType || 'Technical Interview';
  const mode = scope?.mode || 'standard';
  const interviewerName = formatInterviewerName(session.interviewer);
  const isCompleted = session.status === 'completed';
  const scoreNum = session.score !== null ? session.score : (session.report?.overallScore ?? null);
  const displayScore = scoreNum !== null ? `${scoreNum.toFixed(1)}%` : 'In Progress';

  const backHref = userSession.role === 'CANDIDATE' ? '/candidate' : userSession.role === 'ADMIN' ? '/admin/interviews' : '/dashboard';

  return (
    <div style={{ padding: '2rem', maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
      
      {/* Top Bar / Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
            <h1 className="zentra-page-title" style={{ margin: 0 }}>
              {userSession.role === 'CANDIDATE' ? 'My Interview Performance Report' : `Interview Report: ${session.candidate.name}`}
            </h1>
            <span className={`zentra-badge ${isCompleted ? 'zentra-badge-success' : 'zentra-badge-warning'}`} style={{ textTransform: 'capitalize' }}>
              {session.status}
            </span>
          </div>
          <p className="zentra-page-subtitle" style={{ margin: 0 }}>
            {userSession.role === 'CANDIDATE'
              ? <>Interview conducted on <span style={{ fontWeight: 600 }}>{new Date(session.startedAt).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</span></>
              : <>Session ID: <span style={{ fontFamily: 'monospace' }}>{session.id}</span> &bull; Conducted {new Date(session.startedAt).toLocaleString()}</>
            }
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link
            href="/report"
            prefetch={true}
            className="zentra-btn zentra-btn-secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <Icon name="arrow_back" size={16} />
            <span>All Reports</span>
          </Link>
          <Link
            href={backHref}
            prefetch={true}
            className="zentra-btn zentra-btn-secondary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <span>{userSession.role === 'CANDIDATE' ? 'Candidate Portal' : userSession.role === 'ADMIN' ? 'Interviews' : 'Dashboard'}</span>
          </Link>
        </div>
      </div>

      {/* Overview Metadata Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div className="zentra-card zentra-metric-card">
          <span className="zentra-metric-label">Candidate</span>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-primary)', marginTop: '0.35rem' }}>
            {session.candidate.name}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
            {session.candidate.email || 'Email not registered'}
          </span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <span className="zentra-metric-label">Interviewer</span>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-primary)', marginTop: '0.35rem' }}>
            {interviewerName}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Lead Evaluator</span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <span className="zentra-metric-label">Interview Track</span>
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-text-primary)', marginTop: '0.35rem' }}>
            {subject}
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
            Mode: {mode}
          </span>
        </div>

        <div className="zentra-card zentra-metric-card">
          <span className="zentra-metric-label">Difficulty Level</span>
          <div style={{ marginTop: '0.35rem' }}>
            <span className="zentra-badge zentra-badge-info" style={{ textTransform: 'capitalize', fontSize: '0.85rem', padding: '4px 12px' }}>
              {session.difficulty}
            </span>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '0.35rem', display: 'block' }}>
            {session.questions.length} questions evaluated
          </span>
        </div>

        <div className="zentra-card zentra-metric-card" style={{ background: 'var(--color-bg-secondary)', borderColor: isCompleted ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)' }}>
          <span className="zentra-metric-label">Overall Score</span>
          <div className="zentra-metric-value" style={{ color: isCompleted ? '#10b981' : '#f59e0b' }}>
            {displayScore}
          </div>
          {scoreNum !== null && (
            <div className="striped-progress-bar" style={{ marginTop: '0.5rem', height: '6px' }}>
              <div
                className="striped-progress-fill"
                style={{
                  width: `${Math.min(100, Math.max(0, scoreNum))}%`,
                  background: scoreNum >= 70 ? 'linear-gradient(90deg, #10b981, #059669)' : '#f59e0b',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Executive Report Summary (if report available) */}
      {session.report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
            <div className="zentra-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="description" size={18} style={{ color: '#6366f1' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                  Executive Summary
                </h3>
              </div>
              <p style={{ lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.92rem' }}>
                {session.report.executiveSummary}
              </p>
            </div>

            <div className="zentra-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="trending_up" size={18} style={{ color: '#10b981' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                  Improvement Plan
                </h3>
              </div>
              <p style={{ lineHeight: 1.6, color: 'var(--color-text-secondary)', margin: 0, fontSize: '0.92rem' }}>
                {session.report.improvementPlan}
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
            <div className="zentra-card" style={{ borderLeft: '4px solid #10b981' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="check_circle" size={18} style={{ color: '#10b981' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#10b981' }}>
                  Demonstrated Strengths
                </h3>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--color-text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {session.report.strengths.map((s, i) => (
                  <li key={i} style={{ margin: '0.35rem 0' }}>{s}</li>
                ))}
              </ul>
            </div>
            
            <div className="zentra-card" style={{ borderLeft: '4px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Icon name="warning" size={18} style={{ color: '#ef4444' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#ef4444' }}>
                  Identified Weaknesses &amp; Gaps
                </h3>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--color-text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {session.report.weaknesses.map((w, i) => (
                  <li key={i} style={{ margin: '0.35rem 0' }}>{w}</li>
                ))}
                {session.gaps.map((g, i) => (
                  <li key={`g${i}`} style={{ margin: '0.35rem 0', color: '#ef4444' }}>
                    {g.concept} <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>(Confidence: {g.confidence})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Interview Transcript & Q&A History */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Question &amp; Answer Breakdown
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Comprehensive evaluation of every question asked during this session
            </p>
          </div>
          <span className="zentra-badge zentra-badge-neutral">
            {session.questions.length} question(s)
          </span>
        </div>

        {session.questions.length === 0 ? (
          <div className="zentra-card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', color: 'var(--color-text-muted)' }}>
            <Icon name="help_outline" size={36} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>No questions recorded for this interview session.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {session.questions.map((q) => {
              const hasAnswer = q.answer !== null;
              const evalData = q.answer?.evaluation;
              const score = evalData?.score;

              return (
                <div key={q.id} className="zentra-card" style={{ padding: '1.5rem' }}>
                  {/* Question Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <span className="zentra-badge zentra-badge-info" style={{ fontWeight: 700 }}>
                        Question {q.questionNumber}
                      </span>
                      {q.topic && (
                        <span className="zentra-badge zentra-badge-neutral">
                          {q.topic}
                        </span>
                      )}
                      {q.difficulty && (
                        <span className="zentra-badge zentra-badge-neutral" style={{ textTransform: 'capitalize' }}>
                          {q.difficulty}
                        </span>
                      )}
                    </div>

                    {score !== undefined && score !== null && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Score:</span>
                        <span className={`zentra-badge ${score >= 75 ? 'zentra-badge-success' : score >= 50 ? 'zentra-badge-warning' : 'zentra-badge-error'}`} style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                          {score} / 100
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Question Content */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
                      {q.content}
                    </h4>
                  </div>

                  {/* Candidate Answer Box */}
                  <div style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)', borderRadius: '12px', padding: '1.15rem', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                      {userSession.role === 'CANDIDATE' ? 'Your Response' : 'Candidate Response'}
                    </div>
                    {hasAnswer ? (
                      <p style={{ margin: 0, color: 'var(--color-text-primary)', fontSize: '0.925rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                        {q.answer?.transcript}
                      </p>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', fontSize: '0.875rem', fontStyle: 'italic' }}>
                        <Icon name="hourglass_top" size={16} />
                        <span>Awaiting candidate answer...</span>
                      </div>
                    )}
                  </div>

                  {/* Evaluation Details */}
                  {evalData && (
                    <div style={{ background: 'rgba(99, 102, 241, 0.04)', border: '1px solid rgba(99, 102, 241, 0.12)', borderRadius: '12px', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <Icon name="rate_review" size={16} /> Feedback
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
                        {evalData.correctness && (
                          <div style={{ background: 'var(--color-card-bg)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
                            <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Correctness</span>
                            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{evalData.correctness}</span>
                          </div>
                        )}
                        {evalData.completeness && (
                          <div style={{ background: 'var(--color-card-bg)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
                            <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Completeness</span>
                            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{evalData.completeness}</span>
                          </div>
                        )}
                        {evalData.technicalAccuracy && (
                          <div style={{ background: 'var(--color-card-bg)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
                            <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.75rem', marginBottom: '2px' }}>Technical Accuracy</span>
                            <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{evalData.technicalAccuracy}</span>
                          </div>
                        )}
                      </div>

                      {evalData.feedback && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                          <strong style={{ color: 'var(--color-text-primary)' }}>Feedback: </strong>
                          {evalData.feedback}
                        </div>
                      )}

                      {evalData.mentionedKeywords && evalData.mentionedKeywords.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Mentioned Keywords:</span>
                          {evalData.mentionedKeywords.map((kw, ki) => (
                            <span key={ki} className="zentra-badge zentra-badge-success" style={{ fontSize: '0.75rem' }}>
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}

                      {evalData.missingKeywords && evalData.missingKeywords.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.825rem' }}>
                          <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>Missing Keywords:</span>
                          {evalData.missingKeywords.map((kw, ki) => (
                            <span key={ki} className="zentra-badge zentra-badge-error" style={{ fontSize: '0.75rem' }}>
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
