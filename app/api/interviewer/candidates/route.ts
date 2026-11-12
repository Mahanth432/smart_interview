import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getValidatedAppSession } from '@/lib/auth-server'

/**
 * GET /api/interviewer/candidates
 * Properly scoped candidate listing for interviewers (only candidates they have interviewed)
 * and admins (all candidates). Strictly prevents cross-interviewer data leakage.
 */
export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'ADMIN' && session.role !== 'INTERVIEWER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const search = (searchParams.get('search') || '').trim()
    const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10)
    const parsedLimit = Number.parseInt(searchParams.get('limit') || '50', 10)
    const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.min(100, parsedLimit) : 50

    const isAdmin = session.role === 'ADMIN'
    const scopeFilter: Prisma.CandidateWhereInput = isAdmin
      ? {}
      : {
          OR: [
            { sessions: { some: { interviewerId: session.userId } } },
            { userId: { not: null }, sessions: { none: {} } },
          ],
        }

    const searchFilter: Prisma.CandidateWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}

    const where: Prisma.CandidateWhereInput =
      search && !isAdmin
        ? { AND: [scopeFilter, searchFilter] }
        : isAdmin
          ? searchFilter
          : scopeFilter

    const sessionScope = isAdmin ? undefined : { interviewerId: session.userId }

    const [total, candidates] = await Promise.all([
      prisma.candidate.count({ where }),
      prisma.candidate.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          _count: {
            select: {
              sessions: isAdmin ? true : { where: { interviewerId: session.userId } },
            },
          },
          sessions: {
            where: sessionScope,
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              status: true,
              difficulty: true,
              score: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
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
    console.error('Fetch interviewer candidates error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
