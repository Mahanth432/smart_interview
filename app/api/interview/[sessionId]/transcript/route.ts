import { NextRequest, NextResponse } from "next/server";
import { getValidatedAppSession } from "@/lib/auth-server";
import prisma from "@/lib/db";
import { sanitizeReportForRole } from "@/lib/report-privacy";

import { formatInterviewerName } from "@/lib/formatters";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const res = NextResponse.json({});
    const userSession = await getValidatedAppSession(req as unknown as Request, res as unknown as Response);

    if (!userSession?.isLoggedIn || !userSession?.userId) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }

    const resolvedParams = await params;
    const sessionId = resolvedParams.sessionId;

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
    }

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        candidate: true,
        interviewer: {
          select: {
            id: true,
            username: true,
            email: true,
            candidate: { select: { name: true } }
          },
        },
        report: true,
        questions: {
          include: {
            answer: {
              include: {
                evaluation: true,
              },
            },
          },
          orderBy: {
            askedAt: "asc",
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Interview session not found" }, { status: 404 });
    }

    // Strict server-side ownership authorization
    const isOwner =
      userSession.role === "ADMIN" ||
      session.interviewerId === userSession.userId ||
      (session.candidate?.userId !== null && session.candidate?.userId === userSession.userId);

    if (!isOwner) {
      return NextResponse.json(
        { error: "Forbidden: You do not have permission to view this interview transcript." },
        { status: 403 }
      );
    }

    if (userSession.role === "CANDIDATE" && session.status !== "completed") {
      return NextResponse.json(
        { error: "Transcript is available only after the interview is completed." },
        { status: 403 }
      );
    }

    const questions = session.questions.map((q) => ({
      questionId: q.id,
      questionNumber: q.questionNumber,
      topic: q.topic,
      difficulty: q.difficulty,
      question: q.content,
      type: q.type,
      answer: q.answer?.transcript || null,
      answeredAt: q.answer?.answeredAt || null,
      evaluation: q.answer?.evaluation
        ? {
            score: q.answer.evaluation.score,
            correctness: q.answer.evaluation.correctness,
            completeness: q.answer.evaluation.completeness,
            technicalAccuracy: q.answer.evaluation.technicalAccuracy,
            feedback: q.answer.evaluation.feedback,
            mentionedKeywords: q.answer.evaluation.mentionedKeywords,
            missingKeywords: q.answer.evaluation.missingKeywords,
          }
        : null,
    }));

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        difficulty: session.difficulty,
        interviewType: session.interviewType,
        scope: session.scope,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        score: session.score,
      },
      candidate: {
        id: session.candidate.id,
        name: session.candidate.name,
        email: session.candidate.email,
      },
      interviewer: {
        id: session.interviewer?.id || null,
        username: formatInterviewerName(session.interviewer),
      },
      report: sanitizeReportForRole(session.report, userSession.role),
      questions,
    });
  } catch (err: unknown) {
    console.error("Transcript API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
