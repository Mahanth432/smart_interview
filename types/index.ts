export interface FollowUpQuestion {
  id: string
  text: string
  topic: string
  diff: 'beginner' | 'intermediate' | 'advanced'
  skill: string
  reason: string
}

export interface AiFeedback {
  understanding: number
  completeness: number
  confidence: number
  comm: number
  tech: number
  match: number
  missing: string[]
  followups: FollowUpQuestion[]
}

export interface Question {
  num: string
  question: string
  mockAnswer: string
  aiFeedback: AiFeedback
}

export interface Scores {
  technical: number
  problemSolving: number
  confidence: number
  communication: number
  overall: number
  radar: number[] // [Programming, OOP, DBMS, OS, Aptitude, Comm]
}

export interface Candidate {
  key: string
  name: string
  title: string
  experience: string
  education: string
  location: string
  stack: string
  avatar: string
  badge: string
  scores: Scores
  currentQuestionIndex: number
  questions: Question[]
}

export interface RecentSession {
  key: string | null
  name: string
  position: string
  date: string
  score: string
  status: 'active' | 'completed' | 'pending'
}

export interface AppState {
  activeScreen: string
  currentInterviewer: string
  difficulty: string
  isVoiceActive: boolean
  isRecording: boolean
  timerSeconds: number
  candidates: Record<string, Candidate>
  activeCandidateKey: string
  allGeneratedFollowUps: FollowUpQuestion[]
  recentSessions: RecentSession[]
}
