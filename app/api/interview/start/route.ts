import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { generateLLMResponse } from "@/lib/llm";
import { QUESTION_GENERATOR_PROMPT } from "@/lib/llm/prompts";
import { searchChunks } from "@/lib/knowledge-base/searchChunks";
import { createAuditLog } from "@/lib/audit-log";
import { getAppSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { candidateId, candidateName, subject: inputSubject, difficulty, mode, setupData, forceProvider } = await req.json();

    if (!candidateName && !candidateId) {
      return NextResponse.json({ error: "Missing candidate identifier" }, { status: 400 });
    }

    const isKnowledgeMode = mode === "knowledge" || mode === "knowledge-base";
    const subject = inputSubject?.trim() || (isKnowledgeMode ? 'Knowledge Base' : 'General Technical');

    // Get Session to get real userId if available
    const res = NextResponse.json({});
    let userId = null;
    let username = null;
    let userRole = null;
    try {
      const ironSession = await getAppSession(req as unknown as Request, res as unknown as Response);
      if (ironSession?.userId) {
        userId = ironSession.userId;
        username = ironSession.username;
        userRole = ironSession.role;
      }
    } catch {
      console.error("Session fetch failed");
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (userRole === "CANDIDATE") {
      return NextResponse.json(
        { error: "Candidates cannot create interviews. Please join an assigned interview." },
        { status: 403 }
      );
    }

    let selectedDocIds: number[] | undefined = undefined;

    if (isKnowledgeMode) {
      try {
        if (typeof setupData === "string" && setupData.trim()) {
          const parsed = JSON.parse(setupData);
          if (Array.isArray(parsed)) {
            selectedDocIds = parsed.map(id => Number(id)).filter(id => !isNaN(id));
          }
        } else if (Array.isArray(setupData)) {
          selectedDocIds = setupData.map(id => Number(id)).filter(id => !isNaN(id));
        }
      } catch {
        // ignore JSON parse error
      }

      if (!selectedDocIds || selectedDocIds.length === 0) {
        return NextResponse.json({ error: "Please select at least one document for Knowledge Base mode." }, { status: 400 });
      }

      // Verify that all selected documents belong to this user (server-side ownership check)
      const existingDocs = await prisma.document.findMany({
        where: {
          id: { in: selectedDocIds },
          userId: userId,  // CRITICAL: must belong to this user
          storageStatus: 'AVAILABLE',
        },
        select: { id: true }
      });

      if (existingDocs.length === 0) {
        return NextResponse.json({ error: "The selected Knowledge Base documents were not found or are no longer available." }, { status: 400 });
      }

      // Use valid doc IDs only (ignoring any unauthorized IDs)
      selectedDocIds = existingDocs.map(d => d.id);

    }

    let candidate = null;
    if (candidateId) {
      candidate = await prisma.candidate.findUnique({
        where: { id: candidateId }
      });
    }

    if (!candidate && candidateName) {
      candidate = await prisma.candidate.findFirst({
        where: { name: { equals: candidateName, mode: 'insensitive' } }
      });
    }

    if (!candidate) {
      candidate = await prisma.candidate.create({
        data: { name: candidateName || 'Candidate' }
      });
    }

    // LLM Provider resolution - ONLY ADMIN users can pass a forced provider for controlled testing
    const adminForcedProvider = userRole === 'ADMIN' && forceProvider && (forceProvider === 'gemini' || forceProvider === 'groq')
      ? forceProvider
      : undefined;

    // Create Session
    const session = await prisma.interviewSession.create({
      data: {
        candidateId: candidate.id,
        interviewerId: userId,
        status: "active",
        difficulty: difficulty || "medium",
        interviewType: "Adaptive",
        scope: {
          subject: subject,
          mode: mode || "standard",
          setupData: setupData || "",
          selectedDocumentIds: selectedDocIds || null
        }
      }
    });

    // Audit log interview created
    const auditAction = userRole === 'CANDIDATE' ? 'CANDIDATE_INTERVIEW_STARTED' : 'INTERVIEW_CREATED';
    createAuditLog({
      userId,
      username,
      action: auditAction,
      entityType: 'InterviewSession',
      entityId: session.id,
      metadata: { candidateName: candidate.name, subject, mode: mode || 'standard', selectedDocumentIds: selectedDocIds }
    });

    let contextText = "";
    let topicToStart = "Fundamentals";

    if (mode === "keywords" && setupData) {
      // Focus on these keywords
      const searchResults = await searchChunks(`[${subject}] ${setupData}`, userId);
      contextText = "FOCUS STRICTLY ON THESE KEYWORDS: " + setupData + "\n\n" + searchResults.map(r => r.content).join("\n\n");
      topicToStart = "Keyword Focused";
    } else if (isKnowledgeMode) {
      // Focus strictly on the selected uploaded knowledge base documents
      const searchResults = await searchChunks(`[${subject}]`, userId, 20, selectedDocIds);
      contextText = "RESTRICT ALL QUESTIONS STRICTLY TO THE FOLLOWING KNOWLEDGE BASE MATERIAL ONLY. DO NOT ASK ANYTHING OUTSIDE THIS MATERIAL:\n\n" + searchResults.map(r => r.content).join("\n\n");
      topicToStart = "Knowledge Base Based";
    } else {
      // Standard RAG
      const searchResults = await searchChunks(`[${subject}] basics introduction definition core concepts`, userId);
      contextText = searchResults.map(r => r.content).join("\n\n");
    }

    const generatorPrompt = QUESTION_GENERATOR_PROMPT
      .replace("{{subject}}", subject)
      .replace("{{topic}}", topicToStart)
      .replace("{{difficulty}}", "easy")
      .replace("{{context}}", contextText)
      .replace("{{previous_question}}", "None - Starting Interview")
      .replace("{{candidate_answer}}", "None - Starting Interview")
      .replace("{{evaluation_summary}}", "None - Initial Question Generation")
      .replace("{{previous_questions}}", "None")
      .replace("{{earlier_context}}", "None - Interview Just Started")
      .replace("{{weak_concepts}}", "None")
      .replace("{{remaining_concepts}}", "All");

    const { text: nextQResponse } = await generateLLMResponse(generatorPrompt + "\n\nReply in strict JSON format.", adminForcedProvider);
    
    let nextQJson;
    try {
      nextQJson = JSON.parse(nextQResponse);
    } catch {
      const cleaned = nextQResponse.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
      try {
        nextQJson = JSON.parse(cleaned);
      } catch {
        nextQJson = { suggestions: [{ question: "What is an algorithm?", type: "Conceptual", difficulty: "easy", topic: "Basics" }] };
      }
    }

    const suggestion = nextQJson.suggestions?.[0] || nextQJson;

    const firstQuestion = await prisma.question.create({
      data: {
        sessionId: session.id,
        questionNumber: 1,
        content: suggestion.question || "What is an algorithm?",
        type: suggestion.type || "Conceptual",
        difficulty: suggestion.difficulty || "easy",
        topic: suggestion.topic || "Fundamentals",
        expectedAnswer: suggestion.expected_answer || "",
        coreConcepts: suggestion.concepts || [],
        requiredKeywords: suggestion.required_keywords || []
      }
    });

    return NextResponse.json({
      sessionId: session.id,
      candidate: candidate,
      firstQuestion: {
        id: firstQuestion.id,
        content: firstQuestion.content,
        questionNumber: firstQuestion.questionNumber
      }
    });
    
  } catch (error: unknown) {
    const { handleLLMError } = await import('@/lib/llm');
    return handleLLMError(error);
  }
}
