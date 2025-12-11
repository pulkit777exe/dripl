import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import prisma from "@dripl/database";

// Helper to ensure user exists in DB
async function ensureUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    const clerkUser = await currentUser();
    if (clerkUser) {
      await prisma.user.create({
        data: {
          id: userId,
          email: clerkUser.emailAddresses[0]?.emailAddress || "",
          name: `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim(),
          image: clerkUser.imageUrl,
        },
      });
    }
  }
}

export async function GET(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await ensureUser(userId);

    const files = await prisma.file.findMany({
      where: {
        userId: userId,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    return NextResponse.json(files);
  } catch (error) {
    console.error("[FILES_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function POST(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await ensureUser(userId);

    const body = await req.json();
    const { name } = body;

    const file = await prisma.file.create({
      data: {
        name: name || "Untitled File",
        userId: userId,
        content: "[]", // Empty canvas
      },
    });

    return NextResponse.json(file);
  } catch (error) {
    console.error("[FILES_POST]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
