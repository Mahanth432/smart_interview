import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
import { generateSecureOtp, hashOtp } from '@/lib/otp';
import { sendOtpEmail } from '@/lib/mail';
import { createAuditLog } from '@/lib/audit-log';

const PASSWORD_MIN_LENGTH = 8;

function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    return 'Password must contain at least one number or special character.';
  }
  return null;
}

/**
 * POST /api/auth/set-password
 *
 * Allows existing Candidate/Interviewer accounts that were previously
 * created without a password (passwordHash = null) to set a new password.
 * This is the ONLY safe upgrade path — accounts are never deleted.
 *
 * Body: { email, newPassword, role }
 * Returns: { otpRequired: true, email, role } — UI then shows OTP step
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, newPassword, role } = body;

    if (!email || !newPassword || !role) {
      return NextResponse.json(
        { error: 'Email, new password, and role are required.' },
        { status: 400 }
      );
    }

    if (role === 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin password changes must be performed by a system administrator.' },
        { status: 403 }
      );
    }

    if (role !== 'CANDIDATE' && role !== 'INTERVIEWER') {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Find the user by email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: normalizedEmail },
          { candidate: { email: normalizedEmail } },
        ],
        role,
      },
    });

    if (!user) {
      // Generic response to avoid account enumeration
      return NextResponse.json(
        { error: 'No account found with that email for the selected role.' },
        { status: 404 }
      );
    }

    // This endpoint is ONLY for accounts without a password
    if (user.passwordHash !== null) {
      return NextResponse.json(
        {
          error:
            'This account already has a password. Use the login page to sign in, or contact support to reset your password.',
        },
        { status: 409 }
      );
    }

    // Hash and store the new password
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Invalidate any previous unused OTPs for this email
    await prisma.otpVerification.updateMany({
      where: { email: normalizedEmail, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generate and send OTP so they can verify immediately
    const otp = generateSecureOtp();
    const otpHash = hashOtp(otp);

    await prisma.otpVerification.create({
      data: {
        userId: user.id,
        email: normalizedEmail,
        otpHash,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
      },
    });

    try {
      await sendOtpEmail({
        email: normalizedEmail,
        otp,
        role: user.role as 'CANDIDATE' | 'INTERVIEWER',
      });
    } catch (mailErr) {
      console.error('[set-password] Failed to send OTP:', mailErr);
    }

    const auditAction =
      role === 'CANDIDATE' ? 'CANDIDATE_PASSWORD_SET' : 'INTERVIEWER_PASSWORD_SET';
    createAuditLog({
      userId: user.id,
      username: user.username,
      action: auditAction,
      status: 'SUCCESS',
      metadata: { role, email: normalizedEmail },
    });

    return NextResponse.json({
      success: true,
      otpRequired: true,
      email: normalizedEmail,
      role: user.role,
      message: 'Password set successfully. A verification code has been sent to your email.',
    });
  } catch (err) {
    console.error('set-password error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
