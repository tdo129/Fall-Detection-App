// src/context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  UserProfile,
  getStoredGoogleUser,
  saveGoogleUser,
  logoutGoogleUser,
  loginWithCredentials,
} from '../services/authService';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (user: UserProfile) => Promise<UserProfile>;
  loginWithPassword: (email: string, pass: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reloadUser = useCallback(async () => {
    try {
      const stored = await getStoredGoogleUser();
      setUser(stored);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    getStoredGoogleUser()
      .then((stored) => {
        if (stored) {
          setUser(stored);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (newUser: UserProfile) => {
    const updated = await saveGoogleUser(newUser);
    setUser(updated);
    return updated;
  }, []);

  const loginWithPassword = useCallback(async (email: string, pass: string) => {
    const profile = await loginWithCredentials(email, pass);
    setUser(profile);
    return profile;
  }, []);

  const logout = useCallback(async () => {
    await logoutGoogleUser();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        loginWithPassword,
        logout,
        reloadUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
