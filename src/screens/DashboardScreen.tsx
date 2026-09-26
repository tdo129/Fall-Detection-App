// src/screens/DashboardScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useDevice } from '../context/DeviceContext';
import { useAuth } from '../context/AuthContext';
import PulseAnimation from '../components/PulseAnimation';
import BatteryIndicator from '../components/BatteryIndicator';
import MetricCard from '../components/MetricCard';
import AddDeviceModal from '../components/AddDeviceModal';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../constants/theme';

const { width } = Dimensions.get('window');

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Chào buổi sáng';
  if (h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

function formatTime(isoString?: string) {
  if (!isoString) return '--:--:--';
  try {
    return new Date(isoString).toLocaleTimeString('vi-VN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatDate(isoString?: string) {
  if (!isoString) return '--/--/----';
  try {
    return new Date(isoString).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function DashboardScreen() {
  const {
    deviceData,
    devicesData,
    pairedDevices,
    activeDeviceId,
    activeDevice,
    activeFallAlert,
    setActiveDeviceId,
    isConnected,
    acknowledgefall,
    triggerEmergency,
    cancelEmergency,
  } = useDevice();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const [showAddModal, setShowAddModal] = useState(false);
  const isFall = deviceData?.fall_detected ?? false;
  const isEmergency = deviceData?.emergency_mode ?? false;
  const battery = deviceData?.battery_pct ?? 0;

  // Emergency button pulse
  const emergencyScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(emergencyScale, { toValue: 1.04, duration: 700, useNativeDriver: true }),
        Animated.timing(emergencyScale, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const statusColor = isFall ? COLORS.danger : COLORS.success;
  const statusLabel = isFall ? 'PHÁT HIỆN TÉ NGÃ' : 'Đang hoạt động bình thường';
  const statusIcon = isFall ? '🚨' : '🛡️';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Background gradient */}
      <LinearGradient
        colors={['#F4F8FD', '#EEF4FA', '#F4F8FD']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Decorative blobs */}
      <View style={[styles.blob, styles.blob1]} />
      <View style={[styles.blob, styles.blob2]} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── HEADER ─────────────────────────────── */}
        <View style={styles.header}>
          <View style={{ flex: 1, marginRight: SPACING.md }}>
            <Text style={styles.greeting} numberOfLines={1}>
              {getTimeGreeting()}{user?.displayName ? `, ${user.displayName}` : ''}
            </Text>
            <Text style={styles.title}>CareDrop</Text>
          </View>
          <View style={styles.headerRight}>
            {user && (
              <View style={styles.userAvatarWrap}>
                <Text style={styles.userAvatarText}>
                  {(user.displayName || user.email || 'G')[0].toUpperCase()}
                </Text>
              </View>
            )}
            {/* Connection status */}
            <View
              style={[
                styles.connDot,
                {
                  backgroundColor:
                    pairedDevices.length === 0
                      ? COLORS.textTertiary
                      : isConnected
                      ? COLORS.success
                      : COLORS.danger,
                },
              ]}
            />
            {pairedDevices.length > 0 && (
              <BatteryIndicator percent={battery} size="md" />
            )}
          </View>
        </View>

        {/* ── MULTI-DEVICE SELECTOR BAR ─────────────── */}
        <View style={styles.deviceBarContainer}>
          {pairedDevices.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyDeviceChipBar}
              onPress={() => setShowAddModal(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.emptyDeviceChipIcon}>📟</Text>
              <Text style={styles.emptyDeviceChipText} numberOfLines={1}>
                Chưa ghép nối phần cứng — Nhấn để thêm thiết bị
              </Text>
              <Text style={styles.emptyDeviceChipPlus}>➕ Thêm</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.deviceBarScroll}
            >
              {pairedDevices.map((dev) => {
                const isSelected = dev.id === activeDeviceId;
                const devData = devicesData[dev.id];
                const isDevFall = devData?.fall_detected === true;

                return (
                  <TouchableOpacity
                    key={dev.id}
                    style={[
                      styles.devChipItem,
                      isSelected && styles.devChipItemSelected,
                      isDevFall && styles.devChipItemFall,
                    ]}
                    onPress={() => setActiveDeviceId(dev.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.devChipIcon}>
                      {isDevFall ? '🚨' : isSelected ? '📟' : '▫️'}
                    </Text>
                    <Text
                      style={[
                        styles.devChipText,
                        isSelected && styles.devChipTextSelected,
                        isDevFall && styles.devChipTextFall,
                      ]}
                      numberOfLines={1}
                    >
                      {dev.name}
                    </Text>
                    {isDevFall && <View style={styles.fallDotSmall} />}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={styles.addDevChip}
                onPress={() => setShowAddModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.addDevChipText}>➕ Thêm</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>

        {/* ── HERO STATUS CARD / EMPTY STATE ──────────────────── */}
        {pairedDevices.length === 0 ? (
          <View style={[styles.heroCardEmpty, SHADOW.md]}>
            <LinearGradient
              colors={['rgba(0,136,255,0.06)', 'rgba(0,136,255,0.01)']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />

            <View style={styles.heroEmptyIconWrap}>
              <Text style={{ fontSize: 36 }}>📟</Text>
            </View>

            <Text style={styles.heroEmptyTitle}>CHƯA CÓ THIẾT BỊ GIÁM SÁT</Text>
            <Text style={styles.heroEmptySub}>
              Tài khoản {user?.email} chưa liên kết với thiết bị phần cứng nào. Vui lòng thêm mã thiết bị (như ESP32) để bắt đầu nhận cảnh báo té ngã.
            </Text>

            <TouchableOpacity
              style={styles.heroEmptyBtn}
              onPress={() => setShowAddModal(true)}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#0088FF', '#0066CC']}
                style={styles.heroEmptyBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.heroEmptyBtnText}>➕ Thêm Thiết Bị Phần Cứng</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.heroCard, SHADOW.md, { borderColor: `${statusColor}40` }]}>
            <LinearGradient
              colors={isFall
                ? ['rgba(239,68,68,0.08)', 'rgba(239,68,68,0.02)']
                : ['rgba(22,163,74,0.08)', 'rgba(22,163,74,0.02)']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />

            {/* Device info row */}
            <View style={styles.heroTopRow}>
              <View style={styles.deviceChip}>
                <View style={[styles.deviceDot, { backgroundColor: isConnected ? COLORS.success : COLORS.textTertiary }]} />
                <Text style={styles.deviceId}>
                  {activeFallAlert
                    ? `${activeFallAlert.deviceName} (${activeFallAlert.deviceId})`
                    : activeDevice
                    ? `${activeDevice.name} (${activeDevice.id})`
                    : deviceData?.device_id ?? 'Chưa kết nối'}
                </Text>
              </View>
              <Text style={styles.heroTime}>{formatTime(deviceData?.last_updated)}</Text>
            </View>

            {/* Pulse + status */}
            <View style={styles.heroCenter}>
              <PulseAnimation
                color={statusColor}
                size={100}
                active={true}
              >
                <Text style={{ fontSize: 40 }}>{statusIcon}</Text>
              </PulseAnimation>

              <Text style={[styles.statusLabel, { color: statusColor }]}>
                {statusLabel}
              </Text>
              <Text style={styles.statusDate}>
                {isFall
                  ? `Lúc ${formatTime(deviceData?.fall_time)} — ${formatDate(deviceData?.fall_time)}`
                  : 'Không có sự cố nào được ghi nhận'}
              </Text>

              {isFall && (
                <TouchableOpacity
                  style={styles.heroAckBtn}
                  onPress={() => {
                    acknowledgefall(deviceData?.device_id || activeDeviceId);
                  }}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={['#FF9F0A', '#E07A00']}
                    style={styles.heroAckBtnGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <Text style={styles.heroAckBtnText}>✓  Đã kiểm tra — Tắt cảnh báo</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ── METRIC CARDS GRID ─────────────────── */}
        <View style={styles.gridRow}>
          <MetricCard
            icon="🔋"
            label="Pin thiết bị"
            value={pairedDevices.length === 0 ? '--' : `${battery}%`}
            subValue={
              pairedDevices.length === 0
                ? 'Chưa ghép nối'
                : battery < 20
                ? 'Sắp hết pin!'
                : battery < 50
                ? 'Pin trung bình'
                : 'Pin tốt'
            }
            accentColor={
              pairedDevices.length === 0
                ? COLORS.textTertiary
                : battery < 20
                ? COLORS.danger
                : battery < 50
                ? COLORS.warning
                : COLORS.success
            }
            style={{ flex: 1 }}
          />
          <MetricCard
            icon={pairedDevices.length === 0 ? '▫️' : isConnected ? '📡' : '⚠️'}
            label="Kết nối"
            value={pairedDevices.length === 0 ? 'Chưa ghép nối' : isConnected ? 'Online' : 'Offline'}
            subValue={pairedDevices.length === 0 ? 'Thêm để kết nối' : 'Firebase'}
            accentColor={
              pairedDevices.length === 0
                ? COLORS.textTertiary
                : isConnected
                ? COLORS.primary
                : COLORS.danger
            }
            style={{ flex: 1 }}
          />
        </View>

        {/* ── GPS CARD ──────────────────────────── */}
        <MetricCard
          icon="📍"
          label="Vị trí GPS gần nhất"
          value={
            pairedDevices.length === 0
              ? 'Chưa có thiết bị'
              : deviceData?.latitude
              ? `${deviceData.latitude.toFixed(6)}°N`
              : 'Đang cập nhật...'
          }
          subValue={
            pairedDevices.length === 0
              ? 'Nhấn để thêm thiết bị'
              : deviceData?.longitude
              ? `${deviceData.longitude.toFixed(6)}°E`
              : undefined
          }
          accentColor={COLORS.info}
          onPress={() => {
            if (pairedDevices.length === 0) {
              setShowAddModal(true);
            } else {
              navigation.navigate('Bản đồ');
            }
          }}
          style={styles.fullCard}
        />

        {/* ── LAST FALL CARD ────────────────────── */}
        <MetricCard
          icon="🕒"
          label="Sự cố gần nhất"
          value={
            pairedDevices.length === 0
              ? 'Chưa có thiết bị'
              : deviceData?.fall_time
              ? formatTime(deviceData.fall_time)
              : 'Chưa có sự cố'
          }
          subValue={
            pairedDevices.length === 0
              ? undefined
              : deviceData?.fall_time
              ? formatDate(deviceData.fall_time)
              : undefined
          }
          accentColor={COLORS.warning}
          onPress={() => navigation.navigate('Lịch sử')}
          style={styles.fullCard}
        />

        {/* ── EMERGENCY BUTTON ──────────────────── */}
        <View style={styles.sosSection}>
          <Text style={styles.sosSectionLabel}>CHỨC NĂNG KHẨN CẤP</Text>

          <Animated.View style={{ transform: [{ scale: emergencyScale }] }}>
            <TouchableOpacity
              style={[styles.sosBtn, isEmergency && styles.sosBtnActive, SHADOW.danger]}
              onPress={() => {
                if (pairedDevices.length === 0) {
                  Alert.alert(
                    'Chưa có thiết bị',
                    'Vui lòng thêm thiết bị phần cứng trước khi sử dụng chức năng khẩn cấp SOS.',
                    [
                      { text: 'Thêm ngay', onPress: () => setShowAddModal(true) },
                      { text: 'Đóng', style: 'cancel' },
                    ]
                  );
                  return;
                }
                if (isEmergency) {
                  cancelEmergency();
                } else {
                  triggerEmergency();
                }
              }}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={isEmergency ? ['#FF453A', '#CC1F16'] : ['#FF6B6B', '#FF453A']}
                style={styles.sosBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.sosBtnIcon}>{isEmergency ? '🔴' : '🆘'}</Text>
                <Text style={styles.sosBtnText}>
                  {isEmergency ? 'HỦY CHẾ ĐỘ KHẨN CẤP' : 'KÍCH HOẠT KHẨN CẤP'}
                </Text>
                <Text style={styles.sosBtnSub}>
                  {isEmergency ? 'Đang gửi GPS liên tục' : 'Yêu cầu GPS liên tục từ ESP32'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </View>

        <View style={{ height: SPACING.xxxl }} />
      </ScrollView>

      {/* Modal Thêm Thiết Bị Phần Cứng */}
      <AddDeviceModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: SPACING.xl, paddingTop: 56 },

  // Decorative blobs
  blob: { position: 'absolute', borderRadius: 9999 },
  blob1: {
    width: 300, height: 300,
    backgroundColor: 'rgba(0,136,255,0.05)',
    top: -100, right: -80,
  },
  blob2: {
    width: 200, height: 200,
    backgroundColor: 'rgba(22,163,74,0.04)',
    bottom: 200, left: -60,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  greeting: {
    fontSize: FONT.sm,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 2,
  },
  title: {
    fontSize: FONT.xxl,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  userAvatarWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.sm,
  },
  userAvatarText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  connDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  // Hero Card
  heroCard: {
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    marginBottom: SPACING.lg,
    padding: SPACING.xl,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  deviceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  deviceDot: { width: 8, height: 8, borderRadius: 4 },
  deviceId: { fontSize: FONT.xs, color: '#475569', fontWeight: '600', letterSpacing: 0.5 },
  heroTime: { fontSize: FONT.sm, color: '#64748B', fontWeight: '500' },
  heroCenter: { alignItems: 'center', paddingVertical: SPACING.md },
  statusLabel: {
    fontSize: FONT.lg,
    fontWeight: '800',
    marginTop: SPACING.lg,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  statusDate: {
    fontSize: FONT.sm,
    color: '#64748B',
    marginTop: 6,
    textAlign: 'center',
  },
  heroAckBtn: {
    marginTop: SPACING.md,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    shadowColor: '#E07A00',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  heroAckBtnGradient: {
    paddingVertical: 10,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAckBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: FONT.sm,
    letterSpacing: 0.3,
  },

  // Grid
  gridRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  fullCard: { marginBottom: SPACING.md },

  // SOS
  sosSection: { marginTop: SPACING.sm },
  sosSectionLabel: {
    fontSize: FONT.xs,
    color: '#64748B',
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  sosBtn: {
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.4)',
  },
  sosBtnActive: { borderColor: '#EF4444' },
  sosBtnGradient: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  sosBtnIcon: { fontSize: 32, marginBottom: 4 },
  sosBtnText: {
    fontSize: FONT.lg,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  sosBtnSub: {
    fontSize: FONT.sm,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },

  // Multi-Device Selector Bar
  deviceBarContainer: {
    marginBottom: SPACING.lg,
    marginHorizontal: -SPACING.xl,
  },
  deviceBarScroll: {
    paddingHorizontal: SPACING.xl,
    gap: 8,
    alignItems: 'center',
  },
  devChipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  devChipItemSelected: {
    backgroundColor: 'rgba(0,136,255,0.10)',
    borderColor: '#0088FF',
  },
  devChipItemFall: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: COLORS.danger,
  },
  devChipIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  devChipText: {
    fontSize: FONT.xs,
    color: '#475569',
    fontWeight: '600',
    maxWidth: 140,
  },
  devChipTextSelected: {
    color: '#0088FF',
    fontWeight: '700',
  },
  devChipTextFall: {
    color: COLORS.danger,
    fontWeight: '800',
  },
  fallDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.danger,
    marginLeft: 6,
  },
  addDevChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.full,
  },
  addDevChipText: {
    fontSize: FONT.xs,
    color: '#64748B',
    fontWeight: '600',
  },

  // Empty State Device Bar
  emptyDeviceChipBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.lg,
    marginHorizontal: SPACING.xl,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  emptyDeviceChipIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  emptyDeviceChipText: {
    flex: 1,
    fontSize: FONT.xs,
    color: '#64748B',
    fontWeight: '600',
  },
  emptyDeviceChipPlus: {
    fontSize: FONT.xs,
    color: '#0088FF',
    fontWeight: '700',
    marginLeft: 8,
  },

  // Empty State Hero Card
  heroCardEmpty: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.xxl,
    padding: SPACING.xl,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  heroEmptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(0,136,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,136,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    marginTop: SPACING.xs,
  },
  heroEmptyTitle: {
    fontSize: FONT.md,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.8,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  heroEmptySub: {
    fontSize: FONT.sm,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.xs,
  },
  heroEmptyBtn: {
    borderRadius: RADIUS.full,
    overflow: 'hidden',
    width: '100%',
    shadowColor: '#0088FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  heroEmptyBtnGradient: {
    paddingVertical: 14,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmptyBtnText: {
    fontSize: FONT.md,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});