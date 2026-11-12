import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import { parsePaginationParams } from '@/lib/validation/query'
import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'ADMIN' && session.role !== 'INTERVIEWER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''
    const { page, limit, skip } = parsePaginationParams(searchParams, { defaultLimit: 20, maxLimit: 100 })
    // limit parsed via parsePaginationParams above

    const where: Prisma.CandidateWhereInput = {}

    if (search.trim()) {
      const q = search.trim()
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ]
    }

    const [total, candidates] = await Promise.all([
      prisma.candidate.count({ where }),
      prisma.candidate.findMany({
        where,
        include: {
          _count: {
            select: {
              sessions: true,
            },
          },
          sessions: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              status: true,
              interviewType: true,
              score: true,
              report: {
                select: {
                  overallScore: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ])

    return NextResponse.json({
      candidates,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    })
  } catch (err) {
    console.error('Fetch admin candidates error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
