import Canvas from "@/components/canvas/Canvas";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/canvas/TopBar";

export default function CanvasPage() {
  return (
    <main className="w-screen h-screen relative bg-background overflow-hidden">
      <TopBar />
      <Sidebar />
      <div className="absolute inset-0 top-14 left-14">
        <Canvas />
      </div>
    </main>
  );
}
