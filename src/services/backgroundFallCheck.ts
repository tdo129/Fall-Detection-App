// src/services/backgroundFallCheck.ts
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { syncAllowedDevicesToNative } from './nativeBridgeService';

export const BACKGROUND_FALL_CHECK_TASK = 'BACKGROUND_FALL_CHECK';
const STORAGE_KEY_DEVICE_ID = '@bg_device_id';
const STORAGE_KEY_BATTERY_THRESHOLD = '@bg_battery_threshold';
export const STORAGE_KEY_PAIRED_DEVICES = '@bg_paired_devices';

// In Expo Development Build, defining a headless background fetch task creates
// an orphan React Native context in the background which conflicts with DevLauncher
// and crashes MainActivity. The production-grade native Android Foreground Service
// (FallMonitoringService) handles all background monitoring reliably in real time.

export async function registerBackgroundFetch(): Promise<boolean> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FALL_CHECK_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FALL_CHECK_TASK);
    }
  } catch (_e) {}
  return true;
}

export async function unregisterBackgroundFetch(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_FALL_CHECK_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_FALL_CHECK_TASK);
    }
  } catch (_e) {}
}

export async function isBackgroundFetchRegistered(): Promise<boolean> {
  return true;
}

export async function getBackgroundFetchStatus(): Promise<string> {
  return 'Khả dụng';
}

export async function syncSettingsForBackground(settings: {
  deviceId: string;
  batteryThreshold: number;
  pairedDevices?: Array<{ id: string; name: string }>;
  userEmail?: string;
}): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_DEVICE_ID, settings.deviceId);
  await AsyncStorage.setItem(
    STORAGE_KEY_BATTERY_THRESHOLD,
    String(settings.batteryThreshold)
  );
  if (settings.pairedDevices) {
    await AsyncStorage.setItem(
      STORAGE_KEY_PAIRED_DEVICES,
      JSON.stringify(settings.pairedDevices)
    );
    syncAllowedDevicesToNative(
      settings.pairedDevices.map((d) => d.id),
      settings.userEmail
    );
  }
}
