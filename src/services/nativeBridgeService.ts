// src/services/nativeBridgeService.ts
import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';

const { CareDropBridge } = NativeModules;

export interface NativeFallAlertPayload {
  type: string;
  deviceId: string;
  deviceName?: string;
  fallTime?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Lấy cảnh báo té ngã từ Intent mở app (khi người dùng bấm vào thông báo hệ thống lúc app đang đóng)
 */
export async function getInitialNativeFallAlert(): Promise<NativeFallAlertPayload | null> {
  if (Platform.OS !== 'android' || !CareDropBridge?.getInitialFallAlert) return null;
  try {
    const data = await CareDropBridge.getInitialFallAlert();
    return data || null;
  } catch (e) {
    console.warn('[NativeBridge] getInitialFallAlert error:', e);
    return null;
  }
}

/**
 * Đăng ký lắng nghe sự kiện khi người dùng bấm vào thông báo té ngã trên thanh trạng thái lúc app đang chạy ngầm
 */
export function subscribeNativeFallAlert(
  callback: (payload: NativeFallAlertPayload) => void
): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub1 = DeviceEventEmitter.addListener('onFallNotificationTapped', callback);
  const sub2 = DeviceEventEmitter.addListener('onFallAlertTriggered', callback);
  return () => {
    sub1.remove();
    sub2.remove();
  };
}

/**
 * Đồng bộ danh sách ID thiết bị được phép nhận cảnh báo té ngã xuống Foreground Service Native (Android)
 * để dịch vụ nền 24/7 có thể lắng nghe Firestore của mọi thiết bị kể cả khi app bị tắt hoàn toàn.
 */
export function syncAllowedDevicesToNative(deviceIds: string[], userEmail?: string): void {
  if (Platform.OS !== 'android') return;

  if (!CareDropBridge) {
    console.warn('[NativeBridge] CareDropBridge native module not found');
    return;
  }

  try {
    const cleanIds = deviceIds
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);

    const cleanEmail = userEmail ? userEmail.trim().toLowerCase() : '';

    if (cleanEmail && typeof CareDropBridge.syncDevicesAndUser === 'function') {
      console.log(`[NativeBridge] Syncing ${cleanIds.length} devices and user ${cleanEmail} to native service`);
      CareDropBridge.syncDevicesAndUser(cleanIds, cleanEmail);
    } else if (typeof CareDropBridge.setAllowedAlertDevices === 'function') {
      console.log(`[NativeBridge] Syncing ${cleanIds.length} devices to native service:`, cleanIds);
      CareDropBridge.setAllowedAlertDevices(cleanIds);
    }
  } catch (err) {
    console.error('[NativeBridge] Error syncing allowed devices to native:', err);
  }
}

/**
 * Cập nhật email người dùng cho background service
 */
export function setUserEmailToNative(userEmail: string): void {
  if (Platform.OS !== 'android') return;

  if (!CareDropBridge || typeof CareDropBridge.setUserEmail !== 'function') return;

  try {
    const cleanEmail = userEmail.trim().toLowerCase();
    if (cleanEmail) {
      console.log(`[NativeBridge] Setting user email to native: ${cleanEmail}`);
      CareDropBridge.setUserEmail(cleanEmail);
    }
  } catch (err) {
    console.error('[NativeBridge] Error setting user email to native:', err);
  }
}

/**
 * Xóa thông báo cảnh báo té ngã trên thanh thông báo Android khi người dùng xác nhận
 */
export function dismissNotificationsNative(): void {
  if (Platform.OS !== 'android') return;
  if (!CareDropBridge || typeof CareDropBridge.dismissNotifications !== 'function') return;

  try {
    CareDropBridge.dismissNotifications();
  } catch (err) {
    console.error('[NativeBridge] Error dismissing notifications:', err);
  }
}

/**
 * Tắt cảnh báo té ngã và cập nhật fall_detected = false lên Firestore bằng Native Firebase Android
 */
export function acknowledgeFallNative(deviceId: string): void {
  if (Platform.OS !== 'android') return;
  if (!CareDropBridge || typeof CareDropBridge.acknowledgeFall !== 'function') return;

  try {
    const cleanId = (deviceId || '').trim();
    if (cleanId) {
      console.log(`[NativeBridge] Calling native acknowledgeFall for: ${cleanId}`);
      CareDropBridge.acknowledgeFall(cleanId);
    }
  } catch (err) {
    console.error('[NativeBridge] Error calling native acknowledgeFall:', err);
  }
}

/**
 * Tắt cảnh báo té ngã cho danh sách thiết bị bằng Native Firebase Android
 */
export function acknowledgeFallDevicesNative(deviceIds: string[]): void {
  if (Platform.OS !== 'android') return;
  if (!CareDropBridge || typeof CareDropBridge.acknowledgeFallDevices !== 'function') return;

  try {
    const cleanIds = deviceIds
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);
    if (cleanIds.length > 0) {
      console.log(`[NativeBridge] Calling native acknowledgeFallDevices for:`, cleanIds);
      CareDropBridge.acknowledgeFallDevices(cleanIds);
    }
  } catch (err) {
    console.error('[NativeBridge] Error calling native acknowledgeFallDevices:', err);
  }
}

