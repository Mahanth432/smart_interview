import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { parsePaginationParams, parseDateRange } from '@/lib/validation/query'
import prisma from '@/lib/db'
import { sanitizeMetadata } from '@/lib/audit-log'
import { Prisma } from '@prisma/client'

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const { page, limit, skip } = parsePaginationParams(searchParams, { defaultLimit: 25, maxLimit: 100 })
    // limit parsed via parsePaginationParams above
    const action = searchParams.get('action') || ''
    const status = searchParams.get('status') || ''
    const userIdStr = searchParams.get('userId') || ''
    const search = searchParams.get('search') || ''
    const fromStr = searchParams.get('from') || ''
    const toStr = searchParams.get('to') || ''
    const dateRange = parseDateRange(fromStr, toStr)
    if (!dateRange.ok) {
      return NextResponse.json({ error: dateRange.error }, { status: 400 })
    }

    const where: Prisma.AuditLogWhereInput = {}

    if (action.trim()) {
      where.action = action.trim()
    }

    if (status.trim()) {
      where.status = status.trim()
    }

    if (userIdStr.trim()) {
      const uId = parseInt(userIdStr.trim(), 10)
      if (!isNaN(uId)) {
        where.userId = uId
      }
    }

    if (search.trim()) {
      const q = search.trim()
      where.OR = [
        { action: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { entityType: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
      ]
    }

    if (fromStr || toStr) {
      where.createdAt = {}
      if (fromStr) {
        where.createdAt.gte = new Date(fromStr)
      }
      if (toStr) {
        where.createdAt.lte = new Date(toStr)
      }
    }

    const [total, rawLogs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    // Extra defensive pass: sanitize metadata on output to guarantee no credentials leak
    const auditLogs = rawLogs.map((log) => ({
      id: log.id,
      userId: log.userId,
      username: log.username || 'System / Anonymous',
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      status: log.status,
      metadata: log.metadata ? sanitizeMetadata(log.metadata) : null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      createdAt: log.createdAt.toISOString(),
    }))

    return NextResponse.json({
      auditLogs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    })
  } catch (err) {
    console.error('Fetch admin audit logs error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
