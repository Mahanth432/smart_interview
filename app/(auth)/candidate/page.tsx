export const dynamic = 'force-dynamic'

import React from 'react'
import prisma from '@/lib/db'
import Icon from '@/components/Icon'
import Link from 'next/link'
import { getValidatedAppSession } from '@/lib/auth-server'
import { CandidateViewClient } from '@/components/candidate/CandidateViewClient'
import { CandidateCompareClient } from '@/components/candidate/CandidateCompareClient'

export default async function CandidateProfilePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string; search?: string }>
}) {
  const resolvedParams = searchParams ? await searchParams : {}
  const activeTab = resolvedParams.tab || 'results'
  const searchQuery = resolvedParams.search || ''

  const session = await getValidatedAppSession()
  const userId = session.isLoggedIn ? session.userId : undefined

  if (!userId) {
    return (
      <div style={{ padding: '2rem', color: 'var(--zentra-text-primary)' }}>
        Unauthorized access. Please log in.
      </div>
    )
  }

  // Handle CANDIDATE role view
  if (session.role === 'CANDIDATE') {
    let candidate = await prisma.candidate.findUnique({
      where: { userId: userId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    })

    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: {
          userId: userId,
          name: session.username || 'Candidate',
          email: session.username?.includes('@') ? session.username : null,
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      })
    }

    const [totalInterviews, completedInterviews, _activeInterviews, scoreAgg, sessions] = await Promise.all([
      prisma.interviewSession.count({ where: { candidateId: candidate.id } }),
      prisma.interviewSession.count({ where: { candidateId: candidate.id, status: 'completed' } }),
      prisma.interviewSession.count({ where: { candidateId: candidate.id, status: 'active' } }),
      prisma.interviewSession.aggregate({
        where: { candidateId: candidate.id, score: { not: null } },
        _avg: { score: true },
        _max: { score: true },
      }),
      prisma.interviewSession.findMany({
        where: { candidateId: candidate.id },
        include: {
          interviewer: { select: { username: true, email: true, candidate: { select: { name: true } } } },
          report: { select: { id: true, overallScore: true, executiveSummary: true, strengths: true, weaknesses: true } },
          questions: {
            select: {
              answer: {
                select: { id: true },
              },
            },
          },
        },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
    ])

    const avgScore = scoreAgg._avg.score !== null ? Number(scoreAgg._avg.score.toFixed(1)) : null
    const bestScore = scoreAgg._max.score !== null ? Number(scoreAgg._max.score.toFixed(1)) : null

    return (
      <CandidateViewClient
        initialTab={activeTab}
        totalInterviews={totalInterviews}
        completedInterviews={completedInterviews}
        avgScore={avgScore}
        bestScore={bestScore}
        sessions={sessions}
      />
    )
  }

  // INTERVIEWER / ADMIN Role View (strictly isolated for interviewers)
  const isAdmin = session.role === 'ADMIN'
  const scopeWhere = isAdmin
    ? {}
    : {
        OR: [
          { sessions: { some: { interviewerId: userId } } },
          { userId: { not: null }, sessions: { none: {} } },
        ],
      }
  const searchWhere = searchQuery.trim()
    ? {
        OR: [
          { name: { contains: searchQuery.trim(), mode: 'insensitive' as const } },
          { email: { contains: searchQuery.trim(), mode: 'insensitive' as const } },
        ],
      }
    : undefined

  const candidates = await prisma.candidate.findMany({
    where:
      !isAdmin && searchWhere
        ? { AND: [scopeWhere, searchWhere] }
        : !isAdmin
          ? scopeWhere
          : searchWhere,
    include: {
      user: { select: { username: true } },
      _count: {
        select: {
          sessions: isAdmin ? true : { where: { interviewerId: userId } },
        },
      },
      sessions: {
        where: isAdmin ? undefined : { interviewerId: userId },
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: {
          id: true,
          startedAt: true,
          status: true,
          interviewType: true,
          score: true,
          report: { select: { overallScore: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return (
    <div className="zentra-page-container">
      {/* Header */}
      <div className="zentra-page-header">
        <div>
          <div className="zentra-title-row">
            <h1 className="zentra-page-title">Candidate Management</h1>
            <span className="zentra-link-bubble" title="Candidate Directory">
              <Icon name="link" size={16} />
            </span>
          </div>
          <p className="zentra-page-subtitle">Select a candidate profile to configure and launch a live interview session.</p>
        </div>

        <div className="zentra-header-actions" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <form method="GET" action="/candidate" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              name="search"
              defaultValue={searchQuery}
              placeholder="Search name or email..."
              className="zentra-input"
              style={{ minWidth: '210px' }}
            />
            <button type="submit" className="zentra-btn zentra-btn-secondary">
              <Icon name="search" size={16} />
              <span>Filter</span>
            </button>
          </form>
          <Link href="/interview" className="zentra-btn zentra-btn-primary">
            <Icon name="play_arrow" size={16} />
            <span>Launch Live Interview</span>
          </Link>
        </div>
      </div>

      <CandidateCompareClient
        candidates={candidates.map((c) => ({ id: c.id, name: c.name, email: c.email }))}
      />

      {/* Candidates Grid Card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
        {candidates.length === 0 ? (
          <div className="zentra-card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem 1rem', color: 'var(--zentra-text-muted)' }}>
            <Icon name="person_off" size={40} style={{ opacity: 0.4, marginBottom: '0.75rem' }} />
            <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--zentra-text-primary)' }}>No candidates found</h3>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>You can launch a new interview session directly from the Live Interview section.</p>
          </div>
        ) : (
          candidates.map((cand) => {
            const latestSession = cand.sessions[0] || null
            const latestScore = latestSession ? (latestSession.score ?? latestSession.report?.overallScore) : null

            return (
              <div key={cand.id} className="zentra-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1.25rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem' }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      background: 'var(--zentra-bg-muted)',
                      border: '1px solid var(--zentra-border)',
                      color: 'var(--zentra-text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '1.1rem',
                    }}>
                      {cand.name ? cand.name.charAt(0).toUpperCase() : 'C'}
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--zentra-text-primary)', fontWeight: 600 }}>{cand.name}</h3>
                      <span style={{ fontSize: '0.775rem', color: 'var(--zentra-text-muted)' }}>{cand.email || 'No email registered'}</span>
                    </div>
                  </div>

                  <div style={{ background: 'var(--zentra-bg-muted)', borderRadius: '12px', padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', border: '1px solid var(--zentra-border)' }}>
                    <div>
                      <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.725rem' }}>Sessions</span>
                      <strong style={{ color: 'var(--zentra-text-primary)', fontSize: '0.95rem' }}>{cand._count.sessions}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--zentra-text-muted)', display: 'block', fontSize: '0.725rem' }}>Latest Score</span>
                      <strong style={{
                        color: latestScore !== null && latestScore !== undefined ? (latestScore >= 75 ? '#059669' : latestScore >= 50 ? '#d97706' : '#dc2626') : 'var(--zentra-text-muted)',
                        fontSize: '0.95rem',
                      }}>
                        {latestScore !== null && latestScore !== undefined ? `${latestScore.toFixed(1)}%` : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--zentra-border-subtle)', paddingTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Link
                    href={`/interview?candidateId=${cand.id}&candidateName=${encodeURIComponent(cand.name)}`}
                    className="zentra-btn zentra-btn-primary"
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <Icon name="play_arrow" size={16} />
                    <span>Start Interview</span>
                  </Link>
                  <Link
                    href={`/interview?candidateId=${cand.id}&candidateName=${encodeURIComponent(cand.name)}&mode=revision`}
                    className="zentra-btn zentra-btn-secondary"
                    style={{ justifyContent: 'center' }}
                    title="Launch targeted revision session based on recurring weaknesses"
                  >
                    <Icon name="trending_up" size={15} />
                    <span>Revision</span>
                  </Link>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
