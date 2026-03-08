import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@dripl/db";
import { z } from "zod";
import { setInMemoryShare } from "@/lib/share-memory-store";

const CreateShareSchema = z.object({
  fileId: z.string().min(1).optional(),
  elements: z.array(z.unknown()).optional(),
  name: z.string().optional(),
  permission: z.enum(["view", "edit"]),
  expiresIn: z.number().int().positive().max(24 * 365).optional(),
});

function isObjectWithCode(
  error: unknown,
): error is { code?: string; message?: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

function isDatabaseUnavailable(error: unknown): boolean {
  const code = isObjectWithCode(error) ? error.code : undefined;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "ECONNREFUSED" ||
    code === "P1001" ||
    message.includes("ECONNREFUSED") ||
    message.includes("Can't reach database server")
  );
}

export async function POST(request: NextRequest) {
  const payloadParse = CreateShareSchema.safeParse(await request.json());
  if (!payloadParse.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: payloadParse.error.flatten() },
      { status: 400 },
    );
  }

  const payload = payloadParse.data;
  const token = randomBytes(16).toString("hex");
  const expiresAt =
    typeof payload.expiresIn === "number"
      ? new Date(Date.now() + payload.expiresIn * 60 * 60 * 1000)
      : null;
  const serializedContent = JSON.stringify(payload.elements ?? []);
  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
  let fileId = payload.fileId;

  try {
    if (fileId) {
      const existing = await db.file.findUnique({
        where: { id: fileId },
        select: { id: true },
      });
      if (!existing) {
        fileId = undefined;
      }
    }

    if (!fileId) {
      const created = await db.file.create({
        data: {
          name: payload.name ?? "Shared board",
          content: serializedContent,
        },
        select: { id: true },
      });
      fileId = created.id;
    } else if (payload.elements || payload.name) {
      await db.file.update({
        where: { id: fileId },
        data: {
          content: payload.elements ? serializedContent : undefined,
          name: payload.name ?? undefined,
        },
      });
    }

    try {
      await db.file.update({
        where: { id: fileId },
        data: {
          shareToken: token,
          sharePermission: payload.permission,
          shareExpiresAt: expiresAt,
        },
      });
    } catch (error) {
      const errorCode = isObjectWithCode(error) ? error.code : undefined;
      const errorMessage = error instanceof Error ? error.message : "";
      const isShareSchemaError =
        errorCode === "P2021" ||
        errorCode === "P2022" ||
        errorMessage.includes("shareToken") ||
        errorMessage.includes("sharePermission") ||
        errorMessage.includes("shareExpiresAt");

      if (!isShareSchemaError) {
        throw error;
      }

      const legacyPermissionQuery =
        payload.permission === "view" ? "?permission=view" : "";
      return NextResponse.json({
        url: `${appOrigin}/share/${fileId}${legacyPermissionQuery}`,
        token: null,
        permission: payload.permission,
        expiresAt,
        legacy: true,
      });
    }

    return NextResponse.json({
      url: `${appOrigin}/board/${token}`,
      token,
      permission: payload.permission,
      expiresAt,
    });
  } catch (error) {
    if (isDatabaseUnavailable(error)) {
      const fallbackFileId = fileId ?? `mem-${token}`;
      setInMemoryShare({
        token,
        fileId: fallbackFileId,
        name: payload.name ?? "Shared board",
        elements: payload.elements ?? [],
        permission: payload.permission,
        expiresAt: expiresAt ? expiresAt.getTime() : null,
        createdAt: Date.now(),
      });

      return NextResponse.json({
        url: `${appOrigin}/board/${token}`,
        token,
        permission: payload.permission,
        expiresAt,
        offline: true,
      });
    }

    const debug =
      process.env.NODE_ENV !== "production"
        ? {
            message: error instanceof Error ? error.message : String(error),
            code: isObjectWithCode(error) ? error.code : undefined,
          }
        : undefined;
    return NextResponse.json({ error: "Unable to create share link", debug }, { status: 500 });
  }
}
