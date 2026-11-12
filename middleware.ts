import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getAppSession } from './lib/auth'

/**
 * Helper to produce a JSON response while preserving Set-Cookie headers
 * from the middleware response pipeline (e.g. session invalidation).
 */
function jsonWithCookies(data: unknown, init: ResponseInit, sourceRes: NextResponse): NextResponse {
  const jsonRes = NextResponse.json(data, init)
  sourceRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      jsonRes.headers.append(key, value)
    }
  })
  return jsonRes
}

export async function middleware(request: NextRequest) {
  const t0 = performance.now()
  const res = NextResponse.next()
  
  // We need to pass both request and response to getAppSession in middleware
  const tSession0 = performance.now()
  const session = await getAppSession(request, res)
  const sessionDuration = (performance.now() - tSession0).toFixed(1)

  const pathname = request.nextUrl.pathname
  const isApiRoute = pathname.startsWith('/api')

  // =========================================================================
  // 1. API ROUTE PROTECTION (Defense-in-depth security layer)
  // =========================================================================
  if (isApiRoute) {
    // A. Public API endpoints (Authentication & Health checks)
    const isPublicAuthApi = pathname.startsWith('/api/auth')
    const isHealthApi = pathname === '/api/health'
    if (isPublicAuthApi || isHealthApi) {
      return res
    }

    // B. Unauthenticated requests to any other API route -> 401 Unauthorized
    if (!session?.isLoggedIn || !session.userId) {
      return jsonWithCookies({ error: 'Unauthenticated' }, { status: 401 }, res)
    }

    // C. ADMIN-only API routes (/api/admin/*)
    if (pathname.startsWith('/api/admin')) {
      if (session.role !== 'ADMIN') {
        return jsonWithCookies({ error: 'Unauthorized' }, { status: 403 }, res)
      }
      return res
    }

    // D. CANDIDATE-only API routes (/api/candidate/*)
    if (pathname.startsWith('/api/candidate')) {
      if (session.role !== 'CANDIDATE') {
        return jsonWithCookies({ error: 'Forbidden: Candidates only' }, { status: 403 }, res)
      }
      return res
    }

    // E. INTERVIEWER & ADMIN only API routes (Candidates forbidden)
    const isInterviewerOrAdminApi =
      pathname === '/api/interview/start' ||
      pathname.startsWith('/api/interviewer') ||
      pathname.startsWith('/api/knowledge-base') ||
      pathname.startsWith('/api/documents') ||
      pathname.startsWith('/api/rag')

    if (isInterviewerOrAdminApi) {
      if (session.role === 'CANDIDATE') {
        return jsonWithCookies({ error: 'Forbidden' }, { status: 403 }, res)
      }
      return res
    }

    // F. Shared interview & transcription APIs (/api/interview/*: evaluate, select-question, resume, end, transcribe, transcript)
    // Authenticated users of any role are permitted through middleware;
    // fine-grained session ownership (interviewerId / candidateId) is strictly verified by route handlers.
    return res
  }

  // =========================================================================
  // 2. FRONTEND PAGE ROUTE PROTECTION & REDIRECTS
  // =========================================================================
  const isAuthRoute = 
    pathname.startsWith('/login') || 
    pathname.startsWith('/register') || 
    pathname.startsWith('/forgot-password')
  const isAdminRoute = pathname.startsWith('/admin')
  
  const isProtectedRoute = 
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/interview') ||
    pathname.startsWith('/report') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/candidate') ||
    pathname.startsWith('/suggestions') ||
    pathname.startsWith('/knowledge-base') ||
    isAdminRoute

  if (isProtectedRoute && !session.isLoggedIn) {
    const redirectRes = NextResponse.redirect(new URL('/login', request.url))
    // Copy Set-Cookie headers from the original response (which may contain session destruction)
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        redirectRes.headers.append(key, value)
      }
    })
    return redirectRes
  }

  if (session.isLoggedIn && isAdminRoute && session.role !== 'ADMIN') {
    const targetUrl = session.role === 'CANDIDATE' ? '/candidate' : '/dashboard'
    const redirectRes = NextResponse.redirect(new URL(targetUrl, request.url))
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        redirectRes.headers.append(key, value)
      }
    })
    return redirectRes
  }

  // Candidate restricting from Interviewer-only management routes & unassigned interview setup
  if (session.isLoggedIn && session.role === 'CANDIDATE') {
    const isInterviewWithoutSession =
      pathname === '/interview' && !request.nextUrl.searchParams.has('sessionId')

    const isInterviewerOnlyRoute =
      pathname.startsWith('/dashboard') ||
      pathname.startsWith('/knowledge-base') ||
      pathname.startsWith('/suggestions') ||
      isInterviewWithoutSession

    if (isInterviewerOnlyRoute) {
      const redirectRes = NextResponse.redirect(new URL('/candidate', request.url))
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
          redirectRes.headers.append(key, value)
        }
      })
      return redirectRes
    }
  }

  if (isAuthRoute && session.isLoggedIn) {
    const targetUrl = session.role === 'ADMIN' ? '/admin' : session.role === 'CANDIDATE' ? '/candidate' : '/dashboard'
    const redirectRes = NextResponse.redirect(new URL(targetUrl, request.url))
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        redirectRes.headers.append(key, value)
      }
    })
    return redirectRes
  }

  if (process.env.NODE_ENV === 'development') {
    const totalDuration = (performance.now() - t0).toFixed(1)
    console.log(`[DEV TIMING] Middleware ${pathname}: total=${totalDuration}ms, session=${sessionDuration}ms`)
  }

  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static image/font assets (.png, .jpg, .jpeg, .gif, .svg, .ico, .webp)
     */
    '/((?!_next/static|_next/image|favicon.ico|styles|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
