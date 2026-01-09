"use client";

import RoughCanvas from "@/components/canvas/RoughCanvas";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { PropertiesPanel } from "@/components/canvas/PropertiesPanel";
import { CanvasControls } from "@/components/canvas/CanvasControls";

interface CanvasRoomPageProps {
  params: {
    roomSlug: string;
  };
}

export default function CanvasRoomPage({ params }: CanvasRoomPageProps) {
  return (
    <div className="w-screen h-screen relative bg-background overflow-hidden">
      <CanvasToolbar />
      <PropertiesPanel />
      <CanvasControls />
      <RoughCanvas roomSlug={params.roomSlug} />
    </div>
  );
}
