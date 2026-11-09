-- Add emailVerified and name columns to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;

-- Add purpose column to OtpVerification
ALTER TABLE "OtpVerification" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'EMAIL_VERIFICATION';

-- Mark existing admin users as email-verified (they don't need email verification)
UPDATE "User" SET "emailVerified" = true WHERE "role" = 'ADMIN';

-- Mark existing users with passwordHash as email-verified (legacy users who already had passwords)
UPDATE "User" SET "emailVerified" = true WHERE "passwordHash" IS NOT NULL AND "emailVerified" = false;
