import { NextResponse } from 'next/server'

function getExpectedOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost) {
    const proto = forwardedProto || 'https'
    return `${proto}://${forwardedHost}`.toLowerCase()
  }

  const host = request.headers.get('host')?.trim()
  if (host) {
    try {
      const url = new URL(request.url)
      return `${url.protocol}//${host}`.toLowerCase()
    } catch {
      return null
    }
  }

  try {
    return new URL(request.url).origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Validates that state-mutating browser requests originate from the same origin.
 * Returns null if valid, or a 403 NextResponse if Origin/Referer mismatches.
 */
export function verifySameOrigin(request: Request): NextResponse | null {
  const expectedOrigin = getExpectedOrigin(request)
  if (!expectedOrigin) {
    return NextResponse.json({ error: 'Unable to verify request origin' }, { status: 403 })
  }

  const originHeader = request.headers.get('origin')?.trim()
  if (originHeader) {
    if (originHeader.toLowerCase() !== expectedOrigin) {
      return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
    }
    return null
  }

  const refererHeader = request.headers.get('referer')?.trim()
  if (refererHeader) {
    try {
      const refererOrigin = new URL(refererHeader).origin.toLowerCase()
      if (refererOrigin !== expectedOrigin) {
        return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 })
      }
      return null
    } catch {
      return NextResponse.json({ error: 'Invalid Referer header' }, { status: 403 })
    }
  }

  // Reject cross-site Sec-Fetch-Site when browser sends fetch metadata without Origin/Referer
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site request rejected' }, { status: 403 })
  }

  return null
}
