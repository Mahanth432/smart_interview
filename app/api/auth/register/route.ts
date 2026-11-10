import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/db';
import { generateSecureOtp, hashOtp, OTP_COOLDOWN_SECONDS } from '@/lib/otp';
import { sendOtpEmail } from '@/lib/mail';
import { createAuditLog } from '@/lib/audit-log';
import {
  normalizeUsername,
  normalizeEmail,
  validateUsername,
  validateEmail,
  validatePasswordStrength,
} from '@/lib/validation/user';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, name, email, password, role } = body;

    const usernameInput = normalizeUsername(username);
    const emailInput = normalizeEmail(email);
    const nameInput = typeof name === 'string' ? name.trim() : '';

    if (!usernameInput || !emailInput || !nameInput || !password) {
      return NextResponse.json(
        { error: 'Username, full name, email, and password are required.' },
        { status: 400 }
      );
    }

    const usernameError = validateUsername(usernameInput);
    if (usernameError) {
      return NextResponse.json({ error: usernameError }, { status: 400 });
    }

    const emailError = validateEmail(emailInput);
    if (emailError) {
      return NextResponse.json({ error: emailError }, { status: 400 });
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

    // Check username and email uniqueness independently
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
    ]);

    if (existingByUsername && (!existingByEmail || existingByUsername.id !== existingByEmail.id)) {
      return NextResponse.json(
        { error: 'This username is already taken. Please choose a different username.' },
        { status: 409 }
      );
    }

    if (existingByEmail) {
      // If the existing account is unverified and has matching role, allow re-registration
      // by sending a new OTP (idempotent — don't create a duplicate user)
      if (!existingByEmail.emailVerified && existingByEmail.role === assignedRole) {
        // Update the password hash, name, and username in case they changed them
        const passwordHash = await bcrypt.hash(password, 12);
        await prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            username: usernameInput,
            email: emailInput,
            passwordHash,
            name: nameInput,
          },
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
            userId: existingByEmail.id,
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
            username: usernameInput,
            email: emailInput,
            role: assignedRole,
            message: 'A verification code has been sent to your email.',
          },
          { status: 200 }
        );
      }

      return NextResponse.json(
        { error: 'An account with this email address already exists. Please log in.' },
        { status: 409 }
      );
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user with independent username & email and emailVerified = false (pending verification)
    const newUser = await prisma.user.create({
      data: {
        username: usernameInput,
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
        username: newUser.username,
        email: emailInput,
        role: assignedRole,
        message: 'Account created. A 6-digit verification code has been sent to your email.',
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(',') : String(err.meta?.target || '');
      if (target.includes('username')) {
        return NextResponse.json(
          { error: 'This username is already taken. Please choose a different username.' },
          { status: 409 }
        );
      }
      if (target.includes('email')) {
        return NextResponse.json(
          { error: 'An account with this email address already exists. Please log in.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'An account with these details already exists.' }, { status: 409 });
    }
    console.error('Registration error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
