/**
 * Neutralizes CSV formula injection (Excel / LibreOffice / Google Sheets)
 * and applies RFC 4180 quoting for commas, quotes, and line breaks.
 */
export function csvEscape(val: unknown): string {
  let str = String(val ?? '')
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export interface ReportLike {
  id?: string
  sessionId?: string
  overallScore?: number
  topicScores?: unknown
  strengths?: string[]
  weaknesses?: string[]
  executiveSummary?: string
  improvementPlan?: string
  aiExecutiveSummary?: string | null
  aiStrengths?: string[]
  aiWeaknesses?: string[]
  aiImprovementPlan?: string | null
  interviewerNotes?: string | null
  editedByUserId?: number | null
  editedByName?: string | null
  editedAt?: Date | string | null
  createdAt?: Date | string
}

/**
 * Strips internal interviewer-only fields from reports when accessed by CANDIDATE users.
 */
export function sanitizeReportForRole<T extends ReportLike | null | undefined>(
  report: T,
  role: string | undefined | null
): T {
  if (!report || role !== 'CANDIDATE') {
    return report
  }

  return {
    ...report,
    interviewerNotes: null,
    editedByUserId: null,
    editedByName: null,
    editedAt: null,
    aiExecutiveSummary: null,
    aiStrengths: [],
    aiWeaknesses: [],
    aiImprovementPlan: null,
  }
}
