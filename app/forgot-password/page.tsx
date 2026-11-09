'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Icon from '@/components/Icon'

type ForgotStep = 'request' | 'otp' | 'new-password'

interface OtpInputProps {
  value: string[]
  onChange: (digits: string[]) => void
  disabled?: boolean
}

function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  const handleKey = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (value[idx]) {
        const next = [...value]
        next[idx] = ''
        onChange(next)
      } else if (idx > 0) {
        refs.current[idx - 1]?.focus()
      }
    }
  }

  const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '')
    if (!raw) return
    const chars = raw.split('')
    const next = [...value]
    let focusIdx = idx
    chars.forEach((ch, i) => {
      if (idx + i < 6) {
        next[idx + i] = ch
        focusIdx = idx + i
      }
    })
    onChange(next)
    if (focusIdx < 5) refs.current[focusIdx + 1]?.focus()
  }

  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
      {value.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="otp-box"
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          placeholder="·"
          autoFocus={i === 0}
          disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  )
}

export default function ForgotPasswordPage() {
  const router = useRouter()

  const [step, setStep] = useState<ForgotStep>('request')
  const [email, setEmail] = useState('')
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [resetToken, setResetToken] = useState('')

  // New Password state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Status & loading
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  const otpString = otpDigits.join('')

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => setResendCooldown((prev) => prev - 1), 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // Password strength helper
  const getPasswordStrength = (pw: string): { label: string; color: string; pct: number } => {
    if (pw.length === 0) return { label: '', color: 'transparent', pct: 0 }
    let score = 0
    if (pw.length >= 8) score++
    if (/[A-Z]/.test(pw)) score++
    if (/[0-9]/.test(pw)) score++
    if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(pw)) score++
    const map: Record<number, { label: string; color: string; pct: number }> = {
      0: { label: 'Too weak', color: '#ef4444', pct: 15 },
      1: { label: 'Weak', color: '#f97316', pct: 35 },
      2: { label: 'Fair', color: '#eab308', pct: 60 },
      3: { label: 'Good', color: '#22c55e', pct: 80 },
      4: { label: 'Strong', color: '#10b981', pct: 100 },
    }
    return map[score]
  }
  const strength = getPasswordStrength(newPassword)

  // Step 1: Request Password Reset
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) {
      setError('Please enter your email address.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          purpose: 'PASSWORD_RESET',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to request password reset.')
      }

      setStep('otp')
      setResendCooldown(60)
      setSuccessMsg(data.message || 'If an account exists with this email, a verification code has been sent.')
      setOtpDigits(['', '', '', '', '', ''])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request password reset.')
    } finally {
      setIsLoading(false)
    }
  }

  // Resend OTP
  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0 || isLoading) return
    setError('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          purpose: 'PASSWORD_RESET',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to resend code.')
      setResendCooldown(60)
      setSuccessMsg('A new verification code has been sent.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code.')
    } finally {
      setIsLoading(false)
    }
  }, [email, resendCooldown, isLoading])

  // Step 2: Verify Reset OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otpString.length !== 6) {
      setError('Please enter all 6 digits.')
      return
    }

    setError('')
    setSuccessMsg('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: otpString,
          purpose: 'PASSWORD_RESET',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Invalid or expired verification code.')
      }

      if (!data.resetToken) {
        throw new Error('Reset authorization failed.')
      }

      setResetToken(data.resetToken)
      setStep('new-password')
      setSuccessMsg('Verification confirmed! Please set your new password.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Step 3: Set New Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    if (!newPassword) {
      setError('Please enter a new password.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (!/[0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(newPassword)) {
      setError('Password must contain at least one number or special character.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetToken,
          newPassword,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password.')
      }

      // Redirect to login page with reset success flag
      router.push('/login?reset=true')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password.')
    } finally {
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
                <Icon
                  name={
                    step === 'request'
                      ? 'lock_reset'
                      : step === 'otp'
                      ? 'mark_email_read'
                      : 'key'
                  }
                  size={24}
                />
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
              {step === 'request'
                ? 'Forgot Password'
                : step === 'otp'
                ? 'Verify Code'
                : 'Set New Password'}
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', margin: 0 }}>
              {step === 'request'
                ? 'Enter your registered email to receive a password reset code.'
                : step === 'otp'
                ? 'Enter the 6-digit code sent to your email.'
                : 'Create a secure new password for your account.'}
            </p>
          </div>

          {/* Progress bar */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '1.5rem' }}>
            {['request', 'otp', 'new-password'].map((s, i) => {
              const activeIndex = step === 'request' ? 0 : step === 'otp' ? 1 : 2
              return (
                <div
                  key={s}
                  style={{
                    flex: 1,
                    height: '3px',
                    borderRadius: '99px',
                    background: i <= activeIndex ? '#6366f1' : 'var(--color-card-border)',
                    transition: 'background 0.3s',
                  }}
                />
              )
            })}
          </div>

          {/* Alerts */}
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

          {/* STEP 1: Request Reset */}
          {step === 'request' && (
            <form onSubmit={handleRequestReset} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div>
                <label
                  htmlFor="reset-email"
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    color: 'var(--color-text-secondary)',
                    marginBottom: '0.45rem',
                    fontWeight: 500,
                  }}
                >
                  Email Address
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  className="auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. alex@example.com"
                  required
                  disabled={isLoading}
                />
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
                {isLoading ? 'Sending Code…' : 'Send Verification Code'}
              </button>

              <div style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                <Link href="/login" style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Icon name="arrow_back" size={16} /> Return to Sign In
                </Link>
              </div>
            </form>
          )}

          {/* STEP 2: Verify OTP */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="auth-alert auth-alert-info" style={{ marginBottom: '0.25rem', alignItems: 'center' }}>
                <Icon name="mark_email_read" size={18} style={{ flexShrink: 0 }} />
                <div>
                  Verification code sent to <strong style={{ wordBreak: 'break-all' }}>{email}</strong>
                </div>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    color: 'var(--color-text-secondary)',
                    marginBottom: '0.75rem',
                    fontWeight: 500,
                    textAlign: 'center',
                  }}
                >
                  Enter 6-digit code
                </label>
                <OtpInput value={otpDigits} onChange={setOtpDigits} disabled={isLoading} />
              </div>

              <button
                type="submit"
                disabled={isLoading || otpString.length !== 6}
                className="auth-submit-btn"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#ffffff',
                  cursor: isLoading || otpString.length !== 6 ? 'not-allowed' : 'pointer',
                  opacity: isLoading || otpString.length !== 6 ? 0.7 : 1,
                }}
              >
                {isLoading ? 'Verifying…' : 'Verify Code & Continue'}
              </button>

              {/* Resend Cooldown */}
              <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                {resendCooldown > 0 ? (
                  <span>
                    Resend code in <strong style={{ color: 'var(--color-text-secondary)' }}>{resendCooldown}s</strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={isLoading}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#818cf8',
                      fontWeight: 500,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Resend Code
                  </button>
                )}
              </div>

              <div style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep('request')
                    setError('')
                    setSuccessMsg('')
                    setOtpDigits(['', '', '', '', '', ''])
                  }}
                  className="auth-back-btn"
                  style={{ margin: '0 auto', fontSize: '0.82rem' }}
                >
                  <Icon name="arrow_back" size={14} /> Change Email
                </button>
              </div>
            </form>
          )}

          {/* STEP 3: Set New Password */}
          {step === 'new-password' && (
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              <div>
                <label
                  htmlFor="reset-new-pass"
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    color: 'var(--color-text-secondary)',
                    marginBottom: '0.45rem',
                    fontWeight: 500,
                  }}
                >
                  New Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="reset-new-pass"
                    type={showNewPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="auth-input auth-input-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 chars, 1 number or symbol"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="auth-vis-toggle"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showNewPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>

                {/* Password strength bar */}
                {newPassword.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <div
                      style={{
                        height: '3px',
                        borderRadius: '99px',
                        background: 'var(--color-card-border)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${strength.pct}%`,
                          background: strength.color,
                          transition: 'width 0.3s, background 0.3s',
                          borderRadius: '99px',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '0.72rem', color: strength.color, marginTop: '3px', display: 'block' }}>
                      {strength.label}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="reset-confirm-pass"
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    color: 'var(--color-text-secondary)',
                    marginBottom: '0.45rem',
                    fontWeight: 500,
                  }}
                >
                  Confirm New Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="reset-confirm-pass"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="auth-input auth-input-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your new password"
                    required
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    className="auth-vis-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    <Icon name={showConfirmPassword ? 'visibility_off' : 'visibility'} size={18} />
                  </button>
                </div>
                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                  <span style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '3px', display: 'block' }}>
                    Passwords do not match
                  </span>
                )}
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
                {isLoading ? 'Updating Password…' : 'Submit New Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
