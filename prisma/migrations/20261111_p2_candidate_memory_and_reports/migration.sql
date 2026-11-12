-- Non-destructive P2 migration: Candidate Learning & Memory, Forgetting-Risk, Revisions, Editable Reports

-- 1. Communication scoring & clarity feedback on AnswerEvaluation
ALTER TABLE "AnswerEvaluation"
  ADD COLUMN IF NOT EXISTS "communicationScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "communicationFeedback" TEXT NOT NULL DEFAULT '';

-- 2. Editable interviewer feedback & preserved AI evaluation baseline on InterviewReport
ALTER TABLE "InterviewReport"
  ADD COLUMN IF NOT EXISTS "aiExecutiveSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "aiStrengths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "aiWeaknesses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "aiImprovementPlan" TEXT,
  ADD COLUMN IF NOT EXISTS "interviewerNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "editedByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "editedByName" TEXT,
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);

-- 3. CandidateProfile: persistent learning, answering & reasoning profile across sessions
CREATE TABLE IF NOT EXISTS "CandidateProfile" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "answeringStyle" TEXT NOT NULL DEFAULT '',
  "reasoningPattern" TEXT NOT NULL DEFAULT '',
  "technicalStrengths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "communicationTraits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "learningPreferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "totalEvaluations" INTEGER NOT NULL DEFAULT 0,
  "averageScore" DOUBLE PRECISION,
  "lastAnalyzedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CandidateProfile_candidateId_key" ON "CandidateProfile"("candidateId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CandidateProfile_candidateId_fkey'
  ) THEN
    ALTER TABLE "CandidateProfile"
      ADD CONSTRAINT "CandidateProfile_candidateId_fkey"
      FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. CandidateConceptMastery: longitudinal mastery, recurrence & explainable forgetting-risk
CREATE TABLE IF NOT EXISTS "CandidateConceptMastery" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "conceptKey" TEXT NOT NULL,
  "conceptName" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT 'General',
  "masteryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "weaknessCount" INTEGER NOT NULL DEFAULT 0,
  "lastScore" DOUBLE PRECISION,
  "lastTestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "forgettingRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "recommendedReviewAt" TIMESTAMP(3),
  "linkedDocumentId" INTEGER,
  "linkedDocumentName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CandidateConceptMastery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CandidateConceptMastery_candidateId_conceptKey_key"
  ON "CandidateConceptMastery"("candidateId", "conceptKey");
CREATE INDEX IF NOT EXISTS "CandidateConceptMastery_candidateId_idx"
  ON "CandidateConceptMastery"("candidateId");
CREATE INDEX IF NOT EXISTS "CandidateConceptMastery_candidateId_forgettingRisk_idx"
  ON "CandidateConceptMastery"("candidateId", "forgettingRisk");
CREATE INDEX IF NOT EXISTS "CandidateConceptMastery_candidateId_weaknessCount_idx"
  ON "CandidateConceptMastery"("candidateId", "weaknessCount");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CandidateConceptMastery_candidateId_fkey'
  ) THEN
    ALTER TABLE "CandidateConceptMastery"
      ADD CONSTRAINT "CandidateConceptMastery_candidateId_fkey"
      FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. RevisionRecommendation: prioritized personalized revision items linked to KB docs
CREATE TABLE IF NOT EXISTS "RevisionRecommendation" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "conceptName" TEXT NOT NULL,
  "subject" TEXT NOT NULL DEFAULT 'General',
  "priorityScore" DOUBLE PRECISION NOT NULL,
  "forgettingRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "linkedDocumentId" INTEGER,
  "linkedDocumentName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RevisionRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RevisionRecommendation_candidateId_status_idx"
  ON "RevisionRecommendation"("candidateId", "status");
CREATE INDEX IF NOT EXISTS "RevisionRecommendation_candidateId_priorityScore_idx"
  ON "RevisionRecommendation"("candidateId", "priorityScore");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RevisionRecommendation_candidateId_fkey'
  ) THEN
    ALTER TABLE "RevisionRecommendation"
      ADD CONSTRAINT "RevisionRecommendation_candidateId_fkey"
      FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
