"use client";

import { useEffect, useRef, use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CanvasLayout, Button, Card } from "@repo/ui";
import { useCanvasStore, useAuthStore, useRoomStore } from "@repo/store";
import { CollaborativeEngine } from "../../../utils/engine";
import { useSocket } from "../../../hooks/useSocket";
import AuthModal from "../../../components/auth/AuthModal";
import { LogIn, Eye, Users } from "lucide-react";

type Tool = "select" | "pan" | "draw";

export default function CanvasPage({
  params,
}: {
  params: Promise<{ canvasId: string }>;
}) {
  const { canvasId } = use(params);
  const searchParams = useSearchParams();
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CollaborativeEngine | null>(null);
  const [selectedTool, setSelectedTool] = useState<Tool>("pan");
  const [zoom, setZoom] = useState(34);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);

  const { currentShape, currentColor } = useCanvasStore();
  const { user, token, isAuthenticated } = useAuthStore();
  const { collaborators, addCollaborator, removeCollaborator, setConnected } = useRoomStore();

  const wsToken = token || searchParams.get('token') || '';
  const { socket, loading: socketLoading, error: socketError } = useSocket(wsToken);

  useEffect(() => {
    const tokenParam = searchParams.get('token');
    
    if (!isAuthenticated && !tokenParam) {
      setIsReadOnly(true);
      setIsLoading(false);
    } else if (isAuthenticated || tokenParam) {
      setIsReadOnly(false);
      setIsLoading(false);
    } else {
      setShowAuthModal(true);
      setIsReadOnly(true);
      setIsLoading(false);
    }
  }, [isAuthenticated, searchParams]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading || !socket || socketLoading) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const userName = user?.name || searchParams.get('name') || "Anonymous";
    const userId = user?.id || searchParams.get('userId') || "anonymous";

    engineRef.current = new CollaborativeEngine(
      canvas,
      userId,
      canvasId,
      socket,
      currentShape,
      currentColor,
      isReadOnly
    );

    setConnected(true);

    socket.send(JSON.stringify({
      type: "join_room",
      roomId: canvasId,
      userId: userId,
      userName: userName
    }));

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case "user_joined":
            if (message.userId !== userId) {
              addCollaborator({
                id: message.userId,
                name: message.userName || "Anonymous",
                status: "online"
              });
            }
            if (message.userCount) {
              setUserCount(message.userCount);
            }
            break;
            
          case "user_left":
            removeCollaborator(message.userId);
            if (message.userCount) {
              setUserCount(message.userCount);
            }
            break;
            
          case "room_state":
            if (message.users) {
              message.users.forEach((u: any) => {
                if (u.id !== userId) {
                  addCollaborator({
                    id: u.id,
                    name: u.name,
                    status: "online"
                  });
                }
              });
            }
            setUserCount(message.users?.length || 1);
            break;
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    socket.addEventListener('message', handleMessage);

    const handleResize = () => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        engineRef.current?.scheduleRedraw();
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      // Leave the room
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "leave_room",
          roomId: canvasId,
          userId: userId
        }));
      }
      
      socket.removeEventListener('message', handleMessage);
      window.removeEventListener("resize", handleResize);
      engineRef.current?.destroy();
      setConnected(false);
    };
  }, [
    canvasId,
    socket,
    socketLoading,
    currentColor,
    currentShape,
    user,
    addCollaborator,
    removeCollaborator,
    setConnected,
    isLoading,
    isReadOnly,
    searchParams,
  ]);

  useEffect(() => {
    engineRef.current?.setShape(currentShape);
  }, [currentShape]);

  useEffect(() => {
    engineRef.current?.setColor(currentColor);
  }, [currentColor]);

  useEffect(() => {
    engineRef.current?.setTool(selectedTool);
  }, [selectedTool]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (isReadOnly) return;
      
      if (e.key === "Delete" || e.key === "Backspace") {
        engineRef.current?.deleteSelected();
      } else if (e.key === "d" || e.key === "D") {
        setSelectedTool("draw");
      } else if (e.key === "s" || e.key === "S") {
        setSelectedTool("select");
      } else if (e.key === " ") {
        e.preventDefault();
        setSelectedTool("pan");
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isReadOnly) return;
      
      if (e.key === " ") {
        setSelectedTool("draw");
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyPress);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isReadOnly]);

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 10, 10));
  };

  const handleSignIn = () => {
    setShowAuthModal(true);
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    setIsReadOnly(false);
  };

  if (isLoading || socketLoading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "var(--bg-default)",
      }}>
        <div style={{
          padding: "2rem",
          background: "rgba(255, 255, 255, 0.05)",
          borderRadius: "1rem",
          textAlign: "center",
        }}>
          <div style={{
            width: "2rem",
            height: "2rem",
            border: "2px solid var(--matty-blue)",
            borderTop: "2px solid transparent",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 1rem",
          }} />
          <p style={{ color: "var(--content-emphasis)", margin: 0 }}>
            {socketLoading ? "Connecting to canvas..." : "Loading canvas..."}
          </p>
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (socketError) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "var(--bg-default)",
      }}>
        <div style={{
          padding: "2rem",
          background: "rgba(255, 255, 255, 0.05)",
          borderRadius: "1rem",
          textAlign: "center",
        }}>
          <p style={{ color: "var(--content-emphasis)", marginBottom: "1rem" }}>
            {socketError}
          </p>
          <Button onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <CanvasLayout
        selectedTool={selectedTool}
        onToolSelect={(tool: string) => setSelectedTool(tool as Tool)}
        onMenuClick={() => console.log("Menu clicked")}
        onShareClick={() => console.log("Share clicked")}
        onLibraryClick={() => console.log("Library clicked")}
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onUndo={() => console.log("Undo")}
        onRedo={() => console.log("Redo")}
        onScrollToContent={() => console.log("Scroll to content")}
      >
        {/* User count indicator */}
        <div style={{
          position: "absolute",
          top: "1rem",
          left: "1rem",
          zIndex: 1000,
        }}>
          <Card variant="glass" style={{
            padding: "0.5rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}>
            <Users style={{ width: "1rem", height: "1rem", color: "var(--content-muted)" }} />
            <span style={{ fontSize: "0.875rem", color: "var(--content-emphasis)", fontWeight: 500 }}>
              {userCount} {userCount === 1 ? "user" : "users"}
            </span>
          </Card>
        </div>

        {/* Read-only mode indicator */}
        {isReadOnly && (
          <div style={{
            position: "absolute",
            top: "1rem",
            right: "1rem",
            zIndex: 1000,
          }}>
            <Card variant="glass" style={{
              padding: "0.75rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
            }}>
              <Eye style={{ width: "1rem", height: "1rem", color: "var(--content-muted)" }} />
              <span style={{ fontSize: "0.875rem", color: "var(--content-emphasis)" }}>
                Read-only mode
              </span>
              <Button
                onClick={handleSignIn}
                variant="primary"
                size="sm"
                style={{ padding: "0.25rem 0.75rem" }}
              >
                <LogIn style={{ width: "0.875rem", height: "0.875rem", marginRight: "0.25rem" }} />
                Sign In
              </Button>
            </Card>
          </div>
        )}
        
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            cursor: isReadOnly 
              ? "default" 
              : selectedTool === "pan"
                ? "grab"
                : selectedTool === "select"
                  ? "pointer"
                  : "crosshair",
            opacity: isReadOnly ? 0.8 : 1,
          }}
        />
      </CanvasLayout>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleAuthSuccess}
        defaultMode="signin"
      />
    </>
  );
}