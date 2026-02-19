"use client";

import { useCanvasStore } from "@/lib/canvas-store";

export function CollaboratorsList() {
  const remoteUsers = useCanvasStore((state) => state.remoteUsers);
  const isConnected = useCanvasStore((state) => state.isConnected);

  if (!isConnected && remoteUsers.size === 0) return null;

  return (
    <div className="fixed top-4 right-4 flex items-center gap-2 pointer-events-auto">
      <div className="flex -space-x-2 overflow-hidden bg-background/50 backdrop-blur-sm p-1 rounded-full border shadow-sm">
        {Array.from(remoteUsers.values()).map((user) => (
          <div
            key={user.userId}
            className="relative w-8 h-8 rounded-full ring-2 ring-white bg-slate-200 flex items-center justify-center text-xs font-medium text-slate-700 select-none"
            style={{
              backgroundColor: user.color + "40",
              borderColor: user.color,
            }}
            title={user.userName}
          >
            <span style={{ color: user.color }}>
              {user.userName.charAt(0).toUpperCase()}
            </span>
          </div>
        ))}
        {/* You */}
        {/* We don't have 'self' user in remoteUsers. We could add 'Me'. */}
      </div>

      <div
        className={`px-2 py-1 rounded-full text-xs font-medium border ${isConnected ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}
      >
        {isConnected ? "Online" : "Offline"}
      </div>
    </div>
  );
}
