"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient } from "@/lib/api";
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
  validateToken: (_token: string) => Promise<boolean>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.me();
      setUser(response.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiClient.login({ email, password });
      setUser(response.user);
    },
    [],
  );

  const signup = useCallback(
    async (email: string, password: string, name?: string) => {
      const response = await apiClient.register({ email, password, name });
      setUser(response.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } finally {
      setUser(null);
      router.push("/");
    }
  }, [router]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      token: null,
      login,
      signup,
      logout,
      refreshUser,
      generateToken: async () => "",
      validateToken: async () => false,
    }),
    [loading, login, logout, refreshUser, signup, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
