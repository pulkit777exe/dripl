"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  Section,
  SectionContainer,
  Layout,
  Background,
} from "@repo/ui";
import { useAuthStore } from "@repo/store";
import NavBar from "../layout/NavBar";
import {
  Plus, 
  LogIn, 
  Users, 
  Clock, 
  Sparkles
} from "lucide-react";

interface UserRoom {
  id: string;
  name: string;
  participants: number;
  lastAccessed: string;
  isActive: boolean;
}

const MOCK_USER_ROOMS: UserRoom[] = [
  { id: "swift-tiger-123", name: "Design Sprint", participants: 5, lastAccessed: "2 hours ago", isActive: true },
  { id: "cosmic-eagle-456", name: "Team Brainstorm", participants: 3, lastAccessed: "1 day ago", isActive: false },
  { id: "bright-river-789", name: "Client Review", participants: 2, lastAccessed: "3 days ago", isActive: false },
];

function generateRoomId(): string {
  const adjectives = [
    "swift", "cosmic", "bright", "quiet", "bold", "cool", "warm", "vivid",
  ];
  const nouns = [
    "tiger", "eagle", "river", "mountain", "ocean", "forest", "storm", "star",
  ];
  const randomNum = Math.floor(Math.random() * 1000);
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${randomNum}`;
}

interface AuthenticatedLandingProps {
  onShowAuthModal: () => void;
}

export default function AuthenticatedLanding({ onShowAuthModal }: AuthenticatedLandingProps) {
  const [customRoomId, setCustomRoomId] = useState("");
  const [userRooms] = useState(MOCK_USER_ROOMS);
  const router = useRouter();
  const { user, setError, clearError } = useAuthStore();

  const handleCreateRoom = () => {
    const canvasId = generateRoomId();
    router.push(
      `/canvas/${canvasId}?token=${user?.id}&name=${encodeURIComponent(user?.name || "User")}`
    );
  };

  const handleJoinRoom = () => {
    const canvasId = customRoomId.trim().toLowerCase();
    if (!canvasId) {
      setError("Please enter a canvas ID");
      return;
    }

    if (!/^[a-z0-9-]+$/.test(canvasId)) {
      setError("Canvas ID can only contain lowercase letters, numbers, and hyphens");
      return;
    }

    router.push(
      `/canvas/${canvasId}?token=${user?.id}&name=${encodeURIComponent(user?.name || "User")}`
    );
  };

  const handleQuickJoin = (canvasId: string) => {
    router.push(
      `/canvas/${canvasId}?token=${user?.id}&name=${encodeURIComponent(user?.name || "User")}`
    );
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--bg-default)" }}>
      <Background variant="animated">
        <NavBar />

        <Section background="default" padding="xl">
          <SectionContainer>
            {/* Header */}
            <div style={{ marginBottom: "3rem" }}>
              <h1 style={{
                fontSize: "2rem",
                fontWeight: "800",
                color: "var(--content-emphasis)",
                marginBottom: "0.5rem",
              }}>
                Welcome back, {user?.name || "User"}
              </h1>
              <p style={{ fontSize: "1rem", color: "var(--content-muted)" }}>
                Jump into a room or create a new one to start collaborating
              </p>
            </div>

            {/* Actions */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: "1.5rem",
              marginBottom: "4rem",
            }}>
              <div
                onClick={handleCreateRoom}
                style={{
                  padding: "2rem",
                  background: "linear-gradient(135deg, rgba(107, 122, 137, 0.2) 0%, rgba(107, 122, 137, 0.05) 100%)",
                  backdropFilter: "blur(20px)",
                  border: "2px solid rgba(107, 122, 137, 0.3)",
                  borderRadius: "1.5rem",
                  cursor: "pointer",
                  transition: "all 0.3s ease",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-4px)";
                  e.currentTarget.style.borderColor = "rgba(107, 122, 137, 0.5)";
                  e.currentTarget.style.boxShadow = "0 20px 40px rgba(107, 122, 137, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.borderColor = "rgba(107, 122, 137, 0.3)";
                  e.currentTarget.style.boxShadow = "";
                }}
              >
                <div style={{
                  width: "3.5rem",
                  height: "3.5rem",
                  background: "linear-gradient(135deg, var(--matty-blue) 0%, var(--matty-skin) 100%)",
                  borderRadius: "1rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "1.5rem",
                  boxShadow: "0 10px 25px rgba(107, 122, 137, 0.3)",
                }}>
                  <Plus style={{ width: "1.75rem", height: "1.75rem", color: "var(--content-inverted)" }} />
                </div>
                <h3 style={{ fontSize: "1.375rem", fontWeight: "700", color: "var(--content-emphasis)", marginBottom: "0.5rem" }}>
                  Create New Room
                </h3>
                <p style={{ fontSize: "0.9375rem", color: "var(--content-muted)", margin: 0, lineHeight: "1.5" }}>
                  Start fresh with a random room ID
                </p>
              </div>

              <Card variant="glass" style={{ border: "2px solid rgba(255, 255, 255, 0.1)" }}>
                <CardContent style={{ padding: "2rem" }}>
                  <div style={{
                    width: "3.5rem",
                    height: "3.5rem",
                    background: "linear-gradient(135deg, var(--matty-brown) 0%, var(--matty-blue) 100%)",
                    borderRadius: "1rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "1.5rem",
                    boxShadow: "0 10px 25px rgba(205, 188, 168, 0.2)",
                  }}>
                    <LogIn style={{ width: "1.75rem", height: "1.75rem", color: "var(--content-inverted)" }} />
                  </div>
                  <h3 style={{ fontSize: "1.375rem", fontWeight: "700", color: "var(--content-emphasis)", marginBottom: "0.5rem" }}>
                    Join Existing Room
                  </h3>
                  <p style={{ fontSize: "0.9375rem", color: "var(--content-muted)", marginBottom: "1.5rem" }}>
                    Enter a room ID to collaborate
                  </p>
                  
                  <Layout variant="default" spacing="sm">
                    <input
                      type="text"
                      value={customRoomId}
                      onChange={(e) => {
                        setCustomRoomId(e.target.value);
                        clearError();
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                      placeholder="e.g., swift-tiger-123"
                      style={{
                        width: "100%",
                        padding: "0.875rem 1rem",
                        backgroundColor: "rgba(255, 255, 255, 0.05)",
                        border: "2px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "0.75rem",
                        color: "var(--content-emphasis)",
                        fontSize: "0.9375rem",
                        outline: "none",
                        transition: "all 0.3s ease",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = "var(--matty-blue)";
                        e.target.style.backgroundColor = "rgba(255, 255, 255, 0.08)";
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = "rgba(255, 255, 255, 0.1)";
                        e.target.style.backgroundColor = "rgba(255, 255, 255, 0.05)";
                      }}
                    />
                    <Button
                      onClick={handleJoinRoom}
                      variant="primary"
                      size="md"
                      style={{ width: "100%" }}
                    >
                      Join Room
                    </Button>
                  </Layout>
                </CardContent>
              </Card>
            </div>

            {/* Rooms Section */}
            {userRooms.length > 0 && (
              <div style={{ marginBottom: "4rem" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "1.5rem",
                }}>
                  <h2 style={{
                    fontSize: "1.5rem",
                    fontWeight: "700",
                    color: "var(--content-emphasis)",
                    margin: 0,
                  }}>
                    My Rooms
                  </h2>
                  <div style={{
                    padding: "0.5rem 1rem",
                    background: "rgba(107, 122, 137, 0.2)",
                    borderRadius: "0.75rem",
                    fontSize: "0.875rem",
                    fontWeight: "600",
                    color: "var(--content-muted)",
                  }}>
                    {userRooms.length} {userRooms.length === 1 ? "room" : "rooms"}
                  </div>
                </div>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: "1.5rem",
                }}>
                  {userRooms.map((room) => (
                    <div
                      key={room.id}
                      onClick={() => handleQuickJoin(room.id)}
                      style={{
                        padding: "1.75rem",
                        background: "rgba(255, 255, 255, 0.03)",
                        backdropFilter: "blur(20px)",
                        border: "2px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "1.25rem",
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = "translateY(-4px)";
                        e.currentTarget.style.borderColor = "rgba(107, 122, 137, 0.4)";
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                        e.currentTarget.style.boxShadow = "0 20px 40px rgba(0, 0, 0, 0.2)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = "";
                        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                        e.currentTarget.style.boxShadow = "";
                      }}
                    >
                      {room.isActive && (
                        <div style={{
                          position: "absolute",
                          top: "1.75rem",
                          right: "1.75rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}>
                          <span style={{
                            fontSize: "0.75rem",
                            fontWeight: "600",
                            color: "#4ade80",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}>
                            Active
                          </span>
                          <div style={{
                            width: "0.5rem",
                            height: "0.5rem",
                            background: "#4ade80",
                            borderRadius: "50%",
                            boxShadow: "0 0 12px #4ade80",
                          }}>
                            <style>{`
                              @keyframes pulse-dot {
                                0%, 100% { opacity: 1; transform: scale(1); }
                                50% { opacity: 0.6; transform: scale(1.2); }
                              }
                            `}</style>
                            <div style={{
                              width: "100%",
                              height: "100%",
                              borderRadius: "50%",
                              background: "#4ade80",
                              animation: "pulse-dot 2s infinite",
                            }} />
                          </div>
                        </div>
                      )}

                      <h3 style={{ 
                        fontSize: "1.25rem", 
                        fontWeight: "700", 
                        color: "var(--content-emphasis)", 
                        marginBottom: "0.75rem",
                        paddingRight: room.isActive ? "5rem" : "0",
                      }}>
                        {room.name}
                      </h3>
                      <p style={{ 
                        fontSize: "0.875rem", 
                        color: "var(--content-muted)", 
                        marginBottom: "1.5rem", 
                        fontFamily: "monospace",
                        background: "rgba(255, 255, 255, 0.05)",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.5rem",
                        display: "inline-block",
                      }}>
                        {room.id}
                      </p>

                      <div style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        gap: "1.5rem",
                        paddingTop: "1rem",
                        borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{
                            width: "2rem",
                            height: "2rem",
                            background: "rgba(107, 122, 137, 0.2)",
                            borderRadius: "0.5rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}>
                            <Users style={{ width: "1rem", height: "1rem", color: "var(--matty-blue)" }} />
                          </div>
                          <div>
                            <div style={{ fontSize: "0.75rem", color: "var(--content-muted)", fontWeight: "500" }}>
                              Participants
                            </div>
                            <div style={{ fontSize: "0.875rem", color: "var(--content-emphasis)", fontWeight: "600" }}>
                              {room.participants}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <div style={{
                            width: "2rem",
                            height: "2rem",
                            background: "rgba(205, 188, 168, 0.2)",
                            borderRadius: "0.5rem",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}>
                            <Clock style={{ width: "1rem", height: "1rem", color: "var(--matty-brown)" }} />
                          </div>
                          <div>
                            <div style={{ fontSize: "0.75rem", color: "var(--content-muted)", fontWeight: "500" }}>
                              Last Active
                            </div>
                            <div style={{ fontSize: "0.875rem", color: "var(--content-emphasis)", fontWeight: "600" }}>
                              {room.lastAccessed}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Popular Rooms */}
            <div style={{
              padding: "2rem",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "1.5rem",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "1.5rem",
              }}>
                <div style={{
                  width: "2.5rem",
                  height: "2.5rem",
                  background: "linear-gradient(135deg, var(--matty-blue) 0%, var(--matty-brown) 100%)",
                  borderRadius: "0.75rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Sparkles style={{ width: "1.25rem", height: "1.25rem", color: "var(--content-inverted)" }} />
                </div>
                <h2 style={{
                  fontSize: "1.5rem",
                  fontWeight: "700",
                  color: "var(--content-emphasis)",
                  margin: 0,
                }}>
                  Popular Rooms
                </h2>
              </div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                {["general", "design", "brainstorm", "random"].map((room) => (
                  <button
                    key={room}
                    onClick={() => handleQuickJoin(room)}
                    style={{
                      padding: "0.875rem 1.5rem",
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "2px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "0.75rem",
                      color: "var(--content-emphasis)",
                      fontSize: "0.9375rem",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.3s ease",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(107, 122, 137, 0.2)";
                      e.currentTarget.style.borderColor = "var(--matty-blue)";
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow = "0 10px 20px rgba(107, 122, 137, 0.2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
                      e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
                      e.currentTarget.style.transform = "";
                      e.currentTarget.style.boxShadow = "";
                    }}
                  >
                    <span style={{
                      width: "0.375rem",
                      height: "0.375rem",
                      background: "var(--matty-blue)",
                      borderRadius: "50%",
                    }} />
                    {room}
                  </button>
                ))}
              </div>
            </div>
          </SectionContainer>
        </Section>
      </Background>
    </div>
  );
}
