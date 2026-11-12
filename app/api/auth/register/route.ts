import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { hashOtp, generateSecureOtp, OTP_EXPIRATION_MINUTES } from '@/lib/otp'
import { sendOtpEmail } from '@/lib/mail'
import { createAuditLog } from '@/lib/audit-log'
import { checkRateLimit, extractClientIp, rateLimitResponse } from '@/lib/rate-limit'
import {
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePasswordStrength,
} from '@/lib/validation/user'

export async function POST(request: Request) {
  try {
    const clientIp = extractClientIp(request)
    const ipLimit = await checkRateLimit({
      key: `register:ip:${clientIp}`,
      limit: 10,
      windowSeconds: 60 * 60,
    })
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit.retryAfterSeconds,
        'Too many registration attempts from your network. Please try again later.'
      )
    }

    const body = await request.json()
    const { username, name, email, password, role } = body

    const usernameInput = normalizeUsername(username)
    const emailInput = normalizeEmail(email)
    const nameInput = typeof name === 'string' ? name.trim() : ''

    if (!usernameInput || !emailInput || !nameInput || !password) {
      return NextResponse.json(
        { error: 'Username, full name, email, and password are required.' },
        { status: 400 }
      )
    }

    const usernameError = validateUsername(usernameInput)
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 })
    }

    const emailError = validateEmail(emailInput)
    if (emailError) {
      return NextResponse.json({ error: emailError }, { status: 400 })
    }

    if (role === 'ADMIN') {
      return NextResponse.json(
        { error: 'Administrator accounts cannot be created via public registration.' },
        { status: 403 }
      )
    }

    const assignedRole: 'CANDIDATE' | 'INTERVIEWER' =
      role === 'INTERVIEWER' ? 'INTERVIEWER' : 'CANDIDATE'

    const passwordError = validatePasswordStrength(password)
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 })
    }

    const [existingByEmail, existingByUsername] = await Promise.all([
      prisma.user.findFirst({
        where: {
          OR: [
            { email: emailInput },
            { username: emailInput },
            { candidate: { email: emailInput } },
          ],
        },
      }),
      prisma.user.findFirst({
        where: {
          username: { equals: usernameInput, mode: 'insensitive' },
        },
      }),
    ])

    if (existingByUsername && (!existingByEmail || existingByUsername.id !== existingByEmail.id)) {
      return NextResponse.json(
        { error: 'This username is already taken. Please choose a different username.' },
        { status: 409 }
      )
    }

    // Never allow an unauthenticated caller to overwrite an existing unverified account's credentials or username
    if (existingByEmail) {
      if (!existingByEmail.emailVerified) {
        return NextResponse.json(
          {
            error:
              'A pending unverified account already exists for this email. Please verify your email with the OTP code or request a new verification code.',
          },
          { status: 409 }
        )
      }

      return NextResponse.json(
        { error: 'An account with this email address already exists. Please log in.' },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const otp = generateSecureOtp()
    const otpHash = hashOtp(otp)
    const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60 * 1000)

    // Atomic creation of User + optional Candidate + initial OTP
    const newUser = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          username: usernameInput,
          email: emailInput,
          name: nameInput,
          passwordHash,
          role: assignedRole,
          emailVerified: false,
        },
      })

      if (assignedRole === 'CANDIDATE') {
        await tx.candidate.create({
          data: {
            userId: createdUser.id,
            name: nameInput,
            email: emailInput,
          },
        })
      }

      await tx.otpVerification.create({
        data: {
          userId: createdUser.id,
          email: emailInput,
          otpHash,
          purpose: 'EMAIL_VERIFICATION',
          expiresAt,
          attempts: 0,
        },
      })

      return createdUser
    })

    const emailSent = await sendOtpEmail({
      email: emailInput,
      otp,
      role: assignedRole,
      purpose: 'EMAIL_VERIFICATION',
    })
    if (!emailSent && process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Account created, but verification email could not be sent. Please request a new code.' },
        { status: 500 }
      )
    }

    createAuditLog({
      userId: newUser.id,
      username: newUser.username,
      action: 'USER_REGISTERED',
      status: 'SUCCESS',
      metadata: { role: assignedRole, email: emailInput },
    })

    return NextResponse.json(
      {
        success: true,
        otpRequired: true,
        username: newUser.username,
        email: emailInput,
        role: assignedRole,
        message: 'Account created. A 6-digit verification code has been sent to your email.',
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '')
      if (target.includes('username')) {
        return NextResponse.json(
          { error: 'This username is already taken. Please choose a different username.' },
          { status: 409 }
        )
      }
      if (target.includes('email')) {
        return NextResponse.json(
          { error: 'An account with this email address already exists. Please log in.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'An account with these details already exists.' }, { status: 409 })
    }
    console.error('Registration error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
