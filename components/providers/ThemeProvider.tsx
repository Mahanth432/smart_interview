'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

interface ThemeContextType {
  isDark: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  toggleTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('theme') || localStorage.getItem('smartinterview-theme')
      const isDarkActive = stored === 'dark'
      setIsDark(isDarkActive)

      if (isDarkActive) {
        document.documentElement.classList.add('dark-theme')
        document.documentElement.classList.remove('light-theme')
        document.body.classList.add('dark-theme')
        document.body.classList.remove('light-theme')
      } else {
        document.documentElement.classList.add('light-theme')
        document.documentElement.classList.remove('dark-theme')
        document.body.classList.add('light-theme')
        document.body.classList.remove('dark-theme')
      }
    } catch {
      // Fallback default light theme
      document.documentElement.classList.add('light-theme')
    }
  }, [])

  const toggleTheme = () => {
    const nextDark = !isDark
    setIsDark(nextDark)
    const nextThemeStr = nextDark ? 'dark' : 'light'
    try {
      localStorage.setItem('theme', nextThemeStr)
      localStorage.setItem('smartinterview-theme', nextThemeStr)
    } catch {}

    if (nextDark) {
      document.documentElement.classList.add('dark-theme')
      document.documentElement.classList.remove('light-theme')
      document.body.classList.add('dark-theme')
      document.body.classList.remove('light-theme')
    } else {
      document.documentElement.classList.add('light-theme')
      document.documentElement.classList.remove('dark-theme')
      document.body.classList.add('light-theme')
      document.body.classList.remove('dark-theme')
    }
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

