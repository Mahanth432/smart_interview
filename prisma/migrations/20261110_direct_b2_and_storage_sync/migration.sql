-- CreateEnum
CREATE TYPE "DocumentStorageStatus" AS ENUM ('AVAILABLE', 'MISSING');

-- CreateEnum
CREATE TYPE "UploadIntentStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "contentEtag" TEXT,
ADD COLUMN     "lastStorageCheckAt" TIMESTAMP(3),
ADD COLUMN     "missingAt" TIMESTAMP(3),
ADD COLUMN     "storageStatus" "DocumentStorageStatus" NOT NULL DEFAULT 'AVAILABLE';

-- CreateTable
CREATE TABLE "UploadIntent" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "docSource" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "subject" TEXT,
    "status" "UploadIntentStatus" NOT NULL DEFAULT 'PENDING',
    "documentId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadIntent_storagePath_key" ON "UploadIntent"("storagePath");

-- CreateIndex
CREATE INDEX "UploadIntent_userId_status_idx" ON "UploadIntent"("userId", "status");

-- CreateIndex
CREATE INDEX "UploadIntent_expiresAt_idx" ON "UploadIntent"("expiresAt");

-- CreateIndex
CREATE INDEX "Document_storageStatus_idx" ON "Document"("storageStatus");

-- CreateIndex
CREATE INDEX "Document_storagePath_idx" ON "Document"("storagePath");

-- AddForeignKey
ALTER TABLE "UploadIntent" ADD CONSTRAINT "UploadIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
