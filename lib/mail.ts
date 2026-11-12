import nodemailer from 'nodemailer';

interface SendOtpEmailParams {
  email: string;
  otp: string;
  role?: string;
  purpose?: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
}

/**
 * Send an OTP verification email to the user.
 * Reuses standard SMTP credentials if provided in environment variables.
 * In development, if SMTP is not configured, logs to console safely.
 */
export async function sendOtpEmail({ email, otp, role, purpose = 'EMAIL_VERIFICATION' }: SendOtpEmailParams): Promise<boolean> {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER || process.env.SMTP_EMAIL;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || '"SmartInterview AI" <no-reply@smartinterview.ai>';

  const isConfigured = Boolean(user && pass);
  const isReset = purpose === 'PASSWORD_RESET';
  const roleLabel = isReset
    ? 'Password Reset'
    : role === 'CANDIDATE'
    ? 'Candidate Portal'
    : role === 'ADMIN'
    ? 'Administrator Portal'
    : 'Lead Interviewer Portal';

  if (!isConfigured) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n=============================================================`);
      console.log(`[SmartInterview Email] Local Development Mode (No SMTP configured)`);
      console.log(`To: ${email} | Purpose: ${purpose} | Role: ${role || 'N/A'}`);
      console.log(`Your 6-Digit OTP: >>> ${otp} <<< (Expires in 5 minutes)`);
      console.log(`(Add SMTP_USER and SMTP_PASS to .env to send live emails)`);
      console.log(`=============================================================\n`);
    } else {
      console.error(`[SmartInterview Email] SMTP credentials not configured in production environment.`);
      return false;
    }
    return true;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    const actionText = isReset ? 'password reset' : 'verification';
    const descriptionText = isReset
      ? 'Use the single-use verification code below to reset your password:'
      : 'Use the single-use verification code below to sign in to your workspace:';

    const mailOptions = {
      from,
      to: email,
      subject: `${otp} is your SmartInterview ${actionText} code`,
      text: `Your ${actionText} code for SmartInterview (${roleLabel}) is: ${otp}\n\nThis code will expire in 5 minutes. Do not share this code with anyone.`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; background-color: #0f172a; color: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
          <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">SmartInterview AI</h1>
            <p style="margin: 6px 0 0 0; color: rgba(255,255,255,0.85); font-size: 14px;">${roleLabel}</p>
          </div>
          <div style="padding: 32px 24px; text-align: center;">
            <p style="margin: 0 0 16px 0; color: #cbd5e1; font-size: 15px; line-height: 1.5;">
              ${descriptionText}
            </p>
            <div style="background: rgba(99, 102, 241, 0.12); border: 2px dashed #6366f1; border-radius: 12px; padding: 18px 24px; display: inline-block; margin: 16px 0 24px 0;">
              <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #818cf8; font-family: monospace;">${otp}</span>
            </div>
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #94a3b8;">
              ⏱️ This code will expire in <strong>5 minutes</strong>.
            </p>
            <p style="margin: 0; font-size: 12px; color: #64748b;">
              If you did not request this verification code, you can safely ignore this email.
            </p>
          </div>
          <div style="background: #090d16; padding: 16px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); font-size: 12px; color: #475569;">
            Adaptive AI-Powered Interview Assessment Platform
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[SmartInterview Email] Failed to send OTP email:', error);
    // In local dev, still allow login if SMTP failed
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SmartInterview Email Fallback] OTP for ${email}: ${otp}`);
      return true;
    }
    return false;
  }
}
