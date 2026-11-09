'use client'

import React, { createContext, useContext, useState, ReactNode } from 'react'
import { AppState, Candidate } from '@/types'
import { candidatesData, recentSessionsData } from '@/data/mockData'

interface InterviewStateContextType {
  state: AppState
  setState: React.Dispatch<React.SetStateAction<AppState>>
  activeCandidate: Candidate
}

const InterviewStateContext = createContext<InterviewStateContextType | undefined>(undefined)

export const InterviewStateProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AppState>({
    activeScreen: 'dashboard',
    currentInterviewer: 'System Admin',
    difficulty: 'intermediate',
    isVoiceActive: false,
    isRecording: false,
    timerSeconds: 0,
    candidates: candidatesData,
    activeCandidateKey: 'candidate1',
    allGeneratedFollowUps: [],
    recentSessions: recentSessionsData
  })

  const activeCandidate = state.candidates[state.activeCandidateKey]

  return (
    <InterviewStateContext.Provider value={{ state, setState, activeCandidate }}>
      {children}
    </InterviewStateContext.Provider>
  )
}

export const useInterviewState = () => {
  const context = useContext(InterviewStateContext)
  if (context === undefined) {
    throw new Error('useInterviewState must be used within an InterviewStateProvider')
  }
  return context
}
