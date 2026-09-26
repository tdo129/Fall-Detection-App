// src/context/DeviceContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
} from 'react';
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../services/firebaseConfig';
import { DeviceData, FallEvent, AppSettings, PairedDevice } from '../types/device';
import {
  initializeNotifications,
  sendFallNotification,
  sendBatteryWarning,
} from '../services/notificationService';
import {
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  syncSettingsForBackground,
} from '../services/backgroundFallCheck';
import {
  loadFallHistory,
  saveFallEvent,
  clearFallHistory,
  acknowledgeFallEvent,
} from '../services/historyService';
import { startFallAlarm, stopFallAlarm } from '../services/alarmService';
import {
  syncAllowedDevicesToNative,
  getInitialNativeFallAlert,
  subscribeNativeFallAlert,
  dismissNotificationsNative,
  acknowledgeFallNative,
  acknowledgeFallDevicesNative,
} from '../services/nativeBridgeService';
import { useAuth } from './AuthContext';
import * as Notifications from 'expo-notifications';
import { navigateToDashboard } from '../navigation/navigationRef';

export const STORAGE_KEY_PAIRED_DEVICES = '@healthguard_paired_devices';
export const STORAGE_KEY_ACTIVE_DEVICE_ID = '@healthguard_active_device_id';

const DEFAULT_PAIRED_DEVICES: PairedDevice[] = [];

export interface ActiveFallAlert {
  deviceId: string;
  deviceName: string;
  fallTime?: string;
  latitude?: number;
  longitude?: number;
  battery_pct?: number;
}

interface DeviceContextType {
  deviceData: DeviceData | null;
  devicesData: Record<string, DeviceData>;
  pairedDevices: PairedDevice[];
  activeDeviceId: string;
  activeDevice: PairedDevice | undefined;
  activeFallAlert: ActiveFallAlert | null;
  fallEvents: FallEvent[];
  settings: AppSettings;
  isConnected: boolean;
  addPairedDevice: (
    id: string,
    name: string
  ) => Promise<{ success: boolean; message?: string }>;
  removePairedDevice: (id: string) => Promise<void>;
  setActiveDeviceId: (id: string) => void;
  simulateDeviceFall: (
    id: string,
    fall: boolean
  ) => Promise<{ cloudSynced: boolean; error?: string }>;
  acknowledgefall: (targetDeviceId?: string) => Promise<void>;
  triggerEmergency: () => Promise<void>;
  cancelEmergency: () => Promise<void>;
  updateSettings: (s: Partial<AppSettings>) => void;
  refreshHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
  acknowledgeEvent: (id: string) => Promise<void>;
}

const DeviceContext = createContext<DeviceContextType | null>(null);

