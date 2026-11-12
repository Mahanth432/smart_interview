'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Icon from '@/components/Icon'

export default function LoginPage() {
  const router = useRouter()

  // Form states
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Status & error states
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Check URL query parameters on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const emailParam = params.get('email')
    const resetParam = params.get('reset')
    const verifiedParam = params.get('verified')

    if (emailParam) {
      setUsernameOrEmail(emailParam)
    }
    if (resetParam === 'true') {
      setSuccessMsg('Password has been reset successfully. Please sign in with your new password.')
    } else if (verifiedParam === 'true') {
      setSuccessMsg('Email verified successfully! You can now sign in.')
    }
  }, [])

  // Standard Login Submission
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    const trimmedInput = usernameOrEmail.trim()
    if (!trimmedInput) {
      setError('Please enter your username or email address.')
      return
    }
    if (!password) {
      setError('Please enter your password.')
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmedInput, password }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid username/email or password.')
      }

      // Successful login with automatic server-determined role redirect
      setSuccessMsg('Sign in successful. Redirecting to workspace…')
      const targetUrl = data.redirect || '/dashboard'
      router.push(targetUrl)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-page-bg">
      <div className="auth-card">
        {/* Accent bar */}
        <div style={{ height: '4px', background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #d946ef)' }} />

        <div style={{ padding: '2.25rem' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.9rem' }}>
              <div
                style={{
                  background: 'rgba(99,102,241,0.1)',
                  border: '1px solid rgba(99,102,241,0.2)',
                  color: '#818cf8',
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="memory" size={24} />
              </div>
            </div>
            <h1
              style={{
                fontSize: '1.4rem',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
                margin: '0 0 0.35rem 0',
              }}
            >
              SmartInterview AI
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              Sign In to Your Workspace
            </p>
          </div>

          {/* Feedback banners */}
          {error && (
            <div className="auth-alert auth-alert-error" role="alert">
              <Icon name="error" size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="auth-alert auth-alert-success" role="status">
              <Icon name="check_circle" size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Standard Login Form — No Role Selector */}
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div>
                <label
                  htmlFor="username-or-email"
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    color: 'var(--color-text-secondary)',
                    marginBottom: '0.45rem',
                    fontWeight: 500,
                  }}
                >
                  Username or Email
                </label>
                <input
                  id="username-or-email"
                  type="text"
                  autoComplete="username"
                  className="auth-input"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="Enter username or email"
                  required
                  disabled={isLoading}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <label
                    htmlFor="login-password"
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--color-text-secondary)',
                      fontWeight: 500,
                    }}
                  >
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    style={{
                      fontSize: '0.8rem',
                      color: '#818cf8',
                      textDecoration: 'none',
                      fontWeight: 500,
                    }}
                  >
                    Forgot Password?
                  </Link>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="auth-input auth-input-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="auth-vis-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="auth-submit-btn"
                style={{
                  marginTop: '0.4rem',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#ffffff',
                  boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                {isLoading ? 'Signing In…' : 'Sign In'}
              </button>

              <div style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <span>Don&apos;t have an account? </span>
                  <Link href="/register" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}>
                    Create Account
                  </Link>
                </div>
                <div style={{ fontSize: '0.8rem' }}>
                  <span>Need to set up or reset a password? </span>
                  <Link href="/forgot-password" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500 }}>
                    Verify via Email OTP
                  </Link>
                </div>
              </div>
            </form>
        </div>
      </div>
    </div>
  )
}
