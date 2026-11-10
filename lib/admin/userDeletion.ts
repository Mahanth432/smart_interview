import prisma from '@/lib/db'
import { createAuditLog } from '@/lib/audit-log'
import { deleteDocumentObject } from '@/lib/storage/b2'

const B2_CLEANUP_KEY_PREFIX = 'b2_cleanup_user_'

interface PendingB2CleanupRecord {
  userId: number
  username?: string
  keysToDelete: string[]
  attempts: number
  lastError?: string | null
  createdAt: string
}

export interface UserDeletionPreview {
  user: {
    id: number
    username: string
    email: string | null
    name: string | null
    role: string
    emailVerified: boolean
    createdAt: Date
  }
  impact: {
    documentCount: number
    privateDocumentCount: number
    syncedDocumentCount: number
    adminMasterDocumentCount: number
    totalChunks: number
    candidateSessionCount: number
    interviewerSessionCount: number
    auditLogCount: number
    otpCount: number
    deletableB2ObjectCount: number
    preservedSharedB2ObjectCount: number
  }
}

export interface DeleteUserResult {
  status: number
  body: {
    success: boolean
    alreadyDeleted?: boolean
    recoveredCleanup?: boolean
    partialFailure?: boolean
    retryable?: boolean
    message: string
    userId: number
    deletedDocuments: number
    deletedChunks: number
    deletedB2Keys: string[]
    failedB2Keys: Array<{ key: string; error: string }>
    preservedSharedKeys: string[]
    preservedCandidateSessions: number
    preservedInterviewerSessions: number
  }
}

export type DeleteObjectFn = (storagePath: string) => Promise<void>

function isDeletableStoragePath(storagePath: string | null | undefined): storagePath is string {
  return Boolean(storagePath && storagePath.trim() && storagePath !== 'seeded')
}

export async function getUserDeletionPreview(targetUserId: number): Promise<UserDeletionPreview | null> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      createdAt: true,
      _count: {
        select: {
          documents: true,
          sessions: true,
          auditLogs: true,
          otps: true,
        },
      },
      candidate: {
        select: {
          id: true,
          _count: { select: { sessions: true } },
        },
      },
      documents: {
        select: {
          id: true,
          docSource: true,
          storagePath: true,
          _count: { select: { chunks: true } },
        },
      },
    },
  })

  if (!user) return null

  const ownedDocIds = user.documents.map((d) => d.id)
  const uniquePaths = Array.from(
    new Set(user.documents.map((d) => d.storagePath).filter(isDeletableStoragePath))
  )

  let deletableB2ObjectCount = 0
  let preservedSharedB2ObjectCount = 0

  if (uniquePaths.length > 0) {
    const sharedCounts = await prisma.document.groupBy({
      by: ['storagePath'],
      where: {
        storagePath: { in: uniquePaths },
        id: { notIn: ownedDocIds },
      },
      _count: { _all: true },
    })
    const sharedSet = new Set(sharedCounts.map((r) => r.storagePath))
    for (const p of uniquePaths) {
      if (sharedSet.has(p)) preservedSharedB2ObjectCount++
      else deletableB2ObjectCount++
    }
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    },
    impact: {
      documentCount: user._count.documents,
      privateDocumentCount: user.documents.filter((d) => d.docSource === 'INTERVIEWER_PRIVATE').length,
      syncedDocumentCount: user.documents.filter((d) => d.docSource === 'SYNCED_FROM_ADMIN').length,
      adminMasterDocumentCount: user.documents.filter((d) => d.docSource === 'ADMIN_MASTER').length,
      totalChunks: user.documents.reduce((acc, d) => acc + d._count.chunks, 0),
      candidateSessionCount: user.candidate?._count.sessions ?? 0,
      interviewerSessionCount: user._count.sessions,
      auditLogCount: user._count.auditLogs,
      otpCount: user._count.otps,
      deletableB2ObjectCount,
      preservedSharedB2ObjectCount,
    },
  }
}

async function executeB2Cleanup(params: {
  targetUserId: number
  keysToDelete: string[]
  deleteObjectFn: DeleteObjectFn
}): Promise<{
  deletedB2Keys: string[]
  failedB2Keys: Array<{ key: string; error: string }>
  skippedNowSharedKeys: string[]
}> {
  const deletedB2Keys: string[] = []
  const failedB2Keys: Array<{ key: string; error: string }> = []
  const skippedNowSharedKeys: string[] = []

  for (const key of params.keysToDelete) {
    // Defense-in-depth: re-verify no Document record still references this storage key
    const remainingRefs = await prisma.document.count({ where: { storagePath: key } })
    if (remainingRefs > 0) {
      skippedNowSharedKeys.push(key)
      continue
    }

    try {
      await params.deleteObjectFn(key)
      deletedB2Keys.push(key)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failedB2Keys.push({ key, error: msg })
    }
  }

  return { deletedB2Keys, failedB2Keys, skippedNowSharedKeys }
}

