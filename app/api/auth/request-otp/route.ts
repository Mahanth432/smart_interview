import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { generateSecureOtp, hashOtp, OTP_COOLDOWN_SECONDS } from '@/lib/otp';
import { sendOtpEmail } from '@/lib/mail';
import { createAuditLog } from '@/lib/audit-log';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, role, purpose = 'EMAIL_VERIFICATION' } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    const otpPurpose = purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET' : 'EMAIL_VERIFICATION';

    // Rate Limiting: Check cooldown (60 seconds) for this email and purpose
    const recentOtp = await prisma.otpVerification.findFirst({
      where: {
        email: normalizedEmail,
        purpose: otpPurpose,
        createdAt: { gt: new Date(Date.now() - OTP_COOLDOWN_SECONDS * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const remainingSeconds = Math.ceil(
        (recentOtp.createdAt.getTime() + OTP_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000
      );
      return NextResponse.json(
        { error: `Please wait ${Math.max(remainingSeconds, 1)} seconds before requesting another code.` },
        { status: 429 }
      );
    }

    // Rate Limiting: Max 5 requests per hour per email
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const hourlyCount = await prisma.otpVerification.count({
      where: {
        email: normalizedEmail,
        purpose: otpPurpose,
        createdAt: { gt: oneHourAgo },
      },
    });

    if (hourlyCount >= 5) {
      return NextResponse.json(
        { error: 'Too many requests for this email. Please try again in an hour.' },
        { status: 429 }
      );
    }

    // Lookup user by email or username, or candidate profile
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { username: normalizedEmail },
          { candidate: { email: normalizedEmail } },
        ],
      },
      include: { candidate: true },
    });

    // If PASSWORD_RESET flow:
    if (otpPurpose === 'PASSWORD_RESET') {
      // Generic success response regardless of user existence to prevent account enumeration
      if (!user) {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[password-reset] No user matched email: "${normalizedEmail}"`);
        }
        return NextResponse.json({
          success: true,
          message: 'If an account exists with this email, a verification code has been sent.',
        });
      }

      // Invalidate any previous unused PASSWORD_RESET OTPs for this email
      await prisma.otpVerification.updateMany({
        where: { email: normalizedEmail, usedAt: null, purpose: 'PASSWORD_RESET' },
        data: { usedAt: new Date() },
      });

      // Generate, hash, and store OTP
      const otp = generateSecureOtp();
      const otpHash = hashOtp(otp);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.otpVerification.create({
        data: {
          userId: user.id,
          email: normalizedEmail,
          otpHash,
          purpose: 'PASSWORD_RESET',
          expiresAt,
          attempts: 0,
        },
      });

      await sendOtpEmail({
        email: normalizedEmail,
        otp,
        role: user.role,
        purpose: 'PASSWORD_RESET',
      });

      createAuditLog({
        userId: user.id,
        username: user.username,
        action: 'PASSWORD_RESET_OTP_REQUESTED',
        status: 'SUCCESS',
        metadata: { email: normalizedEmail },
      });

      return NextResponse.json({
        success: true,
        message: 'If an account exists with this email, a verification code has been sent.',
      });
    }

    // EMAIL_VERIFICATION flow (for registration verification resends)
    if (role === 'ADMIN') {
      return NextResponse.json(
        { error: 'Admin accounts do not require email verification.' },
        { status: 403 }
      );
    }

    if (!user || (role && user.role !== role)) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[request-otp] No matching user for verification email: "${normalizedEmail}"`);
      }
      return NextResponse.json({
        success: true,
        message: 'If an account is associated with this email, a verification code has been sent.',
      });
    }

    // Invalidate previous unused EMAIL_VERIFICATION OTPs
    await prisma.otpVerification.updateMany({
      where: { email: normalizedEmail, usedAt: null, purpose: 'EMAIL_VERIFICATION' },
      data: { usedAt: new Date() },
    });

    const otp = generateSecureOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await prisma.otpVerification.create({
      data: {
        userId: user.id,
        email: normalizedEmail,
        otpHash,
        purpose: 'EMAIL_VERIFICATION',
        expiresAt,
        attempts: 0,
      },
    });

    await sendOtpEmail({
      email: normalizedEmail,
      otp,
      role: user.role,
      purpose: 'EMAIL_VERIFICATION',
    });

    createAuditLog({
      userId: user.id,
      username: user.username,
      action: 'EMAIL_VERIFICATION_OTP_REQUESTED',
      status: 'SUCCESS',
      metadata: { email: normalizedEmail, role: user.role },
    });

    return NextResponse.json({
      success: true,
      message: 'Verification code sent to your email.',
    });
  } catch (err) {
    console.error('request-otp error:', err);
    return NextResponse.json({ error: 'Failed to process OTP request.' }, { status: 500 });
  }
}
