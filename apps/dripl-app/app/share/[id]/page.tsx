import React from "react";
import { notFound } from "next/navigation";
import { db } from "@dripl/db";
import { CanvasBootstrap } from "@/components/canvas/CanvasBootstrap";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { CanvasControls } from "@/components/canvas/CanvasControls";
import { TopBar } from "@/components/canvas/TopBar";
import { CommandPalette } from "@/components/canvas/CommandPalette";

interface SharePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function SharePage({ params }: SharePageProps) {
  const { id } = await params;

  // Fetch the file from the database
  const file = await db.file.findUnique({
    where: { id },
  });

  if (!file) {
    notFound();
  }

  const initialData = JSON.parse(file.content);

  // Try to extract theme from saved state if available, otherwise default to "dark"
  // Assuming saved state might have theme info, but for now we default to "dark" for shared view
  // or we could let the client component handle theme.
  // Ideally, we'd pass a theme prop, but CanvasBootstrap handles theme via store/props.
  const theme = "dark"; // Default for now

  return (
    <div className={`w-screen h-dvh relative overflow-hidden bg-[#121112]`}>
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

      <TopBar />

      {/* 
        We use mode="file" to load the initial data.
        Note: This effectively loads the shared canvas as a NEW local canvas 
        if the user chooses to replace their current local canvas.
      */}
      <CanvasBootstrap
        mode="file"
        initialData={{ elements: initialData.elements || initialData }}
        theme={theme}
      />

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
        <CanvasToolbar />
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <div
        className={`absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-[#6965db] to-transparent opacity-30 pointer-events-none`}
      />
      <div
        className={`absolute bottom-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-[#6965db] to-transparent opacity-30 pointer-events-none`}
      />
      <CommandPalette />

      {/* Banner indicating this is a shared canvas */}
      <div className="absolute bottom-6 right-6 z-20 bg-blue-600 px-4 py-2 rounded-lg text-white font-medium shadow-lg">
        Viewing Shared Canvas
      </div>
    </div>
  );
}
