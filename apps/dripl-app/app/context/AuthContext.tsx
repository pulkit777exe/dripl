"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { apiClient } from "../../lib/api/client";
import { useRouter } from "next/navigation";

type User = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  generateToken: () => Promise<string>;
  validateToken: (token: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Check for existing token in localStorage
      const storedToken = localStorage.getItem("dripl_token");
      
      if (storedToken) {
        // Validate token
        const isValid = await validateToken(storedToken);
        
        if (isValid) {
          setToken(storedToken);
          
          // Try to get user profile
          try {
            const response = await apiClient.getProfile();
            setUser(response.user);
          } catch (error) {
            // Token is valid but user profile not available (anonymous user)
            setUser(null);
          }
        } else {
          // Token invalid, remove it
          localStorage.removeItem("dripl_token");
          setToken(null);
          setUser(null);
        }
      } else {
        // No token found
        setUser(null);
        setToken(null);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const response = await apiClient.login({ email, password });
    setUser(response.user);
    
    // Store token if received
    if (response.token) {
      localStorage.setItem("dripl_token", response.token);
      setToken(response.token);
    }
  };

  const signup = async (email: string, password: string, name?: string) => {
    const response = await apiClient.signup({ email, password, name });
    setUser(response.user);
    
    // Store token if received
    if (response.token) {
      localStorage.setItem("dripl_token", response.token);
      setToken(response.token);
    }
  };

  const logout = async () => {
    try {
      await apiClient.logout();
    } catch (error) {
      console.error("Logout failed:", error);
    }
    
    localStorage.removeItem("dripl_token");
    localStorage.removeItem("dripl_last_canvas");
    setUser(null);
    setToken(null);
    router.push("/");
  };

  const refreshUser = async () => {
    await checkAuth();
  };

  const generateToken = async (): Promise<string> => {
    // Generate a unique token for anonymous users
    const newToken = crypto.randomUUID();
    localStorage.setItem("dripl_token", newToken);
    setToken(newToken);
    
    return newToken;
  };

  const validateToken = async (token: string): Promise<boolean> => {
    try {
      // In a real implementation, this would validate against the server
      // For now, we'll just check if the token is in a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      
      // Also check token age (valid for 24 hours)
      const tokenAge = localStorage.getItem("dripl_token_age");
      if (tokenAge) {
        const ageHours = (Date.now() - parseInt(tokenAge)) / (1000 * 60 * 60);
        if (ageHours > 24) {
          return false;
        }
      }
      
      return uuidRegex.test(token);
    } catch (error) {
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      token,
      login, 
      signup, 
      logout, 
      refreshUser,
      generateToken,
      validateToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}