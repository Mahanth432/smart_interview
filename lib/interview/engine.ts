import prisma from "../db";

export async function determineNextQuestionParams(sessionId: string) {
  // Fetch session with questions and evaluations
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      questions: {
        include: { answer: { include: { evaluation: true } } },
        orderBy: { askedAt: "asc" }
      },
      gaps: true,
    }
  });

  if (!session) throw new Error("Session not found");

  const totalQuestions = session.questions.length;
  const lastQuestion = session.questions[totalQuestions - 1];
  let currentDifficulty = session.difficulty;

  if (lastQuestion?.answer?.evaluation) {
    const lastScore = lastQuestion.answer.evaluation.score;
    // Adaptive Difficulty Stepping Logic
    if (lastScore >= 80 && currentDifficulty !== "expert") {
      if (currentDifficulty === "easy") currentDifficulty = "medium";
      else if (currentDifficulty === "medium") currentDifficulty = "hard";
      else if (currentDifficulty === "hard") currentDifficulty = "expert";
    } else if (lastScore <= 40 && currentDifficulty !== "easy") {
      if (currentDifficulty === "expert") currentDifficulty = "hard";
      else if (currentDifficulty === "hard") currentDifficulty = "medium";
      else if (currentDifficulty === "medium") currentDifficulty = "easy";
    }
  }

  // Update session difficulty
  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { difficulty: currentDifficulty }
  });

  // Extract prior questions (excluding the current question that was just answered)
  const priorAnsweredQuestions = session.questions.filter(
    q => q.answer && q.id !== lastQuestion?.id
  );

  const earlierContextLines = priorAnsweredQuestions.map(q => {
    const scoreText = q.answer?.evaluation?.score !== undefined ? `${q.answer.evaluation.score}/100` : "unscored";
    const transcriptSnippet = q.answer?.transcript
      ? (q.answer.transcript.length > 120 ? q.answer.transcript.slice(0, 120) + "..." : q.answer.transcript)
      : "No answer recorded";
    return `[Q${q.questionNumber}: "${q.content}"] -> Answer: "${transcriptSnippet}" (Score: ${scoreText})`;
  });

  const earlierContextText = earlierContextLines.length > 0
    ? earlierContextLines.join("\n")
    : "None (This is the first evaluated question in this session)";

  const uniqueWeakConcepts = Array.from(new Set(session.gaps.map(g => g.concept).filter(Boolean)));

  return {
    difficulty: currentDifficulty,
    previousQuestions: session.questions.map(q => q.content),
    weakConcepts: uniqueWeakConcepts,
    earlierContextText,
    sessionHistory: priorAnsweredQuestions.map(q => ({
      questionNumber: q.questionNumber,
      question: q.content,
      answer: q.answer?.transcript || "",
      score: q.answer?.evaluation?.score ?? null,
      feedback: q.answer?.evaluation?.feedback ?? null
    })),
    lastQuestion: lastQuestion ? {
      id: lastQuestion.id,
      content: lastQuestion.content,
      type: lastQuestion.type,
      difficulty: lastQuestion.difficulty,
      topic: lastQuestion.topic,
      expectedAnswer: lastQuestion.expectedAnswer
    } : null,
    lastEvaluation: lastQuestion?.answer?.evaluation || null
  };
}

export async function updateSessionState(sessionId: string) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      questions: {
        include: { answer: { include: { evaluation: true } } }
      }
    }
  });

  if (!session) return;

  const evals = session.questions.map(q => q.answer?.evaluation).filter(Boolean);
  if (evals.length === 0) return;

  const totalScore = evals.reduce((sum, ev) => sum + (ev?.score || 0), 0) / evals.length;

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: { score: totalScore }
  });
}
