-- P4 Performance Indexes & pgvector HNSW Cosine Index
-- Non-destructive; safe to apply with `npx prisma migrate deploy`.

CREATE INDEX IF NOT EXISTS "InterviewSession_candidateId_idx" ON "InterviewSession"("candidateId");
CREATE INDEX IF NOT EXISTS "InterviewSession_interviewerId_idx" ON "InterviewSession"("interviewerId");
CREATE INDEX IF NOT EXISTS "InterviewSession_status_idx" ON "InterviewSession"("status");
CREATE INDEX IF NOT EXISTS "Question_sessionId_idx" ON "Question"("sessionId");
CREATE INDEX IF NOT EXISTS "KnowledgeGap_sessionId_idx" ON "KnowledgeGap"("sessionId");

-- Fast approximate nearest neighbor vector similarity search for 384-dim all-MiniLM-L6-v2 embeddings
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
