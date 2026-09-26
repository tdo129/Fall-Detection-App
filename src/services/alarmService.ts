// src/services/alarmService.ts
// Dịch vụ phát báo động khi phát hiện té ngã.
// Rung liên tục kết hợp thông báo âm thanh hệ thống.

import { Vibration, NativeModules, Platform } from 'react-native';

const { CareDropBridge } = NativeModules;

// ─── State quản lý alarm ─────────────────────────────────────────────────────
let alarmTimer: ReturnType<typeof setTimeout> | null = null;
let isAlarmPlaying = false;

export interface FallAlarmDetails {
  deviceId?: string;
  deviceName?: string;
  fallTime?: string;
  latitude?: number;
  longitude?: number;
  batteryPct?: number;
}

/**
 * Phát báo động rung liên tục khi té ngã và hiển thị thông báo.
 * Gọi stopFallAlarm() để dừng.
 */
export async function startFallAlarm(details?: FallAlarmDetails): Promise<void> {
  if (isAlarmPlaying) {
    console.log('[AlarmService] Alarm already playing, skipping');
    return;
  }

  isAlarmPlaying = true;
  console.log('[AlarmService] 🚨 Starting fall alarm (vibration + notification)...');

  try {
    // Rung liên tục theo pattern cảnh báo khẩn cấp
    Vibration.vibrate([0, 800, 400, 800, 400, 800], true);

    // Kích hoạt chuông báo thức looping + rung native + thông báo qua Foreground Service
    if (Platform.OS === 'android' && CareDropBridge) {
      try {
        if (details && typeof CareDropBridge.startAlarmWithDetails === 'function') {
          CareDropBridge.startAlarmWithDetails(details);
        } else if (typeof CareDropBridge.startAlarm === 'function') {
          CareDropBridge.startAlarm();
        }
        console.log('[AlarmService] Native alarm and notification started via CareDropBridge');
      } catch (bridgeErr) {
        console.warn('[AlarmService] Failed to start native alarm:', bridgeErr);
      }
    }

    // Tự động tắt sau 30 giây nếu người dùng chưa kịp bấm
    if (alarmTimer) clearTimeout(alarmTimer);
    alarmTimer = setTimeout(() => {
      console.log('[AlarmService] Auto-stopping alarm after 30s');
      stopFallAlarm();
    }, 30000);
  } catch (error) {
    console.error('[AlarmService] Error starting alarm:', error);
    isAlarmPlaying = false;
  }
}

/**
 * Dừng báo động (JS vibration + native MediaPlayer/Vibrator).
 * Gọi khi người dùng nhấn "Tắt báo động" trong app.
 */
export async function stopFallAlarm(caller?: string): Promise<void> {
  console.log('[AlarmService] Stopping alarm, called by:', caller || 'unknown');
  console.log(new Error().stack);
  isAlarmPlaying = false;

  // Dừng rung JS side
  Vibration.cancel();

  // Dừng timer nếu có
  if (alarmTimer) {
    clearTimeout(alarmTimer);
    alarmTimer = null;
  }

  // Dừng native alarm (MediaPlayer + Vibrator trong FallMonitoringService)
  if (Platform.OS === 'android' && CareDropBridge?.stopAlarm) {
    try {
      CareDropBridge.stopAlarm();
      console.log('[AlarmService] Native alarm stopped via bridge');
    } catch (e) {
      console.warn('[AlarmService] Failed to stop native alarm:', e);
    }
  }
}

/**
 * Kiểm tra xem alarm có đang kêu không.
 */
export function isAlarmActive(): boolean {
  return isAlarmPlaying;
}
