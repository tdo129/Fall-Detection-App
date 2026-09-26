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
  activateAccountWithCode,
  updateMonitoredDevice,
} from '../services/authService';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (user: UserProfile) => Promise<UserProfile>;
  loginWithPassword: (email: string, pass: string) => Promise<UserProfile>;
  activateAccount: (
    email: string,
    code: string,
    profile?: Partial<UserProfile>
  ) => Promise<UserProfile>;
  updateUserDevice: (newEspId: string | null) => Promise<UserProfile>;
  logout: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);


  const appStateRef = useRef<AppStateStatus>(AppState.currentState);


  // 1. Khi khởi động app, tự động khôi phục phiên đăng nhập đã lưu (nếu có)
  useEffect(() => {
    getStoredGoogleUser()
      .then((stored) => {
        setUser(stored);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // 2. Theo dõi AppState chỉ để logging (không tự động logout khi vào background)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      console.log('[AuthContext] AppState changed:', appStateRef.current, '->', nextAppState);
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

  const activateAccount = useCallback(
    async (email: string, code: string, profile?: Partial<UserProfile>) => {
      const updated = await activateAccountWithCode(email, code, profile);
      setUser(updated);
      return updated;
    },
    []
  );

  const updateUserDevice = useCallback(
    async (newEspId: string | null) => {
      if (!user?.email) throw new Error('Chưa đăng nhập');
      const updated = await updateMonitoredDevice(user.email, newEspId);
      setUser(updated);
      return updated;
    },
    [user?.email]
  );

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
        activateAccount,
        updateUserDevice,
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
