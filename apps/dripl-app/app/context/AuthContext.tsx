'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiClient } from '@/lib/api';
import { useRouter } from 'next/navigation';

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
  signup: (email: string, password: string, name?: string) => Promise<{ pendingVerification?: boolean }>;
  logout: () => Promise<void>;
  googleLogin: (token: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
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

  const login = useCallback(async (email: string, password: string) => {
    const response = await apiClient.login({ email, password });
    setUser(response.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, name?: string) => {
    const response = await apiClient.register({ email, password, name });
    if (response.user) {
      setUser(response.user);
    }
    return { pendingVerification: response.pendingVerification };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.logout();
    } finally {
      setUser(null);
      router.push('/');
    }
  }, [router]);

  const googleLogin = useCallback(async (token: string) => {
    const response = await apiClient.googleLogin({ token });
    setUser(response.user);
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    await apiClient.forgotPassword({ email });
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    await apiClient.resetPassword({ token, password });
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    await apiClient.verifyEmail({ token });
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await apiClient.resendVerification({ email });
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      token: null,
      login,
      signup,
      logout,
      googleLogin,
      forgotPassword,
      resetPassword,
      verifyEmail,
      resendVerification,
      refreshUser,
      generateToken: async () => '',
      validateToken: async () => false,
    }),
    [loading, login, logout, googleLogin, forgotPassword, resetPassword, verifyEmail, resendVerification, refreshUser, signup, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
