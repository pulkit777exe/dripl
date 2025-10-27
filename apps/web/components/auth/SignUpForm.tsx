"use client";

import { useState } from "react";
import { Button, Layout } from "@repo/ui";
import { useAuthStore } from "@repo/store";
import axios from "axios";

interface SignUpFormProps {
  onSuccess?: () => void;
  onSwitchToSignIn?: () => void;
}

export default function SignUpForm({ onSuccess, onSwitchToSignIn }: SignUpFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
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
    
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const trimmedConfirmPassword = confirmPassword.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPassword || !trimmedConfirmPassword) {
      setError("All fields are required");
      return;
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (trimmedPassword.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    setLoading(true);
    clearError();

    try {
      const response = await axios.post(`${BACKEND_URL}/api/auth/signup`, {
        name: trimmedName,
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
        setError("Sign up failed");
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
            Full Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your full name"
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
            placeholder="Create a password"
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
            Confirm Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Confirm your password"
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
          Create Account
        </Button>

        {onSwitchToSignIn && (
          <div style={{ textAlign: "center" }}>
            <button
              type="button"
              onClick={onSwitchToSignIn}
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
              Already have an account? Sign In
            </button>
          </div>
        )}
      </Layout>
    </form>
  );
}
