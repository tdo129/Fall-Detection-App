// src/types/device.ts
export interface DeviceData {
  fall_detected: boolean; // True: có té ngã, False: bình thường
  latitude: number;       // Vĩ độ GPS[cite: 1]
  longitude: number;      // Kinh độ GPS[cite: 1]
  battery_pct: number;    // Phần trăm pin thiết bị (%)[cite: 1]
  fall_time: string;      // Thời gian xảy ra sự cố[cite: 1]
  ack_fall: boolean;      // Cờ xác nhận app đã nhận thông báo[cite: 1]
}