import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { parsePaginationParams } from '@/lib/validation/query'
import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'

import { formatInterviewerName } from '@/lib/formatters'

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
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || 'ALL'
    const { page, limit, skip } = parsePaginationParams(searchParams, { defaultLimit: 20, maxLimit: 100 })
    // limit parsed via parsePaginationParams above

    const where: Prisma.InterviewSessionWhereInput = {}

    if (status && status !== 'ALL') {
      where.status = status
    }

    if (search.trim()) {
      const q = search.trim()
      where.OR = [
        { interviewType: { contains: q, mode: 'insensitive' } },
        { candidate: { name: { contains: q, mode: 'insensitive' } } },
        { candidate: { email: { contains: q, mode: 'insensitive' } } },
        { interviewer: { username: { contains: q, mode: 'insensitive' } } },
      ]
    }

    const [total, rawInterviews] = await Promise.all([
      prisma.interviewSession.count({ where }),
      prisma.interviewSession.findMany({
        where,
        include: {
          candidate: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          interviewer: {
            select: {
              id: true,
              username: true,
              email: true,
              role: true,
              candidate: { select: { name: true } },
            },
          },
          report: {
            select: {
              id: true,
              overallScore: true,
            },
          },
          _count: {
            select: {
              questions: true,
            },
          },
        },
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    const interviews = rawInterviews.map((item) => ({
      ...item,
      interviewer: item.interviewer
        ? {
            id: item.interviewer.id,
            username: item.interviewer.username,
            displayName: formatInterviewerName(item.interviewer),
            role: item.interviewer.role,
          }
        : null,
    }))

    return NextResponse.json({
      interviews,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    })
  } catch (err) {
    console.error('Fetch admin interviews error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
