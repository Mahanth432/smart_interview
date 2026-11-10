const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,40}$/
const PASSWORD_MIN_LENGTH = 8

export function normalizeUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function validateUsername(username: string): string | null {
  if (!username) {
    return 'Username is required.'
  }
  if (username.includes('@')) {
    return "Username cannot contain '@'. Please enter a separate username and email address."
  }
  if (username.length < 3 || username.length > 40) {
    return 'Username must be between 3 and 40 characters long.'
  }
  if (!USERNAME_REGEX.test(username)) {
    return 'Username may only contain letters, numbers, underscores (_), dots (.), and hyphens (-).'
  }
  return null
}

export function validateEmail(email: string): string | null {
  if (!email) {
    return 'Email address is required.'
  }
  if (!EMAIL_REGEX.test(email)) {
    return 'Please provide a valid email address.'
  }
  return null
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    return 'Password must contain at least one number or special character.'
  }
  return null
}
