import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/db';
import { verifyOtpHash, OTP_MAX_ATTEMPTS } from '@/lib/otp';
import { getAppSession, getServerInstanceId } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit-log';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, otp, role, purpose = 'EMAIL_VERIFICATION' } = body;

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and verification code are required.' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();
    const targetPurpose = purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET' : 'EMAIL_VERIFICATION';

    if (!/^\d{6}$/.test(cleanOtp)) {
      return NextResponse.json({ error: 'Verification code must be a 6-digit number.' }, { status: 400 });
    }

    // Find the latest unused OTP record for this email AND exact purpose
    const otpRecord = await prisma.otpVerification.findFirst({
      where: {
        email: normalizedEmail,
        purpose: targetPurpose,
        usedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    if (!otpRecord) {
      createAuditLog({
        action: targetPurpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET_OTP_FAILED' : 'EMAIL_VERIFICATION_FAILED',
        status: 'FAILURE',
        metadata: { email: normalizedEmail, reason: 'No active OTP found for purpose', purpose: targetPurpose },
      });
      return NextResponse.json(
        { error: 'No active verification code found for this request. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check expiration
    if (otpRecord.expiresAt < new Date()) {
      await prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { usedAt: new Date() },
      });
      createAuditLog({
        userId: otpRecord.userId ?? undefined,
        action: targetPurpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET_OTP_FAILED' : 'EMAIL_VERIFICATION_FAILED',
        status: 'FAILURE',
        metadata: { email: normalizedEmail, reason: 'Expired OTP', purpose: targetPurpose },
      });
      return NextResponse.json(
        { error: 'This verification code has expired. Please request a new code.' },
        { status: 400 }
      );
    }

    // Check maximum attempts
    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { usedAt: new Date() },
      });
      createAuditLog({
        userId: otpRecord.userId ?? undefined,
        action: targetPurpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET_OTP_FAILED' : 'EMAIL_VERIFICATION_FAILED',
        status: 'FAILURE',
        metadata: { email: normalizedEmail, reason: 'Max attempts exceeded', purpose: targetPurpose },
      });
      return NextResponse.json(
        { error: 'Too many incorrect attempts. This code has been invalidated. Please request a new code.' },
        { status: 400 }
      );
    }

    // Verify OTP hash
    const isValid = verifyOtpHash(cleanOtp, otpRecord.otpHash);

    if (!isValid) {
      const newAttempts = otpRecord.attempts + 1;
      await prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: {
          attempts: newAttempts,
          usedAt: newAttempts >= OTP_MAX_ATTEMPTS ? new Date() : null,
        },
      });

      createAuditLog({
        userId: otpRecord.userId ?? undefined,
        action: targetPurpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET_OTP_FAILED' : 'EMAIL_VERIFICATION_FAILED',
        status: 'FAILURE',
        metadata: { email: normalizedEmail, attempts: newAttempts, purpose: targetPurpose },
      });

      const remaining = OTP_MAX_ATTEMPTS - newAttempts;
      return NextResponse.json(
        {
          error:
            remaining > 0
              ? `Incorrect verification code. ${remaining} attempt(s) remaining.`
              : 'Too many incorrect attempts. This code has been invalidated. Please request a new code.',
        },
        { status: 400 }
      );
    }

    // OTP is valid! Mark as used atomically
    await prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { usedAt: new Date() },
    });

    // Lookup user
    let user = otpRecord.user;
    if (!user) {
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: normalizedEmail },
            { username: normalizedEmail },
            { candidate: { email: normalizedEmail } },
          ],
        },
      });
    }

    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
    }

    // --- FLOW: PASSWORD RESET ---
    if (targetPurpose === 'PASSWORD_RESET') {
      // Issue a single-use reset authorization token
      const resetToken = crypto.randomUUID();
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      // Store in AppSettings
      await prisma.appSettings.upsert({
        where: { key: `pwd_reset_${resetToken}` },
        update: {
          value: JSON.stringify({ userId: user.id, email: normalizedEmail, expiresAt }),
        },
        create: {
          key: `pwd_reset_${resetToken}`,
          value: JSON.stringify({ userId: user.id, email: normalizedEmail, expiresAt }),
        },
      });

      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'PASSWORD_RESET_OTP_VERIFIED',
        status: 'SUCCESS',
        metadata: { email: normalizedEmail },
      });

      // No session is created during password reset!
      return NextResponse.json({
        success: true,
        resetToken,
        message: 'Verification code confirmed. You can now set a new password.',
      });
    }

    // --- FLOW: EMAIL VERIFICATION (Account registration) ---
    // If role was supplied, verify it matches
    if (role && user.role !== role) {
      return NextResponse.json({ error: 'Account role mismatch.' }, { status: 403 });
    }

    // Mark email as verified
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });

    // Ensure Candidate record exists if CANDIDATE
    if (user.role === 'CANDIDATE') {
      const existingCandidate = await prisma.candidate.findUnique({
        where: { userId: user.id },
      });
      if (!existingCandidate) {
        await prisma.candidate.create({
          data: {
            userId: user.id,
            name: user.name || user.username,
            email: normalizedEmail,
          },
        });
      }
    }

    // Establish iron-session after successful registration verification
    const redirectMap: Record<string, string> = {
      ADMIN: '/admin',
      INTERVIEWER: '/dashboard',
      CANDIDATE: '/candidate',
    };
    const redirectUrl = redirectMap[user.role] || '/dashboard';
    const response = NextResponse.json({ success: true, redirect: redirectUrl });
    const session = await getAppSession(req as unknown as Request, response as unknown as Response);

    session.userId = user.id;
    session.username = user.username;
    session.role = user.role;
    session.instanceId = getServerInstanceId();
    session.isLoggedIn = true;
    await session.save();

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'USER_EMAIL_VERIFIED',
      status: 'SUCCESS',
      metadata: { role: user.role, email: normalizedEmail },
    });

    return response;
  } catch (err) {
    console.error('verify-otp error:', err);
    return NextResponse.json({ error: 'Failed to verify code.' }, { status: 500 });
  }
}
