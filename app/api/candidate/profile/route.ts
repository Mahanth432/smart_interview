import { NextResponse } from 'next/server'
import { getValidatedAppSession } from '@/lib/auth-server'
import prisma from '@/lib/db'

export async function GET(request: Request) {
  try {
    const response = NextResponse.json({})
    const session = await getValidatedAppSession(request, response)

    if (!session?.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    }

    if (session.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Find or create Candidate profile tied strictly to authenticated user.id
    let candidate = await prisma.candidate.findUnique({
      where: { userId: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      }
    })

    if (!candidate) {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { username: true }
      })

      const created = await prisma.candidate.create({
        data: {
          userId: session.userId,
          name: user?.username || 'Candidate',
          email: user?.username.includes('@') ? user.username : null,
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        }
      })
      candidate = created
    }

    return NextResponse.json({ candidate })
  } catch (err) {
    console.error('Candidate profile API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
