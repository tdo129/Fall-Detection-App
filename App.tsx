// App.tsx
import React from 'react';
import { StatusBar, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceProvider } from './src/context/DeviceContext';
import AppNavigator from './src/navigation/AppNavigator';

LogBox.ignoreLogs([
  '@firebase/firestore',
  'WebChannelConnection RPC',
  'Cannot connect to Expo CLI',
]);

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <DeviceProvider>
        <AppNavigator />
      </DeviceProvider>
    </SafeAreaProvider>
  );
}