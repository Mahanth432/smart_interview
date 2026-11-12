export interface PaginationOptions {
  defaultPage?: number
  defaultLimit?: number
  maxLimit?: number
}

export interface ParsedPagination {
  page: number
  limit: number
  skip: number
}

/**
 * Safely parses `page` and `limit` query parameters without producing `NaN`,
 * non-positive offsets, or unbounded `take` sizes that trigger Prisma runtime errors.
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
  options: PaginationOptions = {}
): ParsedPagination {
  const defaultPage = options.defaultPage ?? 1
  const defaultLimit = options.defaultLimit ?? 20
  const maxLimit = options.maxLimit ?? 100

  const rawPage = searchParams.get('page')
  const rawLimit = searchParams.get('limit')

  const parsedPage = rawPage ? Number.parseInt(rawPage, 10) : defaultPage
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : defaultLimit

  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : defaultPage
  const boundedLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? parsedLimit : defaultLimit
  const limit = Math.min(maxLimit, boundedLimit)

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  }
}

export type ParsedDateRange =
  | { ok: true; gte?: Date; lte?: Date }
  | { ok: false; error: string }

/**
 * Validates optional ISO/date-string bounds (`from`, `to`) and returns structured validation errors
 * instead of passing `Invalid Date` into Prisma filters.
 */
export function parseDateRange(fromStr: string | null | undefined, toStr: string | null | undefined): ParsedDateRange {
  let gte: Date | undefined
  let lte: Date | undefined

  const trimmedFrom = (fromStr || '').trim()
  if (trimmedFrom) {
    const parsed = new Date(trimmedFrom)
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Invalid "from" date filter.' }
    }
    gte = parsed
  }

  const trimmedTo = (toStr || '').trim()
  if (trimmedTo) {
    const parsed = new Date(trimmedTo)
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: 'Invalid "to" date filter.' }
    }
    lte = parsed
  }

  if (gte && lte && gte.getTime() > lte.getTime()) {
    return { ok: false, error: '"from" date must be earlier than or equal to "to" date.' }
  }

  return { ok: true, gte, lte }
}
