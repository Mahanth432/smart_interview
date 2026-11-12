-- Additive P0-P4 Hardening Migration:
-- 1. Enforce unique (sessionId, questionNumber) on Question to prevent concurrent duplicate question inserts.
--    NOTE: Before running `npx prisma migrate deploy`, verify zero duplicate (sessionId, questionNumber) rows exist.
-- 2. Add performance indexes on User(role), Document(docSource, storageStatus, status),
--    InterviewSession(startedAt), InterviewSession(interviewerId, startedAt), and Question(askedAt).

CREATE UNIQUE INDEX IF NOT EXISTS "Question_sessionId_questionNumber_key"
  ON "Question"("sessionId", "questionNumber");

CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "Document_docSource_storageStatus_status_idx"
  ON "Document"("docSource", "storageStatus", "status");
CREATE INDEX IF NOT EXISTS "InterviewSession_startedAt_idx" ON "InterviewSession"("startedAt");
CREATE INDEX IF NOT EXISTS "InterviewSession_interviewerId_startedAt_idx"
  ON "InterviewSession"("interviewerId", "startedAt");
CREATE INDEX IF NOT EXISTS "Question_askedAt_idx" ON "Question"("askedAt");