const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  backgroundMonitoring: true,
  batteryThreshold: 20,
  deviceId: '',
  mapAutoFollow: true,
};

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userEmail = user?.email ? user.email.toLowerCase().trim() : '';

  // Khóa lưu trữ riêng biệt theo từng tài khoản Google
  const userDevicesKey = userEmail
    ? `@caredrop_paired_devices_${userEmail}`
    : STORAGE_KEY_PAIRED_DEVICES;
  const userActiveDeviceKey = userEmail
    ? `@caredrop_active_device_${userEmail}`
    : STORAGE_KEY_ACTIVE_DEVICE_ID;

  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [activeDeviceId, setActiveDeviceIdState] = useState<string>('');
  const [devicesData, setDevicesData] = useState<Record<string, DeviceData>>({});
  const [activeFallAlert, setActiveFallAlert] = useState<ActiveFallAlert | null>(null);
  const [fallEvents, setFallEvents] = useState<FallEvent[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const prevFallMapRef = useRef<Record<string, boolean>>({});
  const prevFallTimeMapRef = useRef<Record<string, string>>({});
  const acknowledgedFallTimeMapRef = useRef<Record<string, string>>({});
  const acknowledgedAtTimestampRef = useRef<Record<string, number>>({});
  const locallyDismissedFallMapRef = useRef<Record<string, boolean>>({});
  const prevBatteryWarnMapRef = useRef<Record<string, boolean>>({});
  const lastAlertTriggeredTimeRef = useRef<Record<string, number>>({});

  // ── Hàm kích hoạt cảnh báo té ngã tức thì (hiển thị modal, chuyển thiết bị, bật chuông, chuyển màn hình) ──
  const handleTriggerFallAlert = useCallback(
    (payload: {
      deviceId: string;
      deviceName?: string;
      fallTime?: string;
      latitude?: number;
      longitude?: number;
      battery_pct?: number;
    }) => {
      const rawDevId = payload.deviceId || (payload as any).device_id;
      if (!rawDevId) return;
      const devId = String(rawDevId).trim();
      const devName = payload.deviceName || (payload as any).device_name || devId;
      const fallTime = payload.fallTime || (payload as any).fall_time || new Date().toISOString();
      const lat = typeof payload.latitude === 'number' ? payload.latitude : 10.84;
      const lng = typeof payload.longitude === 'number' ? payload.longitude : 106.77;
      const battery = payload.battery_pct ?? 85;

      console.log(`[DeviceContext] 🚨 TRIGGER FALL ALERT for ${devId} (${devName})`);
      lastAlertTriggeredTimeRef.current[devId] = Date.now();

      // 1. Tự động chuyển tab xem sang thiết bị bị ngã ngay lập tức
      setActiveDeviceIdState(devId);
      if (userActiveDeviceKey) {
        AsyncStorage.setItem(userActiveDeviceKey, devId).catch(() => {});
      }

      // 2. Chuyển ngay màn hình sang "Tổng quan" (Dashboard)
      navigateToDashboard();

      // 3. Đặt trạng thái thiết bị là đang té ngã
      locallyDismissedFallMapRef.current[devId] = false;
      acknowledgedFallTimeMapRef.current[devId] = '';
      prevFallMapRef.current[devId] = true;
      prevFallTimeMapRef.current[devId] = fallTime;

      setDevicesData((prev) => ({
        ...prev,
        [devId]: {
          ...(prev[devId] || {
            device_id: devId,
            battery_pct: battery,
            connected: true,
          }),
          device_id: devId,
          fall_detected: true,
          fall_time: fallTime,
          latitude: lat,
          longitude: lng,
        },
      }));

      // 4. Bật chuông/rung báo động
      startFallAlarm();

      // 5. Kích hoạt Modal cảnh báo toàn màn hình ngay lập tức!
      setActiveFallAlert({
        deviceId: devId,
        deviceName: devName,
        fallTime: fallTime,
        latitude: lat,
        longitude: lng,
        battery_pct: battery,
      });
    },
    [userActiveDeviceKey]
  );

  // ── Khởi tạo notifications và lắng nghe sự kiện bấm thông báo ──────────────
  useEffect(() => {
    let isMounted = true;

    initializeNotifications().then((success) => {
      if (success) {
        console.log('[DeviceContext] Notifications initialized');
      }
    });

    // 1. Kiểm tra Android Native Bridge khi app được mở từ Intent thông báo chạy ngầm
    getInitialNativeFallAlert().then((payload) => {
      if (!isMounted || !payload) return;
      console.log('[DeviceContext] Initial native fall alert intent detected:', payload);
      handleTriggerFallAlert(payload);
    });

    // 2. Lắng nghe Android Native Bridge khi nhận thông báo hoặc chạm thông báo
    const unsubNative = subscribeNativeFallAlert((payload) => {
      if (!isMounted || !payload) return;
      console.log('[DeviceContext] Native fall notification event received:', payload);
      handleTriggerFallAlert(payload);
    });

    // 3. Expo Notifications: Lắng nghe bấm vào thông báo hoặc nhận thông báo lúc đang mở app
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!isMounted || !response) return;
      const data = response.notification.request.content.data;
      if (data?.type === 'fall_detected' && (data?.deviceId || data?.device_id)) {
        console.log('[DeviceContext] Expo cold-start notification response:', data);
        handleTriggerFallAlert({
          deviceId: String(data.deviceId || data.device_id),
          deviceName: String(data.deviceName || data.device_name || data.deviceId || data.device_id),
          fallTime: data.fallTime ? String(data.fallTime) : undefined,
          latitude: typeof data.latitude === 'number' ? data.latitude : undefined,
          longitude: typeof data.longitude === 'number' ? data.longitude : undefined,
        });
      }
    });

    const subResp = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === 'fall_detected' && (data?.deviceId || data?.device_id)) {
        console.log('[DeviceContext] Expo notification tapped:', data);
        handleTriggerFallAlert({
          deviceId: String(data.deviceId || data.device_id),
          deviceName: String(data.deviceName || data.device_name || data.deviceId || data.device_id),
          fallTime: data.fallTime ? String(data.fallTime) : undefined,
          latitude: typeof data.latitude === 'number' ? data.latitude : undefined,
          longitude: typeof data.longitude === 'number' ? data.longitude : undefined,
        });
      }
    });

    const subRecv = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      console.log('[DeviceContext] Expo notification received in foreground:', data);
      if (data?.type === 'fall_detected' && (data?.deviceId || data?.device_id)) {
        handleTriggerFallAlert({
          deviceId: String(data.deviceId || data.device_id),
          deviceName: String(data.deviceName || data.device_name || data.deviceId || data.device_id),
          fallTime: data.fallTime ? String(data.fallTime) : undefined,
          latitude: typeof data.latitude === 'number' ? data.latitude : undefined,
          longitude: typeof data.longitude === 'number' ? data.longitude : undefined,
        });
      }
    });

    return () => {
      isMounted = false;
      unsubNative();
      subResp.remove();
      subRecv.remove();
    };
  }, [handleTriggerFallAlert]);

  // ── Tải danh sách pairedDevices theo từng tài khoản Google khi đăng nhập ─────────────
  useEffect(() => {
    let isMounted = true;

    (async () => {
      if (!userEmail) {
        if (isMounted) {
          setPairedDevices([]);
          setActiveDeviceIdState('');
          setIsConnected(false);
        }
        return;
      }

      try {
        // 1. Kiểm tra bộ nhớ máy (AsyncStorage) của tài khoản Gmail này
        const stored = await AsyncStorage.getItem(userDevicesKey);
        if (stored !== null) {
          const list: PairedDevice[] = JSON.parse(stored);
          if (Array.isArray(list)) {
            if (isMounted) {
              setPairedDevices(list);
              const storedActive = await AsyncStorage.getItem(userActiveDeviceKey);
              if (storedActive && list.some((d) => d.id === storedActive)) {
                setActiveDeviceIdState(storedActive);
              } else if (list.length > 0) {
                setActiveDeviceIdState(list[0].id);
              } else {
                setActiveDeviceIdState('');
                setIsConnected(false);
              }
            }
            return;
          }
        }

        // 2. Nếu máy chưa có, kiểm tra trên Firestore users/{email}
        const userRef = doc(db, 'users', userEmail);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const cloudDevices = userSnap.data()?.pairedDevices;
          if (Array.isArray(cloudDevices) && cloudDevices.length > 0) {
            if (isMounted) {
              setPairedDevices(cloudDevices);
              setActiveDeviceIdState(cloudDevices[0].id);
              await AsyncStorage.setItem(userDevicesKey, JSON.stringify(cloudDevices));
              await AsyncStorage.setItem(userActiveDeviceKey, cloudDevices[0].id);
            }
            return;
          }
        }

        // 3. Mọi tài khoản Gmail đăng nhập lần đầu tiên: KHÔNG CÓ THIẾT BỊ NÀO CẢ (mảng rỗng)
        if (isMounted) {
          setPairedDevices([]);
          setActiveDeviceIdState('');
          setIsConnected(false);
          await AsyncStorage.setItem(userDevicesKey, JSON.stringify([]));
          await AsyncStorage.setItem(userActiveDeviceKey, '');
        }
      } catch (err) {
        console.warn('[DeviceContext] Error loading paired devices for user:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [userEmail, userDevicesKey, userActiveDeviceKey]);

  // ── Đồng bộ danh sách thiết bị ghép nối xuống Native Service chạy ngầm ─────
  useEffect(() => {
    const ids = pairedDevices.map((d) => d.id);
    syncAllowedDevicesToNative(ids, userEmail);
  }, [pairedDevices, userEmail]);

  // ── Quản lý background monitoring ────────────────────────────────────────
  useEffect(() => {
    if (settings.backgroundMonitoring && settings.notificationsEnabled) {
      syncSettingsForBackground({
        deviceId: activeDeviceId,
        batteryThreshold: settings.batteryThreshold,
        pairedDevices: pairedDevices.map((d) => ({ id: d.id, name: d.name })),
        userEmail,
      });
      registerBackgroundFetch();
    } else {
      unregisterBackgroundFetch();
    }
  }, [
    settings.backgroundMonitoring,
    settings.notificationsEnabled,
    activeDeviceId,
    settings.batteryThreshold,
    pairedDevices,
    userEmail,
  ]);

  // ── Realtime listeners cho TẤT CẢ các thiết bị đã ghép nối ───────────────
  useEffect(() => {
    if (pairedDevices.length === 0) return;

    const unsubscribers: Array<() => void> = [];

    pairedDevices.forEach((dev) => {
      const docRef = doc(db, 'devices', dev.id);
      const unsub = onSnapshot(
        docRef,
        (docSnap) => {
          setIsConnected(true);
          if (docSnap.exists()) {
            const data = docSnap.data() as DeviceData;
            // ── Kiểm tra té ngã cho thiết bị này ──
            const wasFalling = prevFallMapRef.current[dev.id] ?? false;
            const prevFallTime = prevFallTimeMapRef.current[dev.id];
            const currentFallTime = data.fall_time;

            // 1. Nếu Firestore không ghi nhận té ngã:
            if (!data.fall_detected) {
              prevFallMapRef.current[dev.id] = false;
              locallyDismissedFallMapRef.current[dev.id] = false;
              acknowledgedFallTimeMapRef.current[dev.id] = '';
              setDevicesData((prev) => ({
                ...prev,
                [dev.id]: {
                  ...data,
                  device_id: data.device_id || dev.id,
                  fall_detected: false,
                },
              }));

              setActiveFallAlert((current) =>
                current?.deviceId === dev.id ? null : current
              );
              return;
            }

            // 2. Nếu Firestore có ghi nhận té ngã (data.fall_detected === true):
            // Chỉ bỏ qua nếu chính sự cố này (cùng fall_time) vừa được người dùng bấm "Tắt cảnh báo" trên máy:
            const isDismissed = locallyDismissedFallMapRef.current[dev.id] ?? false;
            const ackFallTime = acknowledgedFallTimeMapRef.current[dev.id] || '';
            const isSameDismissedFall = Boolean(
              isDismissed && ackFallTime && currentFallTime && currentFallTime === ackFallTime
            );

            // Nếu người dùng vừa bấm tắt cho đúng sự cố này và Firestore đang trong quá trình đồng bộ:
            if (isSameDismissedFall) {
              setDevicesData((prev) => ({
                ...prev,
                [dev.id]: {
                  ...data,
                  device_id: data.device_id || dev.id,
                  fall_detected: false,
                },
              }));
              setActiveFallAlert((current) =>
                current?.deviceId === dev.id ? null : current
              );
              return;
            }

            // 3. Sự cố té ngã THẬT SỰ ĐANG DIỄN RA:
            locallyDismissedFallMapRef.current[dev.id] = false;
            acknowledgedFallTimeMapRef.current[dev.id] = '';
            setDevicesData((prev) => ({
              ...prev,
              [dev.id]: {
                ...data,
                device_id: data.device_id || dev.id,
                fall_detected: true,
              },
            }));

            // Xác định sự kiện té ngã MỚI:
            const isNewFall =
              !wasFalling || (Boolean(currentFallTime) && currentFallTime !== prevFallTime) || !activeFallAlert;

            if (isNewFall) {
              console.log(`[DeviceContext] 🚨 NEW fall detected on [${dev.id}] (${dev.name})!`);
              prevFallMapRef.current[dev.id] = true;
              if (currentFallTime) {
                prevFallTimeMapRef.current[dev.id] = currentFallTime;
              }
              handleTriggerFallAlert({
                deviceId: dev.id,
                deviceName: dev.name,
                fallTime: data.fall_time,
                latitude: data.latitude,
                longitude: data.longitude,
                battery_pct: data.battery_pct,
              });

              if (settings.notificationsEnabled) {
                sendFallNotification({
                  fallTime: data.fall_time,
                  latitude: data.latitude,
                  longitude: data.longitude,
                  deviceId: dev.id,
                  deviceName: dev.name,
                });
              }

              // Tự động lưu vào lịch sử sự cố
              const newEvent: Omit<FallEvent, 'id'> = {
                timestamp: data.fall_time || new Date().toISOString(),
                latitude: data.latitude ?? 10.84,
                longitude: data.longitude ?? 106.77,
                battery_pct: data.battery_pct ?? 100,
                acknowledged: false,
                deviceId: dev.id,
                deviceName: dev.name,
              };

              saveFallEvent({
                ...newEvent,
                deviceId: dev.id,
              }).then((saved) => {
                setFallEvents((prev) => {
                  const exists = prev.some(
                    (e) => e.id === saved.id || e.timestamp === saved.timestamp
                  );
                  return exists ? prev : [saved, ...prev];
                });
              });
            }

            // ── Kiểm tra pin thấp ──
            const batt = data.battery_pct ?? 100;
            const wasWarned = prevBatteryWarnMapRef.current[dev.id] ?? false;
            if (batt <= settings.batteryThreshold && !wasWarned && settings.notificationsEnabled) {
              sendBatteryWarning(batt, dev.name);
              prevBatteryWarnMapRef.current[dev.id] = true;
            } else if (batt > settings.batteryThreshold) {
              prevBatteryWarnMapRef.current[dev.id] = false;
            }
          }
        },
        (_error) => {
          console.warn(`[DeviceContext] Error listening to ${dev.id}:`, _error);
        }
      );
      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [pairedDevices, settings.notificationsEnabled, settings.batteryThreshold, handleTriggerFallAlert]);

  // ── Thêm thiết bị phần cứng mới ──────────────────────────────────────────
  const addPairedDevice = async (
    id: string,
    name: string
  ): Promise<{ success: boolean; message?: string }> => {
    const trimmedId = id.trim();
    const trimmedName = name.trim() || trimmedId;

    if (!trimmedId) {
      return { success: false, message: 'Mã nhận diện thiết bị không được để trống.' };
    }

    if (pairedDevices.some((d) => d.id.toLowerCase() === trimmedId.toLowerCase())) {
      return { success: false, message: `Thiết bị [${trimmedId}] đã có trong danh sách.` };
    }

    const newDev: PairedDevice = {
      id: trimmedId,
      name: trimmedName,
      addedAt: new Date().toISOString(),
    };

    const updated = [...pairedDevices, newDev];
    setPairedDevices(updated);
    setActiveDeviceIdState(trimmedId);

    try {
      await AsyncStorage.setItem(userDevicesKey, JSON.stringify(updated));
      await AsyncStorage.setItem(userActiveDeviceKey, trimmedId);

      // Cập nhật lên profile người dùng trên Firestore
      if (userEmail) {
        const userRef = doc(db, 'users', userEmail);
        await setDoc(userRef, { pairedDevices: updated }, { merge: true });
      }

      // Khởi tạo document trên Firestore nếu chưa có để người dùng test ngay
      const docRef = doc(db, 'devices', trimmedId);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        await setDoc(docRef, {
          device_id: trimmedId,
          fall_detected: false,
          battery_pct: 100,
          latitude: 10.8505,
          longitude: 106.7739,
          fall_time: new Date().toISOString(),
          ack_fall: false,
          emergency_mode: false,
          connected: true,
          last_updated: new Date().toISOString(),
        });
      }

      // Kích hoạt ngay lập tức sang Foreground Service Native
      syncAllowedDevicesToNative(updated.map((d) => d.id), userEmail);
    } catch (err) {
      console.warn('[DeviceContext] Error saving new device:', err);
    }

    return { success: true };
  };

  // ── Xóa thiết bị phần cứng ───────────────────────────────────────────────
  const removePairedDevice = async (id: string) => {
    const updated = pairedDevices.filter((d) => d.id !== id);
    setPairedDevices(updated);

    let nextActive = '';
    if (updated.length > 0) {
      nextActive = activeDeviceId === id ? updated[0].id : activeDeviceId;
    } else {
      setIsConnected(false);
    }
    setActiveDeviceIdState(nextActive);

    try {
      await AsyncStorage.setItem(userDevicesKey, JSON.stringify(updated));
      await AsyncStorage.setItem(userActiveDeviceKey, nextActive);

      if (userEmail) {
        const userRef = doc(db, 'users', userEmail);
        await setDoc(userRef, { pairedDevices: updated }, { merge: true });
      }

      // Cập nhật ngay danh sách còn lại sang Native Service
      syncAllowedDevicesToNative(updated.map((d) => d.id), userEmail);
    } catch (err) {
      console.warn('[DeviceContext] Error removing device:', err);
    }
  };

  // ── Chuyển đổi thiết bị đang chọn xem ────────────────────────────────────
  const setActiveDeviceId = (id: string) => {
    setActiveDeviceIdState(id);
    AsyncStorage.setItem(userActiveDeviceKey, id).catch(() => {});
  };

  // ── Giả lập té ngã trên Firebase (phục vụ test trực tiếp & kích hoạt báo động) ──────
  const simulateDeviceFall = async (
    id: string,
    fall: boolean
  ): Promise<{ cloudSynced: boolean; error?: string }> => {
    const dev = pairedDevices.find((d) => d.id === id);
    const devName = dev?.name || id;
    const nowIso = new Date().toISOString();

    if (fall) {
      locallyDismissedFallMapRef.current[id] = false;
      prevFallMapRef.current[id] = true;
      prevFallTimeMapRef.current[id] = nowIso;
      setActiveDeviceIdState(id);
      if (userActiveDeviceKey) {
        AsyncStorage.setItem(userActiveDeviceKey, id).catch(() => {});
      }

      setDevicesData((prev) => ({
        ...prev,
        [id]: {
          ...(prev[id] || {
            device_id: id,
            battery_pct: 85,
            latitude: 10.84,
            longitude: 106.77,
            connected: true,
          }),
          device_id: id,
          fall_detected: true,
          ack_fall: false,
          fall_time: nowIso,
          last_updated: nowIso,
        },
      }));

      // Bật chuông/rung cảnh báo ngay lập tức
      startFallAlarm();

      // Gửi thông báo đẩy hệ thống
      if (settings.notificationsEnabled) {
        sendFallNotification({
          deviceId: id,
          deviceName: devName,
          fallTime: nowIso,
          latitude: devicesData[id]?.latitude ?? 10.84,
          longitude: devicesData[id]?.longitude ?? 106.77,
        });
      }

      // Kích hoạt modal cảnh báo khẩn cấp toàn màn hình
      setActiveFallAlert({
        deviceId: id,
        deviceName: devName,
        fallTime: nowIso,
        latitude: devicesData[id]?.latitude ?? 10.84,
        longitude: devicesData[id]?.longitude ?? 106.77,
        battery_pct: devicesData[id]?.battery_pct ?? 85,
      });

      // Lưu sự kiện vào lịch sử
      try {
        const saved = await saveFallEvent({
          timestamp: nowIso,
          latitude: devicesData[id]?.latitude ?? 10.84,
          longitude: devicesData[id]?.longitude ?? 106.77,
          battery_pct: devicesData[id]?.battery_pct ?? 85,
          acknowledged: false,
          deviceId: id,
          deviceName: devName,
        });
        setFallEvents((prev) => [saved, ...prev]);
      } catch (e) {
        console.warn('[DeviceContext] Could not save fall event to history:', e);
      }
    } else {
      // Đặt lại bình thường
      prevFallMapRef.current[id] = false;
      locallyDismissedFallMapRef.current[id] = true;
      await stopFallAlarm();
      setActiveFallAlert((current) => (current?.deviceId === id ? null : current));

      setDevicesData((prev) => {
        if (!prev[id]) return prev;
        return {
          ...prev,
          [id]: {
            ...prev[id],
            fall_detected: false,
            ack_fall: true,
            last_updated: nowIso,
          },
        };
      });
    }

    // Đồng bộ lên Firebase Firestore nếu có quyền
    let cloudSynced = false;
    let cloudError: string | undefined;

    try {
      const docRef = doc(db, 'devices', id);
      await setDoc(
        docRef,
        {
          device_id: id,
          fall_detected: fall,
          ack_fall: !fall,
          fall_time: nowIso,
          last_updated: nowIso,
          battery_pct: devicesData[id]?.battery_pct ?? 85,
          connected: true,
        },
        { merge: true }
      );
      cloudSynced = true;
    } catch (err: any) {
      console.warn('[DeviceContext] Firestore setDoc notice (test proceeded locally):', err);
      cloudSynced = false;
      cloudError = err?.message || 'Lỗi quyền ghi Firebase (Rules)';
    }

    return { cloudSynced, error: cloudError };
  };

  // ── Load fall history từ Firestore & AsyncStorage ────────────────────────
  const refreshHistory = useCallback(async () => {
    try {
      const list = await loadFallHistory();
      setFallEvents(list);
    } catch (e) {
      console.warn('[DeviceContext] Error in refreshHistory:', e);
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const clearHistory = async () => {
    await clearFallHistory();
    setFallEvents([]);
  };

  const acknowledgeEvent = async (id: string) => {
    await acknowledgeFallEvent(id);
    setFallEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, acknowledged: true } : e))
    );
  };

  // ── Xác nhận sự cố té ngã ────────────────────────────────────────────────
  const acknowledgefall = async (targetDeviceId?: string) => {
    console.log('[DeviceContext] 🛑 acknowledgefall called for device:', targetDeviceId);
    await stopFallAlarm('acknowledgefall');
    setActiveFallAlert(null);

    // Thu thập tất cả các thiết bị cần tắt cảnh báo
    const targetsToAck = new Set<string>();
    if (targetDeviceId && targetDeviceId.trim()) targetsToAck.add(targetDeviceId.trim());
    if (activeDeviceId && activeDeviceId.trim()) targetsToAck.add(activeDeviceId.trim());
    pairedDevices.forEach((d) => {
      if (d.id && d.id.trim()) targetsToAck.add(d.id.trim());
    });
    Object.keys(devicesData).forEach((id) => {
      if (id && id.trim()) {
        if (devicesData[id]?.fall_detected) targetsToAck.add(id.trim());
      }
    });
    // Đảm bảo ESP32_FALL_001 luôn có mặt nếu người dùng đang dùng
    if (devicesData['ESP32_FALL_001']) targetsToAck.add('ESP32_FALL_001');

    const targetList = Array.from(targetsToAck);
    console.log('[DeviceContext] Targets to acknowledge:', targetList);

    const now = Date.now();
    targetList.forEach((target) => {
      lastAlertTriggeredTimeRef.current[target] = 0;
      prevFallMapRef.current[target] = false;
      locallyDismissedFallMapRef.current[target] = true;
      acknowledgedAtTimestampRef.current[target] = now;
      const currentFt = devicesData[target]?.fall_time || new Date().toISOString();
      acknowledgedFallTimeMapRef.current[target] = currentFt;
    });

    // Reset trạng thái cục bộ NGAY LẬP TỨC để Dashboard và biểu tượng lập tức về bình thường
    setDevicesData((prev) => {
      const next = { ...prev };
      targetList.forEach((target) => {
        next[target] = {
          ...(next[target] || { device_id: target, battery_pct: 85, connected: true }),
          fall_detected: false,
          ack_fall: true,
        };
      });
      return next;
    });

    // 1. Gọi Native Android Firebase SDK cập nhật fall_detected = false
    try {
      acknowledgeFallDevicesNative(targetList);
      targetList.forEach((target) => acknowledgeFallNative(target));
    } catch (_nativeErr) {
      console.warn('[DeviceContext] Error calling native acknowledge:', _nativeErr);
    }

    // 2. Dismiss native Android alert notifications
    dismissNotificationsNative();

    // 3. Dismiss notifications qua expo-notifications
    try {
      const Notifications = await import('expo-notifications');
      await Notifications.dismissAllNotificationsAsync();
    } catch (_e) {}

    // 4. Cập nhật Firebase Firestore qua Web SDK (updateDoc + setDoc) và REST API đồng thời
    const updatePromises = targetList.map(async (target) => {
      // 4a. updateDoc / setDoc
      try {
        const docRef = doc(db, 'devices', target);
        await updateDoc(docRef, { fall_detected: false, ack_fall: true }).catch(async () => {
          await setDoc(docRef, { fall_detected: false, ack_fall: true }, { merge: true });
        });
        console.log(`[DeviceContext] Firestore setDoc success for ${target}`);
      } catch (err) {
        console.warn(`[DeviceContext] Error updating Firestore for ${target}:`, err);
      }

      // 4b. Direct REST API PATCH
      try {
        const restUrl = `https://firestore.googleapis.com/v1/projects/doandidongtest/databases/(default)/documents/devices/${target}?updateMask.fieldPaths=fall_detected&updateMask.fieldPaths=ack_fall`;
        await fetch(restUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              fall_detected: { booleanValue: false },
              ack_fall: { booleanValue: true },
            },
          }),
        });
        console.log(`[DeviceContext] REST PATCH success for ${target}`);
      } catch (err) {
        console.warn(`[DeviceContext] Error REST PATCH for ${target}:`, err);
      }
    });

    await Promise.allSettled(updatePromises);

    if (fallEvents.length > 0) {
      acknowledgeEvent(fallEvents[0].id);
    }
  };

  const triggerEmergency = async () => {
    const docRef = doc(db, 'devices', activeDeviceId);
    await updateDoc(docRef, { emergency_mode: true });
  };

  const cancelEmergency = async () => {
    const docRef = doc(db, 'devices', activeDeviceId);
    await updateDoc(docRef, { emergency_mode: false });
  };

  const updateSettings = (s: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...s }));
  };

  // Thiết bị hiện tại đang active
  const activeDevice = pairedDevices.find((d) => d.id === activeDeviceId);

  // Dữ liệu thiết bị tương thích ngược:
  // Nếu có activeFallAlert đang kêu, ưu tiên hiển thị dữ liệu của thiết bị đang té ngã
  const activeFallData = activeFallAlert ? devicesData[activeFallAlert.deviceId] : null;
  const currentDeviceData = devicesData[activeDeviceId] || null;

  const resolvedDeviceData: DeviceData | null =
    activeFallAlert && activeFallData && activeFallData.fall_detected
      ? {
          ...activeFallData,
          fall_detected: true,
          device_id: activeFallAlert.deviceId,
        }
      : currentDeviceData;

  return (
    <DeviceContext.Provider
      value={{
        deviceData: resolvedDeviceData,
        devicesData,
        pairedDevices,
        activeDeviceId,
        activeDevice,
        activeFallAlert,
        fallEvents,
        settings: {
          ...settings,
          deviceId: activeDeviceId,
          pairedDevices,
        },
        isConnected,
        addPairedDevice,
        removePairedDevice,
        setActiveDeviceId,
        simulateDeviceFall,
        acknowledgefall,
        triggerEmergency,
        cancelEmergency,
        updateSettings,
        refreshHistory,
        clearHistory,
        acknowledgeEvent,
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
