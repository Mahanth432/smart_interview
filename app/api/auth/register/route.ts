import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { generateSecureOtp, hashOtp, OTP_COOLDOWN_SECONDS } from '@/lib/otp';
import { sendOtpEmail } from '@/lib/mail';
import { createAuditLog } from '@/lib/audit-log';

const PASSWORD_MIN_LENGTH = 8;

function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    return 'Password must contain at least one number or special character.';
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, email, password, role } = body;

    const emailInput = (email || '').trim().toLowerCase();
    const nameInput = (name || '').trim();

    if (!emailInput || !nameInput || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required.' },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 });
    }

    // Security check: ADMIN accounts can NEVER be created via public registration
    if (role === 'ADMIN') {
      return NextResponse.json(
        { error: 'Administrator accounts cannot be created via public registration.' },
        { status: 403 }
      );
    }

    const assignedRole: 'CANDIDATE' | 'INTERVIEWER' =
      role === 'INTERVIEWER' ? 'INTERVIEWER' : 'CANDIDATE';

    // Validate password strength
    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Check if an account with this email already exists
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: emailInput },
          { username: emailInput },
          { candidate: { email: emailInput } },
        ],
      },
    });

    if (existing) {
      // If the existing account is unverified and has matching role, allow re-registration
      // by sending a new OTP (idempotent — don't create a duplicate user)
      if (!existing.emailVerified && existing.role === assignedRole) {
        // Update the password hash in case they forgot it
        const passwordHash = await bcrypt.hash(password, 12);
        await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, name: nameInput },
        });

        // Rate limit: check cooldown
        const recentOtp = await prisma.otpVerification.findFirst({
          where: {
            email: emailInput,
            purpose: 'EMAIL_VERIFICATION',
            createdAt: { gt: new Date(Date.now() - OTP_COOLDOWN_SECONDS * 1000) },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (recentOtp) {
          return NextResponse.json(
            { error: 'A verification code was recently sent. Please check your email or wait before retrying.' },
            { status: 429 }
          );
        }

        // Invalidate old OTPs
        await prisma.otpVerification.updateMany({
          where: { email: emailInput, usedAt: null, purpose: 'EMAIL_VERIFICATION' },
          data: { usedAt: new Date() },
        });

        // Generate new OTP
        const otp = generateSecureOtp();
        const otpHash = hashOtp(otp);
        await prisma.otpVerification.create({
          data: {
            userId: existing.id,
            email: emailInput,
            otpHash,
            purpose: 'EMAIL_VERIFICATION',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            attempts: 0,
          },
        });

        const emailSent = await sendOtpEmail({ email: emailInput, otp, role: assignedRole });
        if (!emailSent && process.env.NODE_ENV === 'production') {
          return NextResponse.json({ error: 'Failed to send verification email. Please try again.' }, { status: 500 });
        }

        return NextResponse.json(
          {
            success: true,
            otpRequired: true,
            email: emailInput,
            role: assignedRole,
            message: 'A verification code has been sent to your email.',
          },
          { status: 200 }
        );
      }

      return NextResponse.json(
        { error: 'An account with this email already exists. Please log in.' },
        { status: 409 }
      );
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user with emailVerified = false (pending verification)
    const newUser = await prisma.user.create({
      data: {
        username: emailInput,
        email: emailInput,
        name: nameInput,
        passwordHash,
        role: assignedRole,
        emailVerified: false,
      },
    });

    // Create Candidate profile if needed
    if (assignedRole === 'CANDIDATE') {
      await prisma.candidate.create({
        data: {
          userId: newUser.id,
          name: nameInput,
          email: emailInput,
        },
      });
    }

    // Generate and send OTP for email verification
    const otp = generateSecureOtp();
    const otpHash = hashOtp(otp);

    await prisma.otpVerification.create({
      data: {
        userId: newUser.id,
        email: emailInput,
        otpHash,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
      },
    });

    const emailSent = await sendOtpEmail({ email: emailInput, otp, role: assignedRole });
    if (!emailSent && process.env.NODE_ENV === 'production') {
      // In production, if email fails, don't leave an unverifiable account
      // The account stays unverified — user can retry registration
      return NextResponse.json({ error: 'Failed to send verification email. Please try again.' }, { status: 500 });
    }

    createAuditLog({
      userId: newUser.id,
      username: newUser.username,
      action: 'USER_REGISTERED',
      status: 'SUCCESS',
      metadata: { role: assignedRole, email: emailInput },
    });

    return NextResponse.json(
      {
        success: true,
        otpRequired: true,
        email: emailInput,
        role: assignedRole,
        message: 'Account created. A 6-digit verification code has been sent to your email.',
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Registration error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
