-- CreateTable
CREATE TABLE "CanvasSnapshot" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT,
    "data" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasSnapshot_pkey" PRIMARY KEY ("id"),

    -- Storage-layer bound on the scene payload, matching the 2 MiB cap the
    -- POST /api/canvas/snapshots write path already enforces (413 above the
    -- limit). Prisma cannot express CHECK constraints, so it is hand-written
    -- here and lives in the schema as a doc comment on the model. Raise both
    -- together or every oversized write turns into a 500.
    CONSTRAINT "CanvasSnapshot_data_bytes" CHECK (octet_length("data") <= 2097152)
);

-- CreateIndex
CREATE INDEX "CanvasSnapshot_canvasId_createdAt_idx" ON "CanvasSnapshot"("canvasId", "createdAt");

-- CreateIndex
CREATE INDEX "CanvasSnapshot_expiresAt_idx" ON "CanvasSnapshot"("expiresAt");
