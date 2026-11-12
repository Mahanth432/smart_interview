import prisma from '../db'
import { normalizeDifficulty, stepDifficulty } from './difficulty'

export async function determineNextQuestionParams(sessionId: string) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      questions: {
        include: { answer: { include: { evaluation: true } } },
        orderBy: { askedAt: 'asc' },
      },
      gaps: true,
    },
  })

  if (!session) throw new Error('Session not found')

  const totalQuestions = session.questions.length
  const lastQuestion = session.questions[totalQuestions - 1]
  const lastScore = lastQuestion?.answer?.evaluation?.score
  const currentDifficulty =
    typeof lastScore === 'number'
      ? stepDifficulty(session.difficulty, lastScore)
      : normalizeDifficulty(session.difficulty, 'medium')

  if (currentDifficulty !== session.difficulty) {
    await prisma.interviewSession.update({
      where: { id: sessionId },
      data: { difficulty: currentDifficulty },
    })
  }

  const priorAnsweredQuestions = session.questions.filter(
    (q) => q.answer && q.id !== lastQuestion?.id
  )

  const earlierContextLines = priorAnsweredQuestions.map((q) => {
    const scoreText =
      q.answer?.evaluation?.score !== undefined ? `${q.answer.evaluation.score}/100` : 'unscored'
    const transcriptSnippet = q.answer?.transcript
      ? q.answer.transcript.length > 160
        ? q.answer.transcript.slice(0, 160) + '...'
        : q.answer.transcript
      : 'No answer recorded'
    return `[Q${q.questionNumber}: "${q.content}"] -> Answer: "${transcriptSnippet}" (Score: ${scoreText})`
  })

  const earlierContextText =
    earlierContextLines.length > 0
      ? earlierContextLines.join('\n')
      : 'None (This is the first evaluated question in this session)'

  const uniqueWeakConcepts = Array.from(
    new Set(session.gaps.map((g) => g.concept).filter(Boolean))
  )

  return {
    difficulty: currentDifficulty,
    previousQuestions: session.questions.map((q) => q.content),
    weakConcepts: uniqueWeakConcepts,
    earlierContextText,
    sessionHistory: priorAnsweredQuestions.map((q) => ({
      questionNumber: q.questionNumber,
      question: q.content,
      answer: q.answer?.transcript || '',
      score: q.answer?.evaluation?.score ?? null,
      feedback: q.answer?.evaluation?.feedback ?? null,
    })),
    lastQuestion: lastQuestion
      ? {
          id: lastQuestion.id,
          content: lastQuestion.content,
          type: lastQuestion.type,
          difficulty: lastQuestion.difficulty,
          topic: lastQuestion.topic,
          expectedAnswer: lastQuestion.expectedAnswer,
        }
      : null,
    lastEvaluation: lastQuestion?.answer?.evaluation || null,
  }
}

export async function updateSessionState(sessionId: string) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    include: {
      questions: {
        include: { answer: { include: { evaluation: true } } },
      },
    },
  })

  if (!session) return

  const evaluatedQuestions = session.questions.filter((q) => q.answer?.evaluation)
  if (evaluatedQuestions.length === 0) return

  const totalScore =
    evaluatedQuestions.reduce((sum, q) => sum + (q.answer?.evaluation?.score ?? 0), 0) /
    evaluatedQuestions.length

  const topicAgg = new Map<string, { sum: number; count: number }>()
  for (const q of evaluatedQuestions) {
    const topic = (q.topic || 'General').trim()
    const score = q.answer?.evaluation?.score ?? 0
    const entry = topicAgg.get(topic) ?? { sum: 0, count: 0 }
    entry.sum += score
    entry.count += 1
    topicAgg.set(topic, entry)
  }

  const topicsCovered = Array.from(topicAgg.keys())
  const strongTopics: string[] = []
  const weakTopics: string[] = []
  for (const [topic, { sum, count }] of topicAgg.entries()) {
    const avg = sum / count
    if (avg >= 75) strongTopics.push(topic)
    else if (avg < 60) weakTopics.push(topic)
  }

  await prisma.interviewSession.update({
    where: { id: sessionId },
    data: {
      score: Math.round(totalScore * 100) / 100,
      topicsCovered,
      strongTopics,
      weakTopics,
    },
  })
}
