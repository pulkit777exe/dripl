-- AlterTable
ALTER TABLE "File"
ADD COLUMN     "shareToken" TEXT,
ADD COLUMN     "sharePermission" TEXT DEFAULT 'view',
ADD COLUMN     "shareExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "File_shareToken_key" ON "File"("shareToken");