/**
 * Safely delete a user with explicit foreign-key handling and staged, retryable
 * Backblaze B2 object cleanup.
 *
 * - Rejects self-deletion and deletion of the last ADMIN account.
 * - Preserves InterviewSession, Question, Answer, AnswerEvaluation, InterviewReport,
 *   KnowledgeGap, and AuditLog history (unlinking Candidate if it has sessions).
 * - Deletes user-owned Document and DocumentChunk rows atomically.
 * - Only deletes B2 objects when zero remaining Document records reference them.
 * - Persists pending B2 cleanup keys in AppSettings inside the same DB transaction
 *   so repeated DELETE calls recover cleanly from transient B2 outages.
 */
export async function deleteUserWithCleanup(params: {
  targetUserId: number
  actingAdminId: number
  actingAdminUsername?: string | null
  deleteObjectFn?: DeleteObjectFn
}): Promise<DeleteUserResult> {
  const { targetUserId, actingAdminId, actingAdminUsername } = params
  const deleteObjectFn = params.deleteObjectFn ?? deleteDocumentObject
  const cleanupKey = `${B2_CLEANUP_KEY_PREFIX}${targetUserId}`

  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Invalid user ID.',
        userId: targetUserId,
        deletedDocuments: 0,
        deletedChunks: 0,
        deletedB2Keys: [],
        failedB2Keys: [],
        preservedSharedKeys: [],
        preservedCandidateSessions: 0,
        preservedInterviewerSessions: 0,
      },
    }
  }

  if (targetUserId === actingAdminId) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'You cannot delete your own administrator account.',
        userId: targetUserId,
        deletedDocuments: 0,
        deletedChunks: 0,
        deletedB2Keys: [],
        failedB2Keys: [],
        preservedSharedKeys: [],
        preservedCandidateSessions: 0,
        preservedInterviewerSessions: 0,
      },
    }
  }

  // Check for existing user OR pending B2 cleanup from an interrupted/failed earlier attempt
  const existingUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, username: true, role: true },
  })

  if (!existingUser) {
    const pendingSetting = await prisma.appSettings.findUnique({ where: { key: cleanupKey } })
    if (!pendingSetting) {
      return {
        status: 404,
        body: {
          success: false,
          message: 'User not found.',
          userId: targetUserId,
          deletedDocuments: 0,
          deletedChunks: 0,
          deletedB2Keys: [],
          failedB2Keys: [],
          preservedSharedKeys: [],
          preservedCandidateSessions: 0,
          preservedInterviewerSessions: 0,
        },
      }
    }

    let pending: PendingB2CleanupRecord
    try {
      pending = JSON.parse(pendingSetting.value) as PendingB2CleanupRecord
    } catch {
      await prisma.appSettings.delete({ where: { key: cleanupKey } }).catch(() => {})
      return {
        status: 200,
        body: {
          success: true,
          alreadyDeleted: true,
          message: 'User was already deleted.',
          userId: targetUserId,
          deletedDocuments: 0,
          deletedChunks: 0,
          deletedB2Keys: [],
          failedB2Keys: [],
          preservedSharedKeys: [],
          preservedCandidateSessions: 0,
          preservedInterviewerSessions: 0,
        },
      }
    }

    const retryRes = await executeB2Cleanup({
      targetUserId,
      keysToDelete: pending.keysToDelete || [],
      deleteObjectFn,
    })

    if (retryRes.failedB2Keys.length > 0) {
      await prisma.appSettings.update({
        where: { key: cleanupKey },
        data: {
          value: JSON.stringify({
            ...pending,
            keysToDelete: retryRes.failedB2Keys.map((f) => f.key),
            attempts: (pending.attempts || 0) + 1,
            lastError: retryRes.failedB2Keys.map((f) => `${f.key}: ${f.error}`).join('; '),
          } satisfies PendingB2CleanupRecord),
        },
      })
      createAuditLog({
        userId: actingAdminId,
        username: actingAdminUsername ?? undefined,
        action: 'USER_B2_CLEANUP_RETRY_FAILED',
        entityType: 'User',
        entityId: String(targetUserId),
        status: 'FAILURE',
        metadata: {
          deletedB2Keys: retryRes.deletedB2Keys,
          failedB2Keys: retryRes.failedB2Keys,
        },
      })
      return {
        status: 502,
        body: {
          success: false,
          alreadyDeleted: true,
          partialFailure: true,
          retryable: true,
          message: 'User was deleted from database, but B2 cleanup retry still has failed objects.',
          userId: targetUserId,
          deletedDocuments: 0,
          deletedChunks: 0,
          deletedB2Keys: retryRes.deletedB2Keys,
          failedB2Keys: retryRes.failedB2Keys,
          preservedSharedKeys: retryRes.skippedNowSharedKeys,
          preservedCandidateSessions: 0,
          preservedInterviewerSessions: 0,
        },
      }
    }

    await prisma.appSettings.delete({ where: { key: cleanupKey } }).catch(() => {})
    createAuditLog({
      userId: actingAdminId,
      username: actingAdminUsername ?? undefined,
      action: 'USER_B2_CLEANUP_RECOVERED',
      entityType: 'User',
      entityId: String(targetUserId),
      status: 'SUCCESS',
      metadata: {
        deletedUsername: pending.username,
        deletedB2Keys: retryRes.deletedB2Keys,
        skippedNowSharedKeys: retryRes.skippedNowSharedKeys,
      },
    })

    return {
      status: 200,
      body: {
        success: true,
        alreadyDeleted: true,
        recoveredCleanup: true,
        message: 'Recovered and completed pending Backblaze B2 cleanup for previously deleted user.',
        userId: targetUserId,
        deletedDocuments: 0,
        deletedChunks: 0,
        deletedB2Keys: retryRes.deletedB2Keys,
        failedB2Keys: [],
        preservedSharedKeys: retryRes.skippedNowSharedKeys,
        preservedCandidateSessions: 0,
        preservedInterviewerSessions: 0,
      },
    }
  }

  if (existingUser.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
    if (adminCount <= 1) {
      return {
        status: 400,
        body: {
          success: false,
          message: 'Cannot delete the last administrator account.',
          userId: targetUserId,
          deletedDocuments: 0,
          deletedChunks: 0,
          deletedB2Keys: [],
          failedB2Keys: [],
          preservedSharedKeys: [],
          preservedCandidateSessions: 0,
          preservedInterviewerSessions: 0,
        },
      }
    }
  }

  // Stage 1: Atomic database transaction
  const txResult = await prisma.$transaction(async (tx) => {
    const userDocs = await tx.document.findMany({
      where: { userId: targetUserId },
      select: {
        id: true,
        storagePath: true,
        docSource: true,
        _count: { select: { chunks: true } },
      },
    })

    const deletedDocuments = userDocs.length
    const deletedChunks = userDocs.reduce((acc, d) => acc + d._count.chunks, 0)

    const interviewerSessionCount = await tx.interviewSession.count({
      where: { interviewerId: targetUserId },
    })

    // Handle Candidate FK -> InterviewSession (ON DELETE RESTRICT) explicitly:
    // If Candidate has historical sessions, preserve them by unlinking Candidate.userId = null.
    // If Candidate has 0 sessions, delete the empty Candidate profile cleanly.
    let preservedCandidateSessions = 0
    const candidate = await tx.candidate.findUnique({
      where: { userId: targetUserId },
      select: {
        id: true,
        _count: { select: { sessions: true } },
      },
    })

    if (candidate) {
      if (candidate._count.sessions > 0) {
        preservedCandidateSessions = candidate._count.sessions
        await tx.candidate.update({
          where: { id: candidate.id },
          data: { userId: null },
        })
      } else {
        await tx.candidate.delete({ where: { id: candidate.id } })
      }
    }

    // Delete all Document rows owned by this user (DocumentChunk cascades automatically)
    if (deletedDocuments > 0) {
      await tx.document.deleteMany({ where: { userId: targetUserId } })
    }

    // Determine which storage paths now have 0 remaining Document references across ALL users
    const candidatePaths = Array.from(
      new Set(userDocs.map((d) => d.storagePath).filter(isDeletableStoragePath))
    )
    const keysToDelete: string[] = []
    const preservedSharedKeys: string[] = []

    for (const storagePath of candidatePaths) {
      const remainingRefs = await tx.document.count({ where: { storagePath } })
      if (remainingRefs === 0) {
        keysToDelete.push(storagePath)
      } else {
        preservedSharedKeys.push(storagePath)
      }
    }

    // Delete User (OtpVerification cascades; AuditLog.userId & InterviewSession.interviewerId set NULL)
    await tx.user.delete({ where: { id: targetUserId } })

    // Stage pending B2 cleanup durably inside the same transaction
    if (keysToDelete.length > 0) {
      const payload: PendingB2CleanupRecord = {
        userId: targetUserId,
        username: existingUser.username,
        keysToDelete,
        attempts: 0,
        lastError: null,
        createdAt: new Date().toISOString(),
      }
      await tx.appSettings.upsert({
        where: { key: cleanupKey },
        update: { value: JSON.stringify(payload) },
        create: { key: cleanupKey, value: JSON.stringify(payload) },
      })
    }

    return {
      deletedDocuments,
      deletedChunks,
      keysToDelete,
      preservedSharedKeys,
      preservedCandidateSessions,
      preservedInterviewerSessions: interviewerSessionCount,
    }
  })

  // Stage 2: Execute B2 cleanup for unshared objects
  const b2Res = await executeB2Cleanup({
    targetUserId,
    keysToDelete: txResult.keysToDelete,
    deleteObjectFn,
  })

  const allPreservedShared = Array.from(
    new Set([...txResult.preservedSharedKeys, ...b2Res.skippedNowSharedKeys])
  )

  if (b2Res.failedB2Keys.length > 0) {
    // Keep only remaining failed keys in AppSettings so a retry cleans up idempotently
    const updatedPayload: PendingB2CleanupRecord = {
      userId: targetUserId,
      username: existingUser.username,
      keysToDelete: b2Res.failedB2Keys.map((f) => f.key),
      attempts: 1,
      lastError: b2Res.failedB2Keys.map((f) => `${f.key}: ${f.error}`).join('; '),
      createdAt: new Date().toISOString(),
    }
    await prisma.appSettings
      .upsert({
        where: { key: cleanupKey },
        update: { value: JSON.stringify(updatedPayload) },
        create: { key: cleanupKey, value: JSON.stringify(updatedPayload) },
      })
      .catch((err) => {
        console.error('Failed to persist pending B2 cleanup state:', err)
      })

    createAuditLog({
      userId: actingAdminId,
      username: actingAdminUsername ?? undefined,
      action: 'USER_DELETE_B2_CLEANUP_FAILED',
      entityType: 'User',
      entityId: String(targetUserId),
      status: 'FAILURE',
      metadata: {
        deletedUsername: existingUser.username,
        deletedDocuments: txResult.deletedDocuments,
        deletedChunks: txResult.deletedChunks,
        deletedB2Keys: b2Res.deletedB2Keys,
        failedB2Keys: b2Res.failedB2Keys,
        preservedSharedKeys: allPreservedShared,
      },
    })

    return {
      status: 502,
      body: {
        success: false,
        partialFailure: true,
        retryable: true,
        message:
          'User and owned documents were removed from the database, but one or more Backblaze B2 objects failed to delete and are queued for retry.',
        userId: targetUserId,
        deletedDocuments: txResult.deletedDocuments,
        deletedChunks: txResult.deletedChunks,
        deletedB2Keys: b2Res.deletedB2Keys,
        failedB2Keys: b2Res.failedB2Keys,
        preservedSharedKeys: allPreservedShared,
        preservedCandidateSessions: txResult.preservedCandidateSessions,
        preservedInterviewerSessions: txResult.preservedInterviewerSessions,
      },
    }
  }

  // All B2 deletions succeeded (or none were needed) — clear staged cleanup marker
  if (txResult.keysToDelete.length > 0) {
    await prisma.appSettings.delete({ where: { key: cleanupKey } }).catch(() => {})
  }

  createAuditLog({
    userId: actingAdminId,
    username: actingAdminUsername ?? undefined,
    action: 'USER_DELETED',
    entityType: 'User',
    entityId: String(targetUserId),
    status: 'SUCCESS',
    metadata: {
      deletedUsername: existingUser.username,
      deletedRole: existingUser.role,
      deletedDocuments: txResult.deletedDocuments,
      deletedChunks: txResult.deletedChunks,
      deletedB2Keys: b2Res.deletedB2Keys,
      preservedSharedKeys: allPreservedShared,
      preservedCandidateSessions: txResult.preservedCandidateSessions,
      preservedInterviewerSessions: txResult.preservedInterviewerSessions,
    },
  })

  return {
    status: 200,
    body: {
      success: true,
      message: `User "${existingUser.username}" deleted successfully.`,
      userId: targetUserId,
      deletedDocuments: txResult.deletedDocuments,
      deletedChunks: txResult.deletedChunks,
      deletedB2Keys: b2Res.deletedB2Keys,
      failedB2Keys: [],
      preservedSharedKeys: allPreservedShared,
      preservedCandidateSessions: txResult.preservedCandidateSessions,
      preservedInterviewerSessions: txResult.preservedInterviewerSessions,
    },
  }
}
