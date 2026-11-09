import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { generateLLMResponse, handleLLMError } from "@/lib/llm";
import { ANSWER_EVALUATOR_PROMPT, QUESTION_GENERATOR_PROMPT } from "@/lib/llm/prompts";
import { determineNextQuestionParams, updateSessionState } from "@/lib/interview/engine";
import { searchChunks } from "@/lib/knowledge-base/searchChunks";
import { getAppSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({});
    const userSession = await getAppSession(req as unknown as Request, res as unknown as Response);
    if (!userSession?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { sessionId, questionId, transcript, forceProvider } = await req.json();

    if (!sessionId || !questionId || !transcript) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Fetch Question
    const question = await prisma.question.findUnique({
      where: { id: questionId },
      include: { session: { include: { candidate: true } } }
    });

    if (!question) {
      return NextResponse.json({ error: "Question not found" }, { status: 404 });
    }

    const isOwner =
      userSession.role === 'ADMIN' ||
      question.session.interviewerId === userSession.userId ||
      (question.session.candidate?.userId !== null && question.session.candidate?.userId === userSession.userId);

    if (!isOwner) {
      return NextResponse.json({ error: "Question not found or unauthorized" }, { status: 404 });
    }

    // 2. Check if answer already exists
    let answer = await prisma.answer.findUnique({
      where: { questionId: question.id }
    });

    let evalJson: Record<string, unknown> | null = null;

    if (answer) {
      const existingEval = await prisma.answerEvaluation.findUnique({ where: { answerId: answer.id } });
      const nextQuestion = await prisma.question.findFirst({
        where: { sessionId: sessionId, questionNumber: question.questionNumber + 1 }
      });
      
      // If we have an existing eval, we return it. If nextQuestion is already picked, we return that too.
      // If nextQuestion is NOT picked, we will still generate suggestions below (or could cache them).
      if (existingEval && nextQuestion) {
        return NextResponse.json({
          success: true,
          alreadyProcessed: true,
          evaluation: existingEval,
          nextQuestion: {
            id: nextQuestion.id,
            content: nextQuestion.content,
            questionNumber: nextQuestion.questionNumber
          }
        });
      }
      
      if (existingEval) {
        // Evaluate already done, just skip to generating suggestions!
        evalJson = existingEval; // (Re-use existing eval for generating suggestions if we wanted, but we already have it in DB)
      }
    }

    if (!answer) {
      // Save New Answer if it doesn't exist at all
      try {
        answer = await prisma.answer.create({
          data: {
            questionId: question.id,
            transcript: transcript,
          }
        });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') { // Unique constraint failed
          answer = await prisma.answer.findUnique({ where: { questionId: question.id } });
          if (!answer) throw err;
        } else {
          throw err;
        }
      }
    }

    // Use session scope from question.session to respect mode, material, keywords, or selected Knowledge Base documents
    const scope = (question.session?.scope as Record<string, unknown>) || {};
    const mode = (scope.mode as string) || "standard";
    const setupData = (scope.setupData as string) || "";
    const isKnowledgeMode = mode === "knowledge" || mode === "knowledge-base";
    let selectedDocIds: number[] | undefined = undefined;

    // LLM Provider resolution - ONLY ADMIN users can pass a forced provider for controlled testing
    const adminOverride = userSession.role === 'ADMIN' && forceProvider && (forceProvider === 'gemini' || forceProvider === 'groq')
      ? forceProvider
      : undefined;

    if (isKnowledgeMode) {
      if (Array.isArray(scope.selectedDocumentIds)) {
        selectedDocIds = (scope.selectedDocumentIds as unknown[]).map(Number).filter(id => !isNaN(id));
      } else if (typeof setupData === "string" && setupData.trim()) {
        try {
          const parsed = JSON.parse(setupData);
          if (Array.isArray(parsed)) {
            selectedDocIds = parsed.map(Number).filter(id => !isNaN(id));
          }
        } catch {
          // ignore parse error
        }
      }
    }

    if (!answer || !await prisma.answerEvaluation.findUnique({ where: { answerId: answer.id } })) {
      // 3. RAG Retrieval for Evaluation Context
      let searchResults: Awaited<ReturnType<typeof searchChunks>> = [];
      if (isKnowledgeMode) {
        searchResults = await searchChunks(question.content + " " + transcript, userSession.userId, 5, selectedDocIds);
      } else if (mode === "keywords") {
        searchResults = await searchChunks(`[${scope.subject || ''}] ${setupData} ${question.content}`, userSession.userId, 5);
      } else {
        searchResults = await searchChunks(question.content + " " + transcript, userSession.userId, 5);
      }
      const contextText = searchResults.map(r => r.content).join("\n\n");

      // 4. Parallel AI Analysis - Evaluate Answer
      const evaluatorPrompt = ANSWER_EVALUATOR_PROMPT
        .replace("{{question}}", question.content)
        .replace("{{expected_answer}}", question.expectedAnswer || "")
        .replace("{{required_keywords}}", question.requiredKeywords.join(", "))
        .replace("{{candidate_answer}}", transcript)
        .replace("{{context}}", contextText);

      const { text: evaluationResponse } = await generateLLMResponse(evaluatorPrompt + "\n\nReply in strict JSON format.", adminOverride);
      
      try {
        evalJson = JSON.parse(evaluationResponse);
      } catch {
        let cleaned = evaluationResponse.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
        cleaned = cleaned.replace(/,\s*([\}\]])/g, "$1"); // fix trailing commas
        try {
          evalJson = JSON.parse(cleaned);
        } catch {
          console.error("Failed to parse eval JSON:", cleaned);
          evalJson = { score: 70, correctness: "Could not parse AI evaluation.", completeness: "", relevance: "", technical_accuracy: "", feedback: "LLM returned malformed JSON." };
        }
      }

      // 5. Save Evaluation
      await prisma.answerEvaluation.upsert({
        where: { answerId: answer.id },
        update: {
          score: Number(evalJson?.score) || 70,
          correctness: String(evalJson?.correctness) || "",
          completeness: String(evalJson?.completeness) || "",
          relevance: String(evalJson?.relevance) || "",
          technicalAccuracy: String(evalJson?.technical_accuracy) || "",
          mentionedKeywords: (evalJson?.mentioned_keywords as string[]) || [],
          missingKeywords: (evalJson?.missing_keywords as string[]) || [],
          feedback: String(evalJson?.feedback) || ""
        },
        create: {
          answerId: answer.id,
          score: Number(evalJson?.score) || 70,
          correctness: String(evalJson?.correctness) || "",
          completeness: String(evalJson?.completeness) || "",
          relevance: String(evalJson?.relevance) || "",
          technicalAccuracy: String(evalJson?.technical_accuracy) || "",
          mentionedKeywords: (evalJson?.mentioned_keywords as string[]) || [],
          missingKeywords: (evalJson?.missing_keywords as string[]) || [],
          feedback: String(evalJson?.feedback) || ""
        }
      });

      // Save Knowledge Gaps
      if ((evalJson?.knowledge_gap as Array<{concept: string, confidence: string, evidence: string}>) && Array.isArray((evalJson?.knowledge_gap as Array<{concept: string, confidence: string, evidence: string}>))) {
        for (const gap of (evalJson?.knowledge_gap as Array<{concept: string, confidence: string, evidence: string}>)) {
          await prisma.knowledgeGap.create({
            data: {
              sessionId: sessionId,
              concept: gap.concept,
              confidence: gap.confidence,
              evidence: gap.evidence
            }
          });
        }
      }

      // Update session score
      await updateSessionState(sessionId);

      const { createAuditLog } = await import("@/lib/audit-log");
      createAuditLog({
        userId: userSession.userId,
        username: userSession.username,
        action: "INTERVIEW_EVALUATED",
        entityType: "Question",
        entityId: questionId,
        metadata: { score: Number(evalJson?.score) || 70, sessionId }
      });
    }

    // 6. Adaptive Question Engine - Decide Next Question SUGGESTIONS
    const nextParams = await determineNextQuestionParams(sessionId);
    
    if (!evalJson && answer) {
      evalJson = await prisma.answerEvaluation.findUnique({ where: { answerId: answer.id } }) as unknown as Record<string, unknown> | null;
    }

    // Normalize evaluation details
    const evalScore = typeof evalJson?.score === 'number'
      ? evalJson.score
      : (typeof evalJson?.score === 'string' ? parseFloat(evalJson.score) || 70 : 70);
    const evalCorrectness = String(evalJson?.correctness || "Not evaluated");
    const evalCompleteness = String(evalJson?.completeness || "Not evaluated");
    const evalTechAccuracy = String(evalJson?.technical_accuracy || (evalJson as Record<string, unknown>)?.technicalAccuracy || "Not evaluated");
    
    // Missing concepts from evaluation
    let missingConcepts: string[] = [];
    if (Array.isArray(evalJson?.missing_concepts)) {
      missingConcepts = (evalJson.missing_concepts as string[]).map(s => String(s).trim()).filter(Boolean);
    } else if (Array.isArray(evalJson?.missingKeywords)) {
      missingConcepts = (evalJson.missingKeywords as string[]).map(s => String(s).trim()).filter(Boolean);
    } else if (Array.isArray(evalJson?.missing_keywords)) {
      missingConcepts = (evalJson.missing_keywords as string[]).map(s => String(s).trim()).filter(Boolean);
    }

    // Misconceptions / incorrect concepts
    let incorrectConcepts: string[] = [];
    if (Array.isArray(evalJson?.incorrect_concepts)) {
      incorrectConcepts = (evalJson.incorrect_concepts as string[]).map(s => String(s).trim()).filter(Boolean);
    }

    const evalFeedback = String(evalJson?.feedback || "No feedback provided");

    const evaluationSummary = [
      `- Score: ${evalScore}/100`,
      `- Correctness: ${evalCorrectness}`,
      `- Completeness: ${evalCompleteness}`,
      `- Technical Accuracy: ${evalTechAccuracy}`,
      `- Missing Concepts: ${missingConcepts.length > 0 ? missingConcepts.join(", ") : "None identified"}`,
      `- Misconceptions / Incorrect Concepts: ${incorrectConcepts.length > 0 ? incorrectConcepts.join(", ") : "None identified"}`,
      `- Evaluator Feedback: ${evalFeedback}`
    ].join("\n");

    // Build answer-aware RAG query incorporating candidate's answer, missing concepts, weak concepts, and misconceptions
    const focusTerms = Array.from(new Set([
      ...missingConcepts,
      ...incorrectConcepts,
      ...nextParams.weakConcepts
    ])).filter(t => typeof t === "string" && t.trim().length > 0);

    const candidateTranscript = transcript || answer?.transcript || "";
    const answerSnippet = candidateTranscript.slice(0, 150).replace(/\s+/g, " ").trim();
    
    let adaptiveRAGQuery = "";
    if (focusTerms.length > 0) {
      adaptiveRAGQuery = `${question.content} ${focusTerms.slice(0, 5).join(" ")} ${answerSnippet}`.trim();
    } else {
      adaptiveRAGQuery = `${question.content} ${answerSnippet}`.trim();
    }

    if (!adaptiveRAGQuery) {
      adaptiveRAGQuery = question.content || (scope.subject as string) || "General Knowledge";
    }

    let contextTextNext = "";
    try {
      if (mode === "keywords") {
        const searchResultsNext = await searchChunks(`[${scope.subject || ''}] ${setupData} ${adaptiveRAGQuery}`, userSession.userId, 3);
        const chunkContent = searchResultsNext.map(r => r.content).join("\n\n");
        contextTextNext = "FOCUS STRICTLY ON THESE KEYWORDS: " + setupData + (chunkContent ? "\n\n" + chunkContent : "");
      } else if (isKnowledgeMode) {
        const searchResultsNext = await searchChunks(adaptiveRAGQuery, userSession.userId, 10, selectedDocIds);
        const chunkContent = searchResultsNext.map(r => r.content).join("\n\n");
        contextTextNext = chunkContent
          ? "RESTRICT ALL QUESTIONS STRICTLY TO THE FOLLOWING KNOWLEDGE BASE MATERIAL ONLY. DO NOT ASK ANYTHING OUTSIDE THIS MATERIAL:\n\n" + chunkContent
          : "RESTRICT ALL QUESTIONS STRICTLY TO THE CONFIGURED KNOWLEDGE BASE MATERIAL.";
      } else {
        const searchResultsNext = await searchChunks(adaptiveRAGQuery, userSession.userId, 3);
        contextTextNext = searchResultsNext.map(r => r.content).join("\n\n");
      }
    } catch (ragErr) {
      console.warn("RAG retrieval for follow-up question generation encountered an error; proceeding with fallback context:", ragErr);
      contextTextNext = "";
    }
    
    const previousQuestionsFormatted = nextParams.previousQuestions.length > 0
      ? nextParams.previousQuestions.map((q, idx) => `${idx + 1}. ${q}`).join("\n")
      : "None";

    const generatorPrompt = QUESTION_GENERATOR_PROMPT
      .replace("{{subject}}", (scope.subject as string) || "Configured Subject") 
      .replace("{{topic}}", question.topic || "Adaptive Topic")
      .replace("{{difficulty}}", nextParams.difficulty)
      .replace("{{context}}", contextTextNext)
      .replace("{{previous_question}}", question.content)
      .replace("{{candidate_answer}}", candidateTranscript || "No answer recorded")
      .replace("{{evaluation_summary}}", evaluationSummary)
      .replace("{{previous_questions}}", previousQuestionsFormatted)
      .replace("{{earlier_context}}", nextParams.earlierContextText || "None (First completed question)")
      .replace("{{weak_concepts}}", nextParams.weakConcepts.join(", ") || "None")
      .replace("{{remaining_concepts}}", missingConcepts.join(", ") || "None");

    const { text: nextQResponse } = await generateLLMResponse(generatorPrompt + "\n\nReply in strict JSON format.", adminOverride);
    let nextQJson;
    try {
      nextQJson = JSON.parse(nextQResponse);
    } catch {
      let cleaned = nextQResponse.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
      cleaned = cleaned.replace(/,\s*([\}\]])/g, "$1");
      try {
        nextQJson = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse nextQ JSON:", cleaned);
        const fallbackTopic = question.topic || "General";
        const fallbackReason = missingConcepts.length > 0
          ? `Follow-up probing missing concept: ${missingConcepts[0]}`
          : `Adaptive follow-up based on performance (difficulty: ${nextParams.difficulty})`;
        const fallbackQuestion = missingConcepts.length > 0
          ? `Could you explain the role of ${missingConcepts[0]} in relation to your previous answer?`
          : `Can you elaborate on the core principles underlying your previous answer?`;
        nextQJson = { suggestions: [{ question: fallbackQuestion, type: "Conceptual", difficulty: nextParams.difficulty, topic: fallbackTopic, reason: fallbackReason }] };
      }
    }

    return NextResponse.json({
      evaluation: evalJson || await prisma.answerEvaluation.findUnique({ where: { answerId: answer.id } }),
      suggestedQuestions: nextQJson.suggestions || []
    });
    
  } catch (error: unknown) {
    console.error("Evaluation pipeline error:", error);
    return handleLLMError(error);
  }
}








