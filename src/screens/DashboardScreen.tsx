// src/screens/DashboardScreen.tsx
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Vibration } from 'react-native';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { DeviceData } from '../types/device';

export default function DashboardScreen() {
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);

  useEffect(() => {
    // Lắng nghe dữ liệu thời gian thực từ Firestore
    const docRef = doc(db, 'devices', 'ESP32_FALL_001');
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as DeviceData;
        setDeviceData(data);

        // Kích hoạt rung nếu phát hiện té ngã
        if (data.fall_detected) {
          Vibration.vibrate([500, 500, 500]);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Nút xác nhận: Gửi ack_fall = true để phần cứng ESP32 kết thúc báo động
  const handleAcknowledgeFall = async () => {
    try {
      const docRef = doc(db, 'devices', 'ESP32_FALL_001');
      await updateDoc(docRef, {
        ack_fall: true,
        fall_detected: false,
      });
    } catch (error) {
      console.error("Lỗi khi gửi xác nhận: ", error);
    }
  };

  // Nút khẩn cấp: Gửi emergency_mode = true để ESP32 gửi GPS liên tục
  const handleEmergencyMode = async () => {
    try {
      const docRef = doc(db, 'devices', 'ESP32_FALL_001');
      await updateDoc(docRef, {
        emergency_mode: true,
      });
    } catch (error) {
      console.error("Lỗi kích hoạt khẩn cấp: ", error);
    }
  };

  const isFall = deviceData?.fall_detected;

  return (
    <View style={[styles.container, { backgroundColor: isFall ? '#d9534f' : '#2b5797' }]}>
      <Text style={styles.headerTitle}>Healthcare Map Dashboard</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Trạng thái thiết bị</Text>
        <Text style={styles.cardValue}>
          {isFall ? '⚠️ PHÁT HIỆN TÉ NGÃ!' : '🟢 Đang hoạt động bình thường'}
        </Text>
        <Text style={styles.subText}>
          Pin: {deviceData?.battery_pct ?? '--'}%
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Tọa độ GPS gần nhất</Text>
        <Text style={styles.cardValue}>
          Lat: {deviceData?.latitude ?? 'Đang cập nhật...'}
        </Text>
        <Text style={styles.cardValue}>
          Lng: {deviceData?.longitude ?? 'Đang cập nhật...'}
        </Text>
      </View>

      {isFall && (
        <TouchableOpacity style={styles.ackButton} onPress={handleAcknowledgeFall}>
          <Text style={styles.buttonText}>Xác nhận & Tắt báo động</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.sosButton} onPress={handleEmergencyMode}>
        <Text style={styles.buttonText}>Bật Chế Độ Khẩn Cấp (Yêu cầu GPS)</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 20 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 15, marginBottom: 15, elevation: 3 },
  cardLabel: { fontSize: 14, color: '#666', fontWeight: '600' },
  cardValue: { fontSize: 16, fontWeight: 'bold', color: '#333', marginTop: 5 },
  subText: { fontSize: 14, color: '#008000', marginTop: 5, fontWeight: 'bold' },
  ackButton: { backgroundColor: '#f0ad4e', padding: 15, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  sosButton: { backgroundColor: '#d9534f', padding: 15, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 }
});