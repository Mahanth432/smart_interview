import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/db';
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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { resetToken, newPassword } = body;

    if (!resetToken || !newPassword) {
      return NextResponse.json(
        { error: 'Reset token and new password are required.' },
        { status: 400 }
      );
    }

    const passwordError = validatePasswordStrength(newPassword);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const key = `pwd_reset_${resetToken}`;

    // Atomically find and delete the reset authorization token in a single transaction
    const authRecord = await prisma.$transaction(async (tx) => {
      const record = await tx.appSettings.findUnique({
        where: { key },
      });

      if (!record) return null;

      // Delete immediately so it cannot be reused
      await tx.appSettings.delete({
        where: { key },
      });

      return record;
    });

    if (!authRecord) {
      return NextResponse.json(
        { error: 'Invalid or expired password reset authorization. Please request a new code.' },
        { status: 400 }
      );
    }

    let payload: { userId: number; email: string; expiresAt: number };
    try {
      payload = JSON.parse(authRecord.value);
    } catch {
      return NextResponse.json({ error: 'Corrupt reset token.' }, { status: 400 });
    }

    // Check expiration (10 minutes)
    if (payload.expiresAt < Date.now()) {
      return NextResponse.json(
        { error: 'Password reset authorization has expired. Please request a new code.' },
        { status: 400 }
      );
    }

    // Find the user
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    // Hash the new password with bcrypt (12 rounds)
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update user password and ensure email is verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        emailVerified: true,
      },
    });

    // Invalidate any remaining OTPs for this user
    await prisma.otpVerification.updateMany({
      where: {
        email: payload.email,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'PASSWORD_RESET_SUCCESS',
      status: 'SUCCESS',
      metadata: { role: user.role, email: payload.email },
    });

    // Do NOT log the user in immediately. Require sign-in with the new password.
    return NextResponse.json({
      success: true,
      message: 'Your password has been reset successfully. Please sign in with your new password.',
    });
  } catch (err) {
    console.error('reset-password error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
