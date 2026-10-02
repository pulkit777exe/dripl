-- Add indexes declared in schema.prisma that were missing from earlier migrations.

-- AlterTable
CREATE INDEX "File_userId_updatedAt_idx" ON "File"("userId", "updatedAt");

-- AlterTable
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- AlterTable
CREATE INDEX "ShareLink_roomId_idx" ON "ShareLink"("roomId");

-- AlterTable
CREATE INDEX "ShareLink_expiresAt_idx" ON "ShareLink"("expiresAt");
