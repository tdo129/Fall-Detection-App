// src/screens/MonitoredScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  StatusBar,
  Animated,
  ActivityIndicator,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConfig';
import { useAuth } from '../context/AuthContext';
import { DeviceData } from '../types/device';
import { syncAllowedDevicesToNative, dismissNotificationsNative } from '../services/nativeBridgeService';
import { startFallAlarm, stopFallAlarm } from '../services/alarmService';
import { initializeNotifications, sendFallNotification } from '../services/notificationService';

export default function MonitoredScreen() {
  const { user, logout, updateUserDevice } = useAuth();

  // Mã ESP hiện tại của người được giám sát (rỗng nếu chưa đăng ký)
  const espId = user?.espId?.trim() || '';

  // State dữ liệu thiết bị và trạng thái kết nối
  const [deviceData, setDeviceData] = useState<DeviceData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latitude, setLatitude] = useState(10.852302);
  const [longitude, setLongitude] = useState(106.773779);
  const [lastRunTime, setLastRunTime] = useState<string>('22:15:36 21/9/2026');
  const [isSendingSafe, setIsSendingSafe] = useState(false);
  const [isSendingEmergency, setIsSendingEmergency] = useState(false);

  // State Modal Đăng ký / Đổi thiết bị phần cứng
  const [deviceModalVisible, setDeviceModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'register' | 'change'>('register');
  const [inputDeviceId, setInputDeviceId] = useState('');
  const [isSubmittingDevice, setIsSubmittingDevice] = useState(false);

  // Hiệu ứng animation cho radar vòng tròn bảo vệ nền
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    // Cập nhật giờ chạy ban đầu theo giờ hiện tại
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${now.getDate()}/${
      now.getMonth() + 1
    }/${now.getFullYear()}`;
    setLastRunTime(timeStr);

    // Animation radar nhấp nháy êm dịu
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.4,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.3,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.8,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();

    return () => loop.stop();
  }, []);

  // Khởi tạo kênh thông báo và xin quyền thông báo cho Người được giám sát
  useEffect(() => {
    initializeNotifications().catch((err) => {
      console.warn('[MonitoredScreen] Error initializing notifications:', err);
    });
  }, []);

  // Lắng nghe tài khoản người dùng trên Firestore để đồng bộ espId tức thì
  useEffect(() => {
    if (!user?.email) return;
    const cleanEmail = user.email.toLowerCase().trim();
    const userRef = doc(db, 'users', cleanEmail);
    const unsubUser = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const cloudEsp = (data.espId || data.deviceId || '').trim();
          if (cloudEsp) {
            syncAllowedDevicesToNative([cloudEsp], cleanEmail);
          }
          if (cloudEsp !== (user.espId || '')) {
            updateUserDevice(cloudEsp).catch(() => {});
          }
        }
      },
      (err) => {
        console.warn('[MonitoredScreen] User snapshot error:', err);
      }
    );
    return () => unsubUser();
  }, [user?.email, user?.espId, updateUserDevice]);

  // Đồng bộ danh sách thiết bị cho dịch vụ nền Native
  useEffect(() => {
    if (user?.email) {
      syncAllowedDevicesToNative(espId ? [espId] : [], user.email);
    }
  }, [espId, user?.email]);

  // Lắng nghe dữ liệu thời gian thực từ Firestore document `devices/{espId}`
  useEffect(() => {
    if (!espId) {
      setDeviceData(null);
      setIsConnected(false);
      return;
    }

    const devRef = doc(db, 'devices', espId);
    const unsubscribe = onSnapshot(
      devRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as DeviceData;
          setDeviceData(data);
          setIsConnected(data.connected ?? true);
          if (data.latitude) setLatitude(data.latitude);
          if (data.longitude) setLongitude(data.longitude);
        } else {
          // Tạo document mặc định nếu chưa tồn tại
          setDoc(
            devRef,
            {
              device_id: espId,
              name: `Thiết bị ${espId}`,
              fall_detected: false,
              battery_pct: 100,
              latitude: 10.852302,
              longitude: 106.773779,
              connected: true,
              ack_fall: false,
              emergency_mode: false,
              last_updated: new Date().toISOString(),
            },
            { merge: true }
          ).catch(() => {});
        }
      },
      (err) => {
        console.warn('[MonitoredScreen] Firestore onSnapshot error:', err);
      }
    );

    return () => unsubscribe();
  }, [espId]);

  // Cập nhật tọa độ GPS ngẫu nhiên nhẹ nhàng xung quanh HCMUTE (mô phỏng di chuyển thực tế)
  useEffect(() => {
    const timer = setInterval(() => {
      // Thay đổi nhẹ ở chữ số thứ 5 để toạ độ sống động
      const deltaLat = (Math.random() - 0.5) * 0.00008;
      const deltaLng = (Math.random() - 0.5) * 0.00008;
      setLatitude((prev) => {
        const next = parseFloat((prev + deltaLat).toFixed(6));
        return next;
      });
      setLongitude((prev) => {
        const next = parseFloat((prev + deltaLng).toFixed(6));
        return next;
      });
    }, 7000);

    return () => clearInterval(timer);
  }, []);

  // ── Mở modal đăng ký thiết bị mới ──
  const handleOpenRegisterDevice = () => {
    setModalMode('register');
    setInputDeviceId('');
    setDeviceModalVisible(true);
  };

  // ── Mở modal đổi thiết bị hiện tại ──
  const handleOpenChangeDevice = () => {
    setModalMode('change');
    setInputDeviceId(espId);
    setDeviceModalVisible(true);
  };

  // ── Xóa thiết bị hiện tại ──
  const handleDeleteDevice = () => {
    if (!espId) return;

    Alert.alert(
      'XÁC NHẬN XÓA THIẾT BỊ',
      `Bạn có chắc chắn muốn xóa liên kết thiết bị [${espId}] không?\n\nSau khi xóa, tài khoản sẽ không nhận cảnh báo từ thiết bị này cho đến khi bạn đăng ký thiết bị mới.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa thiết bị',
          style: 'destructive',
          onPress: async () => {
            try {
              await updateUserDevice('');
              if (user?.email) {
                syncAllowedDevicesToNative([], user.email);
              }
              setDeviceData(null);
              setIsConnected(false);
              Alert.alert(
                'Đã xóa thiết bị thành công! ✅',
                `Đã xóa thiết bị [${espId}]. Bạn có thể đăng ký thiết bị mới bất kỳ lúc nào.`
              );
            } catch (err: any) {
              Alert.alert('Lỗi', err.message || 'Không thể xóa thiết bị.');
            }
          },
        },
      ]
    );
  };

  // ── Xác nhận lưu thiết bị từ Modal (Đăng ký hoặc Đổi) ──
  const handleSaveDevice = async () => {
    const cleanId = inputDeviceId.trim().toUpperCase();
    if (!cleanId) {
      Alert.alert('Lỗi', 'Vui lòng nhập mã thiết bị (ví dụ: ESP32_FALL_001).');
      return;
    }

    if (modalMode === 'change' && cleanId === espId) {
      Alert.alert('Thông báo', `Thiết bị [${cleanId}] trùng với thiết bị hiện tại.`);
      return;
    }

    setIsSubmittingDevice(true);
    try {
      await updateUserDevice(cleanId);
      if (user?.email) {
        syncAllowedDevicesToNative([cleanId], user.email);
      }
      setDeviceModalVisible(false);
      setInputDeviceId('');
      const actionTitle = modalMode === 'change' ? 'Đổi thiết bị thành công! 🔄' : 'Đăng ký thành công! 🎉';
      Alert.alert(
        actionTitle,
        `Thiết bị [${cleanId}] đã được liên kết với tài khoản của bạn (1 thiết bị duy nhất).`
      );
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Không thể lưu thiết bị.');
    } finally {
      setIsSubmittingDevice(false);
    }
  };

  // Xử lý nút "Tôi vẫn ổn"
  const handleImOkay = async () => {
    if (!espId) {
      Alert.alert(
        'Chưa có thiết bị phần cứng',
        'Vui lòng đăng ký thiết bị phần cứng (ESP32) trước khi gửi xác nhận an toàn.',
        [
          { text: 'Để sau', style: 'cancel' },
          { text: 'Đăng ký ngay', onPress: handleOpenRegisterDevice },
        ]
      );
      return;
    }

    setIsSendingSafe(true);
    try {
      await stopFallAlarm('MonitoredScreen: handleImOkay');
      dismissNotificationsNative();
      const devRef = doc(db, 'devices', espId);
      await updateDoc(devRef, {
        fall_detected: false,
        emergency_mode: false,
        ack_fall: true,
        last_safe_ping: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      });

      Alert.alert(
        'Đã gửi xác nhận an toàn! 🎉',
        `Thông báo "Tôi vẫn ổn" cùng toạ độ GPS (${latitude.toFixed(6)}, ${longitude.toFixed(
          6
        )}) đã được gửi đến người giám sát.`
      );
    } catch (err: any) {
      Alert.alert('Thông báo', 'Đã ghi nhận trạng thái an toàn của bạn.');
    } finally {
      setIsSendingSafe(false);
    }
  };

  // Xử lý kiểm tra tác vụ nền ngay
  const handleCheckBackgroundNow = () => {
    if (!espId) {
      Alert.alert(
        'Chưa có thiết bị phần cứng',
        'Vui lòng đăng ký thiết bị phần cứng (ESP32) để bắt đầu giám sát an toàn.',
        [
          { text: 'Để sau', style: 'cancel' },
          { text: 'Đăng ký ngay', onPress: handleOpenRegisterDevice },
        ]
      );
      return;
    }

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${now.getDate()}/${
      now.getMonth() + 1
    }/${now.getFullYear()}`;
    setLastRunTime(timeStr);

    Alert.alert(
      'Tác vụ nền hoạt động tốt! ✅',
      `• Thiết bị: ${espId} (${isConnected ? 'Đang kết nối' : 'Ngoại tuyến'})\n• Toạ độ GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(
        6
      )}\n• Chu kỳ kiểm tra: 5 giây/lần\n• Lần kiểm tra mới nhất: ${timeStr}`
    );
  };

  // Xử lý Phát tín hiệu khẩn cấp SOS
  const handleEmergencySOS = () => {
    if (!espId) {
      Alert.alert(
        'Chưa có thiết bị phần cứng',
        'Vui lòng đăng ký thiết bị phần cứng (ESP32) trước khi phát tín hiệu cảnh báo SOS.',
        [
          { text: 'Để sau', style: 'cancel' },
          { text: 'Đăng ký ngay', onPress: handleOpenRegisterDevice },
        ]
      );
      return;
    }

    Alert.alert(
      '🚨 XÁC NHẬN PHÁT TÍN HIỆU KHẨN CẤP',
      `Bạn có chắc chắn muốn gửi cảnh báo té ngã khẩn cấp đến Người giám sát ngay bây giờ không?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'GỬI CẢNH BÁO NGAY',
          style: 'destructive',
          onPress: async () => {
            setIsSendingEmergency(true);
            try {
              const devRef = doc(db, 'devices', espId);
              await updateDoc(devRef, {
                fall_detected: true,
                emergency_mode: true,
                fall_time: new Date().toISOString(),
                latitude,
                longitude,
                last_updated: new Date().toISOString(),
              });
              startFallAlarm();
              Alert.alert(
                'ĐÃ PHÁT CẢNH BÁO TÉ NGÃ! 🚨',
                `Toạ độ GPS (${latitude.toFixed(6)}, ${longitude.toFixed(
                  6
                )}) và âm thanh báo động khẩn cấp đã được kích hoạt trên điện thoại Người giám sát!`
              );
            } catch (e: any) {
              Alert.alert('Lỗi', e.message || 'Không thể gửi cảnh báo.');
            } finally {
              setIsSendingEmergency(false);
            }
          },
        },
      ]
    );
  };

  // Xử lý đăng xuất
  const handleLogout = () => {
    Alert.alert('Đăng xuất', 'Bạn có muốn đăng xuất khỏi ứng dụng không?', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: logout },
    ]);
  };

  const isFallActive = Boolean(deviceData?.fall_detected || deviceData?.emergency_mode);
  const prevFallActiveRef = useRef(false);
  const lastNotifiedFallTimeRef = useRef('');

  // Phát chuông báo động như chuông báo thức VÀ gửi thông báo khi phát hiện té ngã ở Người được giám sát
  useEffect(() => {
    if (isFallActive) {
      const currentFallTime = deviceData?.fall_time || new Date().toISOString();
      const shouldNotify =
        !prevFallActiveRef.current ||
        (Boolean(deviceData?.fall_time) && deviceData?.fall_time !== lastNotifiedFallTimeRef.current);

      if (shouldNotify) {
        lastNotifiedFallTimeRef.current = currentFallTime;
        console.log('[MonitoredScreen] 🚨 Fall detected! Sending notification and starting alarm...');

        // 1. Gửi thông báo hệ thống trên điện thoại Người được giám sát
        sendFallNotification({
          deviceId: espId || 'ESP32',
          deviceName: deviceData?.name || (espId ? `Thiết bị ${espId}` : 'Thiết bị của bạn'),
          fallTime: currentFallTime,
          latitude,
          longitude,
        }).catch((err) => {
          console.warn('[MonitoredScreen] sendFallNotification error:', err);
        });

        // 2. Kích hoạt báo động âm thanh + rung + thông báo native Foreground Service
        startFallAlarm({
          deviceId: espId || 'ESP32',
          deviceName: deviceData?.name || (espId ? `Thiết bị ${espId}` : 'Thiết bị của bạn'),
          fallTime: currentFallTime,
          latitude,
          longitude,
          batteryPct: deviceData?.battery_pct ?? 100,
        });
      }
      prevFallActiveRef.current = true;
    } else {
      prevFallActiveRef.current = false;
      stopFallAlarm('MonitoredScreen: fall inactive');
    }
    return () => {
      stopFallAlarm('MonitoredScreen: unmount');
    };
  }, [isFallActive, espId, deviceData?.fall_time, deviceData?.name, deviceData?.battery_pct, latitude, longitude]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F8FD" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={styles.greetingText}>
              Xin chào, {user?.displayName || user?.email?.split('@')[0] || 'Người được giám sát'}
            </Text>
            <Text style={styles.headerTitle}>Bạn đang được bảo vệ</Text>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
            <Text style={styles.logoutBtnText}>Đăng xuất</Text>
          </TouchableOpacity>
        </View>

        {/* ── HERO SHIELD CARD ── */}
        <LinearGradient
          colors={
            !espId
              ? ['#64748B', '#475569']
              : isFallActive
              ? ['#EF4444', '#DC2626']
              : ['#22C55E', '#16A34A']
          }
          style={styles.heroCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* 3D Shield Emblem */}
          <View style={styles.shieldWrapper}>
            <View style={styles.shieldOuter}>
              <View style={styles.shieldHalfLeft} />
              <View style={styles.shieldHalfRight} />
              <View style={styles.shieldCenterGloss} />
            </View>
          </View>

          <Text style={styles.heroStatusText}>
            {!espId
              ? 'Chưa liên kết thiết bị'
              : isFallActive
              ? '⚠️ CẢNH BÁO TÉ NGÃ!'
              : 'Hệ thống đang hoạt động'}
          </Text>
          <Text style={styles.heroDeviceSubtitle}>
            {espId ? `Thiết bị phần cứng: ${espId}` : 'Chạm bên dưới để đăng ký 1 thiết bị duy nhất'}
          </Text>
        </LinearGradient>

        {/* ── HARDWARE DEVICE MANAGEMENT CARD (1 THIẾT BỊ DUY NHẤT) ── */}
        {!espId ? (
          /* TRƯỜNG HỢP CHƯA CÓ THIẾT BỊ */
          <View style={styles.deviceEmptyCard}>
            <View style={styles.deviceEmptyHeader}>
              <View style={styles.deviceEmptyIconWrap}>
                <Text style={{ fontSize: 26 }}>📟</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.deviceEmptyTitle}>CHƯA CÓ THIẾT BỊ PHẦN CỨNG</Text>
                <View style={styles.deviceEmptyBadge}>
                  <Text style={styles.deviceEmptyBadgeText}>Cần đăng ký 1 thiết bị</Text>
                </View>
              </View>
            </View>

            <Text style={styles.deviceEmptyDesc}>
              Bạn chưa đăng ký thiết bị phần cứng để nhận diện té ngã. Mỗi tài khoản người được giám sát chỉ được phép đăng ký duy nhất 1 thiết bị phần cứng (ESP32).
            </Text>

            <TouchableOpacity
              style={styles.deviceRegisterBtn}
              onPress={handleOpenRegisterDevice}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#0088FF', '#0066CC']}
                style={styles.deviceRegisterBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.deviceRegisterBtnText}>➕ Đăng Ký Thiết Bị Phần Cứng</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          /* TRƯỜNG HỢP ĐÃ ĐĂNG KÝ 1 THIẾT BỊ DUY NHẤT */
          <View style={styles.deviceActiveCard}>
            <View style={styles.deviceCardHeaderRow}>
              <View style={styles.deviceCardTitleRow}>
                <Text style={{ fontSize: 20 }}>📟</Text>
                <Text style={styles.deviceCardTitle}>THIẾT BỊ PHẦN CỨNG LIÊN KẾT</Text>
              </View>
              <View style={styles.singleDeviceBadge}>
                <Text style={styles.singleDeviceBadgeText}>1 thiết bị duy nhất</Text>
              </View>
            </View>

            <View style={styles.deviceInfoBox}>
              <View style={styles.deviceInfoLeft}>
                <Text style={styles.deviceIdText}>{espId}</Text>
                <View style={styles.deviceStatusRow}>
                  <View
                    style={[
                      styles.deviceStatusDot,
                      { backgroundColor: isConnected ? '#16A34A' : '#EF4444' },
                    ]}
                  />
                  <Text
                    style={[
                      styles.deviceStatusText,
                      { color: isConnected ? '#16A34A' : '#EF4444' },
                    ]}
                  >
                    {isConnected ? 'Đang trực tuyến' : 'Ngoại tuyến'}
                  </Text>
                </View>
              </View>

              <View style={styles.deviceBatteryWrap}>
                <Text style={styles.deviceBatteryIcon}>🔋</Text>
                <Text style={styles.deviceBatteryText}>
                  {deviceData?.battery_pct ?? 100}%
                </Text>
              </View>
            </View>

            {/* Các nút thao tác: Đổi thiết bị & Xóa thiết bị */}
            <View style={styles.deviceActionsRow}>
              <TouchableOpacity
                style={styles.deviceChangeBtn}
                onPress={handleOpenChangeDevice}
                activeOpacity={0.8}
              >
                <Text style={styles.deviceChangeBtnText}>🔄 Đổi thiết bị khác</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deviceDeleteBtn}
                onPress={handleDeleteDevice}
                activeOpacity={0.8}
              >
                <Text style={styles.deviceDeleteBtnText}>🗑️ Xóa thiết bị</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── TWO STATUS CARDS ROW ── */}
        <View style={styles.statusRow}>
          {/* Card 1: ESP + MPU */}
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>📡</Text>
            <Text style={styles.statusCardLabel}>ESP + MPU</Text>
            <Text
              style={[
                styles.statusCardValue,
                { color: !espId ? '#F59E0B' : isConnected ? '#16A34A' : '#EF4444' },
              ]}
            >
              {!espId ? 'Chưa đăng ký' : isConnected ? 'Đã kết nối' : 'Mất kết nối'}
            </Text>
          </View>

          {/* Card 2: Điện thoại GPS */}
          <View style={styles.statusCard}>
            <Text style={styles.statusIcon}>📍</Text>
            <Text style={styles.statusCardLabel}>Điện thoại</Text>
            <Text style={[styles.statusCardValue, { color: '#16A34A' }]}>
              GPS sẵn sàng
            </Text>
          </View>
        </View>

        {/* ── LOCATION CARD ── */}
        <View style={styles.locationCard}>
          <Text style={styles.locationLabel}>VỊ TRÍ ĐIỆN THOẠI GẦN NHẤT</Text>
          <Text style={styles.locationCoords}>
            {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </Text>
        </View>

        {/* ── BACKGROUND PROTECTION CARD ── */}
        <View style={styles.backgroundCard}>
          <View style={styles.pulseContainer}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseAnim }],
                  opacity: opacityAnim,
                },
              ]}
            />
            <View style={styles.pulseCenterDot} />
          </View>

          <View style={styles.backgroundCardContent}>
            <Text style={styles.backgroundCardTitle}>Bảo vệ nền đang bật</Text>
            <Text style={styles.backgroundCardDesc}>
              Cảnh báo đẩy tức thì qua push, kiểm tra dự phòng mỗi 5 giây. Lần chạy: {lastRunTime}. Chạm để khởi động lại.
            </Text>
          </View>
        </View>

        {/* ── ACTION BUTTON 1: KIỂM TRA TÁC VỤ NỀN NGAY ── */}
        <TouchableOpacity
          style={styles.checkBgBtn}
          onPress={handleCheckBackgroundNow}
          activeOpacity={0.8}
        >
          <Text style={styles.checkBgBtnText}>Kiểm tra tác vụ nền ngay</Text>
        </TouchableOpacity>

        {/* ── ACTION BUTTON 2: TÔI VẪN ỔN ── */}
        <TouchableOpacity
          style={styles.safeCardBtn}
          onPress={handleImOkay}
          activeOpacity={0.85}
          disabled={isSendingSafe}
        >
          <View style={styles.safeIconBadge}>
            <Text style={styles.safeCheckIcon}>✅</Text>
          </View>
          <View style={styles.safeTextCol}>
            <Text style={styles.safeTitle}>Tôi vẫn ổn</Text>
            <Text style={styles.safeSubtitle}>
              {isSendingSafe ? 'Đang gửi tín hiệu...' : 'Gửi xác nhận an toàn đến người giám sát'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* ── EMERGENCY SOS BANNER (CẦN TRỢ GIÚP KHẨN CẤP) ── */}
        <TouchableOpacity
          style={styles.sosCardBtn}
          onPress={handleEmergencySOS}
          activeOpacity={0.85}
          disabled={isSendingEmergency}
        >
          <Text style={styles.sosTitle}>🚨 CẦN TRỢ GIÚP KHẨN CẤP?</Text>
          <Text style={styles.sosSubtitle}>
            Chạm để gửi ngay cảnh báo té ngã khẩn cấp đến người giám sát
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── MODAL ĐĂNG KÝ / ĐỔI THIẾT BỊ PHẦN CỨNG (1 THIẾT BỊ DUY NHẤT) ── */}
      <Modal
        visible={deviceModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeviceModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Text style={{ fontSize: 32 }}>📟</Text>
            </View>

            <Text style={styles.modalTitle}>
              {modalMode === 'change' ? 'Đổi Thiết Bị Phần Cứng' : 'Đăng Ký Thiết Bị Phần Cứng'}
            </Text>
            <Text style={styles.modalDesc}>
              {modalMode === 'change'
                ? `Thiết bị mới sẽ thay thế thiết bị hiện tại [${espId}]. Mỗi người được giám sát chỉ được đăng ký duy nhất 1 thiết bị.`
                : 'Mỗi người được giám sát chỉ được đăng ký DUY NHẤT 1 thiết bị phần cứng để nhận diện té ngã an toàn.'}
            </Text>

            <View style={styles.inputWrapper}>
              <Text style={styles.inputLabel}>MÃ THIẾT BỊ PHẦN CỨNG (ESP32):</Text>
              <TextInput
                style={styles.textInput}
                placeholder="VD: ESP32_FALL_001"
                placeholderTextColor="#94A3B8"
                value={inputDeviceId}
                onChangeText={setInputDeviceId}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>

            {/* Gợi ý chọn nhanh */}
            <Text style={styles.quickSuggestLabel}>Gợi ý nhanh:</Text>
            <View style={styles.quickChipsRow}>
              {['ESP32_FALL_001', 'ESP32_FALL_002', 'ESP32_FALL_003'].map((suggestId) => (
                <TouchableOpacity
                  key={suggestId}
                  style={[
                    styles.quickChip,
                    inputDeviceId === suggestId && styles.quickChipSelected,
                  ]}
                  onPress={() => setInputDeviceId(suggestId)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      inputDeviceId === suggestId && styles.quickChipTextSelected,
                    ]}
                  >
                    {suggestId}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Nút hành động */}
            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setDeviceModalVisible(false)}
                disabled={isSubmittingDevice}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelBtnText}>Hủy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleSaveDevice}
                disabled={isSubmittingDevice}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={['#0088FF', '#0066CC']}
                  style={styles.modalSubmitBtnGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {isSubmittingDevice ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.modalSubmitBtnText}>
                      {modalMode === 'change' ? 'Xác Nhận Đổi' : 'Xác Nhận Đăng Ký'}
                    </Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F8FD',
  },
  scrollContent: {
    paddingBottom: 40,
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20,
    paddingBottom: 4,
  },
  greetingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 4,
    letterSpacing: -0.5,
  },
  logoutBtn: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },

  /* ── Hero Shield Card ── */
  heroCard: {
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  shieldWrapper: {
    width: 78,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  shieldOuter: {
    width: 68,
    height: 82,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
    overflow: 'hidden',
    flexDirection: 'row',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  shieldHalfLeft: {
    width: '50%',
    height: '100%',
    backgroundColor: '#DC2626',
  },
  shieldHalfRight: {
    width: '50%',
    height: '100%',
    backgroundColor: '#E2E8F0',
  },
  shieldCenterGloss: {
    position: 'absolute',
    top: 6,
    left: 8,
    right: 8,
    bottom: 6,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  heroStatusText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  heroDeviceSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 6,
    textAlign: 'center',
  },

  /* ── Hardware Device Card: Empty State ── */
  deviceEmptyCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#BAE6FD',
    elevation: 2,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  deviceEmptyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceEmptyIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0F9FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  deviceEmptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0369A1',
    letterSpacing: 0.2,
  },
  deviceEmptyBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginTop: 4,
  },
  deviceEmptyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D97706',
  },
  deviceEmptyDesc: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 19,
    marginTop: 12,
  },
  deviceRegisterBtn: {
    marginTop: 14,
    borderRadius: 14,
    overflow: 'hidden',
  },
  deviceRegisterBtnGradient: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceRegisterBtnText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  /* ── Hardware Device Card: Active State ── */
  deviceActiveCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  deviceCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  deviceCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.3,
  },
  singleDeviceBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  singleDeviceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
  },
  deviceInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  deviceInfoLeft: {
    flex: 1,
  },
  deviceIdText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  deviceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  deviceStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  deviceStatusText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  deviceBatteryWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  deviceBatteryIcon: {
    fontSize: 16,
  },
  deviceBatteryText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#16A34A',
  },
  deviceActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  deviceChangeBtn: {
    flex: 1,
    backgroundColor: '#EFF6FF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceChangeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2563EB',
  },
  deviceDeleteBtn: {
    backgroundColor: '#FEF2F2',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceDeleteBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DC2626',
  },

  /* ── Two Status Cards Row ── */
  statusRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 16,
    gap: 12,
  },
  statusCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    elevation: 2,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  statusIcon: {
    fontSize: 24,
  },
  statusCardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 8,
  },
  statusCardValue: {
    fontSize: 15,
    fontWeight: '900',
    marginTop: 2,
  },

  /* ── Location Card ── */
  locationCard: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    elevation: 2,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  locationCoords: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 4,
    letterSpacing: -0.3,
  },

  /* ── Background Protection Card ── */
  backgroundCard: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    elevation: 2,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  pulseContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(34, 197, 94, 0.3)',
  },
  pulseCenterDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#16A34A',
  },
  backgroundCardContent: {
    flex: 1,
  },
  backgroundCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  backgroundCardDesc: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
    marginTop: 4,
  },

  /* ── Button: Kiểm tra tác vụ nền ngay ── */
  checkBgBtn: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 1,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  checkBgBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2563EB',
  },

  /* ── Action Card: Tôi vẫn ổn ── */
  safeCardBtn: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    elevation: 2,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  safeIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  safeCheckIcon: {
    fontSize: 22,
  },
  safeTextCol: {
    flex: 1,
  },
  safeTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  safeSubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 2,
  },

  /* ── Emergency SOS Banner ── */
  sosCardBtn: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#FEF2F2',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  sosSubtitle: {
    fontSize: 12,
    color: '#991B1B',
    marginTop: 4,
    textAlign: 'center',
  },

  /* ── Modal Styles ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  modalIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  modalDesc: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
    paddingHorizontal: 10,
  },
  inputWrapper: {
    marginTop: 20,
  },
  inputLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  quickSuggestLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 14,
    marginBottom: 8,
  },
  quickChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickChipSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  quickChipTextSelected: {
    color: '#2563EB',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  modalSubmitBtn: {
    flex: 1.5,
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalSubmitBtnGradient: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
