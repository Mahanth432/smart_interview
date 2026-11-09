import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { generateLLMResponse } from "@/lib/llm";
import { getAppSession } from "@/lib/auth";

const REPORT_GENERATOR_PROMPT = `
You are the KMIT Interview Analytics Engine.
Generate a comprehensive interview report based on the candidate's performance.

RULES:
1. Output strict JSON only.

INPUT DATA:
- Candidate ID: {{candidateId}}
- Total Questions Asked: {{totalQuestions}}
- Average Score: {{averageScore}}
- Knowledge Gaps: {{gaps}}

OUTPUT FORMAT (JSON):
{
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "executiveSummary": "A solid paragraph summarizing performance.",
  "improvementPlan": "Actionable feedback for improvement."
}
`;

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({});
    const userSession = await getAppSession(req as unknown as Request, res as unknown as Response);
    if (!userSession?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { sessionId, forceProvider } = await req.json();

    const session = await prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        candidate: true,
        questions: { include: { answer: { include: { evaluation: true } } } },
        gaps: true
      }
    });

    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isOwner =
      userSession.role === 'ADMIN' ||
      session.interviewerId === userSession.userId ||
      (session.candidate?.userId !== null && session.candidate?.userId === userSession.userId);

    if (!isOwner) return NextResponse.json({ error: "Not found or unauthorized" }, { status: 404 });

    const evals = session.questions.map(q => q.answer?.evaluation).filter(Boolean);
    const avgScore = evals.length > 0 
      ? evals.reduce((sum, e) => sum + (e?.score || 0), 0) / evals.length 
      : 0;

    const gapTexts = session.gaps.map(g => `${g.concept} (${g.evidence})`).join("; ");

    // LLM Provider resolution - ONLY ADMIN users can pass a forced provider for controlled testing
    const adminOverride = userSession.role === 'ADMIN' && forceProvider && (forceProvider === 'gemini' || forceProvider === 'groq')
      ? forceProvider
      : undefined;

    const prompt = REPORT_GENERATOR_PROMPT
      .replace("{{candidateId}}", session.candidateId)
      .replace("{{totalQuestions}}", session.questions.length.toString())
      .replace("{{averageScore}}", avgScore.toFixed(2))
      .replace("{{gaps}}", gapTexts);

    const { text: reportRes } = await generateLLMResponse(prompt + "\n\nOutput JSON only.", adminOverride);
    
    let reportJson: Record<string, unknown> | null = null;
    try {
      reportJson = JSON.parse(reportRes);
    } catch {
      let cleaned = reportRes.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
      cleaned = cleaned.replace(/,\s*([\}\]])/g, "$1");
      try {
        reportJson = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse report JSON:", cleaned);
        reportJson = { executive_summary: "AI could not compile final summary due to JSON parsing error.", strong_topics: [], weak_topics: [], missing_keywords: [], recommended_study: "N/A" };
      }
    }

    const report = await prisma.interviewReport.create({
      data: {
        sessionId: session.id,
        overallScore: avgScore,
        topicScores: {}, // Placeholder
        strengths: (reportJson?.strengths as string[]) || [],
        weaknesses: (reportJson?.weaknesses as string[]) || [],
        executiveSummary: (reportJson?.executiveSummary as string) || "No summary provided.",
        improvementPlan: (reportJson?.improvementPlan as string) || "No plan provided."
      }
    });

    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { status: "completed", endedAt: new Date() }
    });

    const { createAuditLog } = await import("@/lib/audit-log");
    createAuditLog({
      userId: userSession.userId,
      username: userSession.username,
      action: "INTERVIEW_COMPLETED",
      entityType: "InterviewSession",
      entityId: sessionId,
      metadata: { overallScore: avgScore, reportId: report.id }
    });

    return NextResponse.json({ success: true, reportId: report.id });
  } catch (error: unknown) {
    console.error("End interview error:", error);
    const { handleLLMError } = await import("@/lib/llm");
    return handleLLMError(error);
  }
}






