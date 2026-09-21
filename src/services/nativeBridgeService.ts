// src/services/nativeBridgeService.ts
import { NativeModules, Platform } from 'react-native';

const { CareDropBridge } = NativeModules;

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
