// App.tsx
import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { DeviceProvider } from './src/context/DeviceContext';
import AppNavigator from './src/navigation/AppNavigator';
import GoogleLoginScreen from './src/screens/GoogleLoginScreen';
import AdminScreen from './src/screens/AdminScreen';
import MonitoredScreen from './src/screens/MonitoredScreen';
import { isAdminEmail } from './src/services/authService';

function RootNavigation() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  // Bắt buộc phải đăng nhập mới được vào app
  if (!user) {
    return <GoogleLoginScreen />;
  }

  // Phân quyền 1: Quản trị viên (Admin)
  if (isAdminEmail(user.email) || user.role === 'admin') {
    return <AdminScreen />;
  }

  // Phân quyền 2: Người được giám sát (Monitored Person)
  if (user.role === 'monitored_person') {
    return <MonitoredScreen />;
  }

  // Phân quyền 3: Người giám sát (Supervisor - mặc định cho các tài khoản giám sát)
  return (
    <DeviceProvider>
      <AppNavigator />
    </DeviceProvider>
  );
}

export default function App() {
  const notificationResponseListener = useRef<Notifications.EventSubscription>(null);

  useEffect(() => {
    notificationResponseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        console.log('[App] Notification tapped:', data);
      });

    return () => {
      if (notificationResponseListener.current) {
        notificationResponseListener.current.remove();
      }
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <AuthProvider>
        <RootNavigation />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingRoot: {
    flex: 1,
    backgroundColor: '#F4F8FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
});