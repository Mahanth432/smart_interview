-- CreateTable: OtpVerification (created first before any ALTER TABLE statements)
CREATE TABLE IF NOT EXISTS "OtpVerification" (
    "id" TEXT NOT NULL,
    "userId" INTEGER,
    "email" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'EMAIL_VERIFICATION',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: OtpVerification indexes
CREATE INDEX IF NOT EXISTS "OtpVerification_email_idx" ON "OtpVerification"("email");
CREATE INDEX IF NOT EXISTS "OtpVerification_userId_idx" ON "OtpVerification"("userId");
CREATE INDEX IF NOT EXISTS "OtpVerification_expiresAt_idx" ON "OtpVerification"("expiresAt");

-- AddForeignKey: OtpVerification -> User
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'OtpVerification_userId_fkey'
    ) THEN
        ALTER TABLE "OtpVerification" ADD CONSTRAINT "OtpVerification_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable: User (add email, emailVerified, name, and allow nullable passwordHash)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex: User email unique index
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

-- AlterTable: Candidate (add userId column, unique index, and foreign key)
ALTER TABLE "Candidate" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "Candidate_userId_key" ON "Candidate"("userId");

-- AddForeignKey: Candidate -> User
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Candidate_userId_fkey'
    ) THEN
        ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable: OtpVerification (ensure purpose column exists for forward compatibility)
ALTER TABLE "OtpVerification" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'EMAIL_VERIFICATION';

-- Data backfills: Mark existing admin users as email-verified
UPDATE "User" SET "emailVerified" = true WHERE "role" = 'ADMIN';

-- Data backfills: Mark existing users with passwordHash as email-verified
UPDATE "User" SET "emailVerified" = true WHERE "passwordHash" IS NOT NULL AND "emailVerified" = false;
