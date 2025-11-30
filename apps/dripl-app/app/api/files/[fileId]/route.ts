import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../../../packages/db/src";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const { userId } = await auth();

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const file = await prisma.file.findUnique({
      where: {
        id: fileId,
        userId: userId, // Ensure ownership
      },
    });

    if (!file) {
      return new NextResponse("Not Found", { status: 404 });
    }

    return NextResponse.json(file);
  } catch (error) {
    console.error("[FILE_GET]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const { userId } = await auth();

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const file = await prisma.file.delete({
      where: {
        id: fileId,
        userId: userId,
      },
    });

    return NextResponse.json(file);
  } catch (error) {
    console.error("[FILE_DELETE]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  const { userId } = await auth();

  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, content, preview } = body;

    const file = await prisma.file.update({
      where: {
        id: fileId,
        userId: userId,
      },
      data: {
        name,
        content,
        preview,
      },
    });

    return NextResponse.json(file);
  } catch (error) {
    console.error("[FILE_PATCH]", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
