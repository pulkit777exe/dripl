import { NextResponse } from "next/server";
import { db } from "@dripl/db";
import { getInMemoryShare } from "@/lib/share-memory-store";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;

  const fallback = getInMemoryShare(token);

  let file:
    | {
        id: string;
        name: string;
        content: string;
        sharePermission: string | null;
        shareExpiresAt: Date | null;
        updatedAt: Date;
      }
    | null = null;
  try {
    file = await db.file.findFirst({
      where: { shareToken: token },
      select: {
        id: true,
        name: true,
        content: true,
        sharePermission: true,
        shareExpiresAt: true,
        updatedAt: true,
      },
    });
  } catch {
    file = null;
  }

  if (!file && fallback) {
    return NextResponse.json({
      file: {
        id: fallback.fileId,
        name: fallback.name,
        content: fallback.elements,
        updatedAt: new Date(fallback.createdAt),
      },
      permission: fallback.permission,
    });
  }

  if (!file) {
    return NextResponse.json({ error: "Share token not found" }, { status: 404 });
  }

  if (file.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Share token expired" }, { status: 404 });
  }

  let content: unknown = [];
  try {
    content = JSON.parse(file.content);
  } catch {
    content = [];
  }

  return NextResponse.json({
    file: {
      id: file.id,
      name: file.name,
      content,
      updatedAt: file.updatedAt,
    },
    permission: file.sharePermission ?? "view",
  });
}
