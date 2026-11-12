# SmartInterview Operations Runbook

## 1. Pending Database Migrations (Deploy Order)

Four non-destructive Prisma SQL migrations were generated cleanly without mutating live Neon data:

1. `20261111_p0_security_and_eval_fields` — `User.tokenVersion`, `RateLimit`, `PasswordResetToken`, structured `AnswerEvaluation` fields.
2. `20261111_p1_rag_and_lifecycle` — `InterviewSession.pendingSuggestions`, `InterviewSession.pausedAt`, `Question.sourceReferences`.
3. `20261111_p2_candidate_memory_and_reports` — `CandidateProfile`, `CandidateConceptMastery`, `RevisionRecommendation`, report AI baseline + edit audit fields, communication scores.
4. `20261111_p4_indexes_and_constraints` — FK/status B-tree indexes + `DocumentChunk_embedding_hnsw_idx` (`HNSW` cosine similarity index on 384-dim `vector(384)`).

Before deploying application code that selects these columns/tables, review the SQL files under `prisma/migrations/` and run:

```bash
npx prisma migrate status
npx prisma migrate deploy
```

Never run `prisma migrate reset` or `prisma db push --accept-data-loss` against production.

## 2. Neon PostgreSQL Backups, PITR & Cold Starts

- **Point-in-Time Recovery (PITR)**: Neon maintains continuous WAL archiving; verify retention window in Neon Console -> Project -> Restore before schema changes and create a temporary pre-migration Neon branch snapshot if needed.
- **Transient Cold Starts**: `lib/db.ts` appends `connect_timeout=30` and `pool_timeout=30` for Neon hostnames and exports `withDbRetry()` (used by `/api/health`) to retry transient `P1001`/`P1008`/`P1017` wakeups cleanly.

## 3. Backblaze B2 Private Document Lifecycle

- Uploaded KB documents live in a private Backblaze B2 bucket referenced via `Document.storagePath`.
- `GET /api/documents` and `GET /api/admin/knowledge-base` avoid running full B2 reconciliation on every read; pass `?reconcile=1` manually when auditing storage drift (`MARKED_MISSING` vs `AVAILABLE`).
- `DELETE /api/admin/knowledge-base/[id]` deletes `SYNCED_FROM_ADMIN` child records atomically before verifying remaining `storagePath` references and deleting the remote B2 object.
- Candidate audio is **never** stored permanently (`Answer.audioPath` remains `null`).

## 4. Health Monitoring & Security Auditing

- **Health Endpoint**: `GET /api/health` verifies database connectivity (`withDbRetry`) and reports non-secret boolean subsystem readiness (`storageConfigured`, `llmEnvConfigured`, `sessionSecretConfigured`, `smtpConfigured`).
- **Session Secret**: `SESSION_SECRET` (minimum 32 random chars) is strictly required in all environments; set via Vercel Environment Variables and local `.env`.
- **Audit Logs**: View security, role-change, login (including IP/User-Agent), and report-edit events in `/admin/audit-logs` or via `GET /api/admin/audit-logs`.
