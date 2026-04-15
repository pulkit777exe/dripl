-- AlterTable
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "CanvasRoom_ownerId_idx" ON "CanvasRoom"("ownerId");

-- CreateIndex
CREATE INDEX "CanvasRoom_isPublic_idx" ON "CanvasRoom"("isPublic");

-- CreateIndex
CREATE INDEX "CanvasRoom_updatedAt_idx" ON "CanvasRoom"("updatedAt");

-- CreateIndex
CREATE INDEX "CanvasRoomMember_userId_idx" ON "CanvasRoomMember"("userId");

-- CreateIndex
CREATE INDEX "File_folderId_idx" ON "File"("folderId");

-- CreateIndex
CREATE INDEX "File_teamId_idx" ON "File"("teamId");

-- CreateIndex
CREATE INDEX "File_userId_idx" ON "File"("userId");

-- CreateIndex
CREATE INDEX "File_updatedAt_idx" ON "File"("updatedAt");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "Folder_teamId_idx" ON "Folder"("teamId");

-- CreateIndex
CREATE INDEX "Folder_userId_idx" ON "Folder"("userId");
