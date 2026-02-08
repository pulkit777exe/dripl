"use client";

import React from "react";
import RoughCanvas from "@/components/canvas/RoughCanvas";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { CanvasControls } from "@/components/canvas/CanvasControls";
import { useTheme } from "@/hooks/useTheme";
import { TopBar } from "@/components/canvas/TopBar";
import { CanvasBootstrap } from "@/components/canvas/CanvasBootstrap";
import { CommandPalette } from "@/components/canvas/CommandPalette";

interface CanvasRoomPageProps {
  params: Promise<{
    roomSlug: string;
  }>;
}

export default function CanvasRoomPage({ params }: CanvasRoomPageProps) {
  const { roomSlug } = React.use(params);
  const { effectiveTheme } = useTheme();

  return (
    <div
      className={`w-screen h-dvh relative overflow-hidden ${
        effectiveTheme === "dark" ? "bg-[#121112]" : "bg-[#f7f5f6]"
      }`}
    >
      <div
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
        }}
      />

      <TopBar />
      <CanvasBootstrap mode="room" roomSlug={roomSlug} theme={effectiveTheme} />

      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
        <CanvasToolbar />
      </div>

      <div className="absolute bottom-6 left-6 z-20">
        <CanvasControls />
      </div>

      <div
        className={`absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-[${
          effectiveTheme === "dark" ? "#6965db" : "#4f46e5"
        }] to-transparent opacity-30 pointer-events-none`}
      />
      <div
        className={`absolute bottom-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-[${
          effectiveTheme === "dark" ? "#6965db" : "#4f46e5"
        }] to-transparent opacity-30 pointer-events-none`}
      />
      <CommandPalette />
    </div>
  );
}
