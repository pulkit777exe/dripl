"use client";

import { useState } from "react";
import { Button, Layout } from "@repo/ui";
import { useAuthStore } from "@repo/store";
import axios from "axios";

interface SignInFormProps {
  onSuccess?: () => void;
  onSwitchToSignUp?: () => void;
}

export default function SignInForm({ onSuccess, onSwitchToSignUp }: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const {
    isLoading,
    error,
    setLoading,
    setError,
    clearError,
    login,
  } = useAuthStore();

  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3008";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setError("Email and password are required");
      return;
    }

    setLoading(true);
    clearError();

    try {
      const response = await axios.post(`${BACKEND_URL}/api/auth/signin`, {
        email: trimmedEmail,
        password: trimmedPassword,
      });
      
      const responseData = response.data.data || response.data;

      if (!responseData.user || !responseData.token) {
        throw new Error("Invalid response from server");
      }

      login(responseData.user, responseData.token);
      onSuccess?.();
    } catch (err: any) {
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else if (err.response?.data?.error) {
        setError(err.response.data.error);
      } else if (err.message) {
        setError(err.message);
      } else {
        setError("Sign in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit(e as any);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Layout variant="default" spacing="md">
        {error && (
          <div style={{
            marginBottom: "1rem",
            padding: "0.75rem",
            backgroundColor: "rgba(211, 47, 47, 0.1)",
            border: "1px solid rgba(211, 47, 47, 0.3)",
            borderRadius: "0.75rem",
          }}>
            <p style={{ fontSize: "0.875rem", color: "var(--content-error)", margin: 0 }}>
              {error}
            </p>
          </div>
        )}

        <div>
          <label style={{ 
            fontSize: "0.875rem", 
            fontWeight: "600", 
            color: "var(--content-emphasis)", 
            marginBottom: "0.5rem", 
            display: "block" 
          }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your email"
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "2px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "0.75rem",
              color: "var(--content-emphasis)",
              fontSize: "0.875rem",
              outline: "none",
              transition: "all 0.3s ease",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--matty-blue)"}
            onBlur={(e) => e.target.style.borderColor = "rgba(255, 255, 255, 0.1)"}
          />
        </div>

        <div>
          <label style={{ 
            fontSize: "0.875rem", 
            fontWeight: "600", 
            color: "var(--content-emphasis)", 
            marginBottom: "0.5rem", 
            display: "block" 
          }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your password"
            style={{
              width: "100%",
              padding: "0.75rem 1rem",
              backgroundColor: "rgba(255, 255, 255, 0.05)",
              border: "2px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "0.75rem",
              color: "var(--content-emphasis)",
              fontSize: "0.875rem",
              outline: "none",
              transition: "all 0.3s ease",
            }}
            onFocus={(e) => e.target.style.borderColor = "var(--matty-blue)"}
            onBlur={(e) => e.target.style.borderColor = "rgba(255, 255, 255, 0.1)"}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          style={{ width: "100%" }}
          isLoading={isLoading}
        >
          Sign In
        </Button>

        {onSwitchToSignUp && (
          <div style={{ textAlign: "center" }}>
            <button
              type="button"
              onClick={onSwitchToSignUp}
              style={{
                fontSize: "0.875rem",
                color: "var(--content-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                transition: "color 0.2s ease",
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = "var(--content-emphasis)"}
              onMouseLeave={(e) => e.currentTarget.style.color = "var(--content-muted)"}
            >
              Don't have an account? Sign Up
            </button>
          </div>
        )}
      </Layout>
    </form>
  );
}
