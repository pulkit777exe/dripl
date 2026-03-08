import { notFound } from "next/navigation";
import { db } from "@dripl/db";
import { CanvasBootstrap } from "@/components/canvas/CanvasBootstrap";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { CanvasControls } from "@/components/canvas/CanvasControls";
import { TopBar } from "@/components/canvas/TopBar";
import { CommandPalette } from "@/components/canvas/CommandPalette";
import { getInMemoryShare } from "@/lib/share-memory-store";

interface BoardPageProps {
  params: Promise<{ token: string }>;
}

export default async function BoardTokenPage({ params }: BoardPageProps) {
  const { token } = await params;
  const fallback = getInMemoryShare(token);
  let file:
    | {
        id: string;
        content: string;
        sharePermission: string | null;
        shareExpiresAt: Date | null;
      }
    | null = null;

  try {
    file = await db.file.findFirst({
      where: { shareToken: token },
      select: {
        id: true,
        content: true,
        sharePermission: true,
        shareExpiresAt: true,
      },
    });
  } catch {
    file = null;
  }

  if (!file && !fallback) {
    notFound();
  }

  if (file?.shareExpiresAt && file.shareExpiresAt.getTime() < Date.now()) {
    notFound();
  }

  const permission = file
    ? (file.sharePermission ?? "view")
    : (fallback?.permission ?? "view");
  const readOnly = permission === "view";
  let initialData: unknown = [];
  try {
    initialData = file ? JSON.parse(file.content) : (fallback?.elements ?? []);
  } catch {
    initialData = [];
  }

  return (
    <div className="w-screen h-dvh relative overflow-hidden bg-[#121112]">
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

      <TopBar />
      <CanvasBootstrap
        mode="file"
        initialData={{
          elements:
            typeof initialData === "object" &&
            initialData !== null &&
            "elements" in initialData &&
            Array.isArray((initialData as { elements?: unknown }).elements)
              ? (initialData as { elements: unknown[] }).elements
              : initialData,
        }}
        theme="dark"
        readOnly={readOnly}
      />

      {!readOnly && (
        <div className="absolute top-0.5 left-1/2 -translate-x-1/2 z-20">
          <CanvasToolbar />
        </div>
      )}

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <CommandPalette />

      {readOnly && (
        <div className="absolute top-16 right-4 z-40 px-3 py-1 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-lg">
          View only
        </div>
      )}
    </div>
  );
}
