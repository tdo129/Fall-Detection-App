// src/context/DeviceContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { Vibration } from 'react-native';
import { doc, onSnapshot, updateDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { DeviceData, FallEvent, AppSettings } from '../types/device';

interface DeviceContextType {
  deviceData: DeviceData | null;
  fallEvents: FallEvent[];
  settings: AppSettings;
  isConnected: boolean;
  acknowledgefall: () => Promise<void>;
  triggerEmergency: () => Promise<void>;
  cancelEmergency: () => Promise<void>;
  updateSettings: (s: Partial<AppSettings>) => void;
  refreshHistory: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextType | null>(null);

const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  batteryThreshold: 20,
  deviceId: 'ESP32_FALL_001',
  mapAutoFollow: true,
};

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [fallEvents, setFallEvents] = useState<FallEvent[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isConnected, setIsConnected] = useState(false);
  const prevFallRef = useRef<boolean>(false);

  // Realtime listener cho device document
  useEffect(() => {
    const docRef = doc(db, 'devices', settings.deviceId);
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        setIsConnected(true);
        if (docSnap.exists()) {
          const data = docSnap.data() as DeviceData;
          setDeviceData(data);

          // Chỉ rung khi fall_detected chuyển từ false → true
          if (data.fall_detected && !prevFallRef.current && settings.notificationsEnabled) {
            Vibration.vibrate([0, 400, 200, 400, 200, 400]);
          }
          prevFallRef.current = data.fall_detected;
        }
      },
      (_error) => {
        setIsConnected(false);
      }
    );
    return () => unsubscribe();
  }, [settings.deviceId, settings.notificationsEnabled]);

  // Load fall history từ Firestore
  const refreshHistory = async () => {
    try {
      const q = query(
        collection(db, 'fall_events'),
        orderBy('timestamp', 'desc'),
        limit(100)
      );
      const snapshot = await getDocs(q);
      const events: FallEvent[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<FallEvent, 'id'>),
      }));
      setFallEvents(events);
    } catch (_e) {
      // Nếu collection chưa tồn tại, dùng mock data từ deviceData
      if (deviceData?.fall_time) {
        setFallEvents([
          {
            id: 'local-1',
            timestamp: deviceData.fall_time,
            latitude: deviceData.latitude,
            longitude: deviceData.longitude,
            battery_pct: deviceData.battery_pct,
            acknowledged: deviceData.ack_fall,
          },
        ]);
      }
    }
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  const acknowledgefall = async () => {
    const docRef = doc(db, 'devices', settings.deviceId);
    await updateDoc(docRef, { ack_fall: true, fall_detected: false });
  };

  const triggerEmergency = async () => {
    const docRef = doc(db, 'devices', settings.deviceId);
    await updateDoc(docRef, { emergency_mode: true });
  };

  const cancelEmergency = async () => {
    const docRef = doc(db, 'devices', settings.deviceId);
    await updateDoc(docRef, { emergency_mode: false });
  };

  const updateSettings = (s: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...s }));
  };

  return (
    <DeviceContext.Provider
      value={{
        deviceData,
        fallEvents,
        settings,
        isConnected,
        acknowledgefall,
        triggerEmergency,
        cancelEmergency,
        updateSettings,
        refreshHistory,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice must be used within DeviceProvider');
  return ctx;
}
