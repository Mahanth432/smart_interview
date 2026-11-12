-- Non-destructive P1 migration: interview lifecycle pause/resume state & RAG source attribution

ALTER TABLE "InterviewSession"
  ADD COLUMN IF NOT EXISTS "pendingSuggestions" JSONB,
  ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);

ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "sourceReferences" JSONB;
