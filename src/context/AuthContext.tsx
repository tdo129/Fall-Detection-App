import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
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

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundTimestampRef = useRef<number | null>(null);

  // 1. Mỗi khi khởi động/vào app (cold start), bắt buộc đăng nhập Gmail (không tự động đăng nhập)
  useEffect(() => {
    logoutGoogleUser().finally(() => {
      setUser(null);
      setIsLoading(false);
    });
  }, []);

  // 2. Theo dõi trạng thái ứng dụng: Nếu app chạy nền quá 3 phút, yêu cầu đăng nhập lại
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current === 'active' &&
        (nextAppState === 'inactive' || nextAppState === 'background')
      ) {
        backgroundTimestampRef.current = Date.now();
      }

      if (
        (appStateRef.current === 'inactive' || appStateRef.current === 'background') &&
        nextAppState === 'active'
      ) {
        // Nếu chuyển từ nền quay lại app sau hơn 3 phút, hủy phiên đăng nhập
        if (backgroundTimestampRef.current) {
          const diffMinutes = (Date.now() - backgroundTimestampRef.current) / (1000 * 60);
          if (diffMinutes >= 3) {
            console.log('[AuthContext] Background timeout exceeded, forcing re-login');
            logoutGoogleUser().finally(() => {
              setUser(null);
            });
          }
        }
        backgroundTimestampRef.current = null;
      }

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const reloadUser = useCallback(async () => {
    try {
      const stored = await getStoredGoogleUser();
      setUser(stored);
    } catch {
      setUser(null);
    }
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
