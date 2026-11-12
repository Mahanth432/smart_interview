import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'
import { verifySameOrigin } from '@/lib/csrf'
import { createAuditLog } from '@/lib/audit-log'
import { enforceRateLimit } from '@/lib/rate-limit'

function normalizeLines(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((item) => String(item).trim()).filter(Boolean)
}

/**
 * PATCH /api/interview/[sessionId]/report
 * Allows authorized interviewers/admins to edit executive feedback & add reviewer notes
 * while permanently preserving the original AI-generated baseline fields and editor metadata.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const csrfError = verifySameOrigin(req)
    if (csrfError) return csrfError
    const res = NextResponse.json({})
    const userSession = await getValidatedAppSession(req, res)
    if (!userSession?.isLoggedIn || !userSession.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (userSession.role === 'CANDIDATE') {
      return NextResponse.json({ error: 'Forbidden: candidates cannot edit reports' }, { status: 403 })
    }

    const rlError = await enforceRateLimit(
      {
        key: `interview:report-edit:user:${userSession.userId}`,
        limit: 40,
        windowSeconds: 15 * 60,
      },
      'Too many report edit requests. Please wait before trying again.'
    )
    if (rlError) return rlError

    const { sessionId } = await context.params
    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { report: true },
    })

    if (!session || !session.report) {
      return NextResponse.json({ error: 'Interview report not found' }, { status: 404 })
    }

    if (userSession.role !== 'ADMIN' && session.interviewerId !== userSession.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const nextExecutiveSummary =
      typeof body.executiveSummary === 'string' && body.executiveSummary.trim()
        ? body.executiveSummary.trim()
        : undefined
    const nextImprovementPlan =
      typeof body.improvementPlan === 'string' && body.improvementPlan.trim()
        ? body.improvementPlan.trim()
        : undefined
    const nextNotes =
      typeof body.interviewerNotes === 'string' ? body.interviewerNotes.trim() : undefined
    const nextStrengths = normalizeLines(body.strengths)
    const nextWeaknesses = normalizeLines(body.weaknesses)

    if (
      nextExecutiveSummary === undefined &&
      nextImprovementPlan === undefined &&
      nextNotes === undefined &&
      nextStrengths === undefined &&
      nextWeaknesses === undefined
    ) {
      return NextResponse.json({ error: 'No valid feedback fields provided' }, { status: 400 })
    }

    const existing = session.report

    const updated = await prisma.interviewReport.update({
      where: { id: existing.id },
      data: {
        // Backfill preserved AI originals if this report was created prior to P2 migration
        aiExecutiveSummary: existing.aiExecutiveSummary ?? existing.executiveSummary,
        aiStrengths: existing.aiStrengths.length > 0 ? existing.aiStrengths : existing.strengths,
        aiWeaknesses: existing.aiWeaknesses.length > 0 ? existing.aiWeaknesses : existing.weaknesses,
        aiImprovementPlan: existing.aiImprovementPlan ?? existing.improvementPlan,
        ...(nextExecutiveSummary !== undefined ? { executiveSummary: nextExecutiveSummary } : {}),
        ...(nextImprovementPlan !== undefined ? { improvementPlan: nextImprovementPlan } : {}),
        ...(nextStrengths !== undefined ? { strengths: nextStrengths } : {}),
        ...(nextWeaknesses !== undefined ? { weaknesses: nextWeaknesses } : {}),
        ...(nextNotes !== undefined ? { interviewerNotes: nextNotes } : {}),
        editedByUserId: userSession.userId,
        editedByName: userSession.username || `User #${userSession.userId}`,
        editedAt: new Date(),
      },
    })

    createAuditLog({
      userId: userSession.userId,
      username: userSession.username,
      action: 'INTERVIEW_REPORT_EDITED',
      entityType: 'InterviewReport',
      entityId: updated.id,
      metadata: { sessionId },
    })

    return NextResponse.json({ success: true, report: updated })
  } catch (err) {
    console.error('Report edit PATCH error:', err)
    return NextResponse.json({ error: 'Failed to update report feedback' }, { status: 500 })
  }
}
