// src/screens/DashboardScreen.tsx
import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useDevice } from '../context/DeviceContext';
import PulseAnimation from '../components/PulseAnimation';
import BatteryIndicator from '../components/BatteryIndicator';
import MetricCard from '../components/MetricCard';
import FallAlertModal from '../components/FallAlertModal';
import LeafletMap from '../components/LeafletMap';
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
  const { deviceData, isConnected, triggerEmergency, cancelEmergency } = useDevice();
  const navigation = useNavigation<any>();
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
      <FallAlertModal />

      {/* Background gradient */}
      <LinearGradient
        colors={['#F6F8FA', '#EEF2F6', '#F6F8FA']}
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
          <View>
            <Text style={styles.greeting}>{getTimeGreeting()}</Text>
            <Text style={styles.title}>HealthGuard</Text>
          </View>
          <View style={styles.headerRight}>
            {/* Connection status */}
            <View style={[styles.connDot, { backgroundColor: isConnected ? COLORS.success : COLORS.danger }]} />
            <BatteryIndicator percent={battery} size="md" />
          </View>
        </View>

        {/* ── HERO STATUS CARD ──────────────────── */}
        <View style={[styles.heroCard, SHADOW.lg, { borderColor: `${statusColor}30` }]}>
          <LinearGradient
            colors={isFall
              ? ['rgba(255,59,48,0.08)', 'rgba(255,59,48,0.02)']
              : ['rgba(40,167,69,0.08)', 'rgba(40,167,69,0.02)']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />

          {/* Device info row */}
          <View style={styles.heroTopRow}>
            <View style={styles.deviceChip}>
              <View style={[styles.deviceDot, { backgroundColor: isConnected ? COLORS.success : COLORS.textTertiary }]} />
              <Text style={styles.deviceId}>{deviceData?.device_id ?? 'ESP32_FALL_001'}</Text>
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
          </View>
        </View>

        {/* ── METRIC CARDS GRID ─────────────────── */}
        <View style={styles.gridRow}>
          <MetricCard
            icon="🔋"
            label="Pin thiết bị"
            value={`${battery}%`}
            subValue={battery < 20 ? 'Sắp hết pin!' : battery < 50 ? 'Pin trung bình' : 'Pin tốt'}
            accentColor={battery < 20 ? COLORS.danger : battery < 50 ? COLORS.warning : COLORS.success}
            style={{ flex: 1 }}
          />
          <MetricCard
            icon={isConnected ? '📡' : '⚠️'}
            label="Kết nối"
            value={isConnected ? 'Online' : 'Offline'}
            subValue="Firebase"
            accentColor={isConnected ? COLORS.primary : COLORS.danger}
            style={{ flex: 1 }}
          />
        </View>

        {/* ── GPS MINI MAP CARD ─────────────────── */}
        <TouchableOpacity
          style={[styles.gpsMapCard, SHADOW.md]}
          onPress={() => navigation.navigate('Bản đồ')}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={['#FFFFFF', '#F8FAFC']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.gpsMapHeader}>
            <View style={styles.gpsMapTitleWrap}>
              <View style={styles.gpsMapIconCircle}>
                <Text style={styles.gpsMapIcon}>📍</Text>
              </View>
              <View>
                <Text style={styles.gpsMapTitle}>VỊ TRÍ GPS THỜI GIAN THỰC</Text>
                <Text style={styles.gpsMapCoords}>
                  {deviceData?.latitude
                    ? `${deviceData.latitude.toFixed(6)}°N, ${deviceData.longitude?.toFixed(6) ?? '--'}°E`
                    : 'Đang cập nhật...'}
                </Text>
              </View>
            </View>
            <View style={styles.gpsMapBadge}>
              <Text style={styles.gpsMapBadgeText}>Toàn màn hình ↗</Text>
            </View>
          </View>

          {/* Mini Map View */}
          <View style={styles.gpsMapBox}>
            <LeafletMap
              latitude={deviceData?.latitude ?? 10.853868}
              longitude={deviceData?.longitude ?? 106.7}
              isFall={isFall}
              mapType="standard"
              zoom={15}
              interactive={false}
              style={StyleSheet.absoluteFill}
            />
            {/* Transparent overlay for smooth click forwarding */}
            <View style={styles.gpsMapTouchOverlay} />
          </View>
        </TouchableOpacity>

        {/* ── LAST FALL CARD ────────────────────── */}
        <MetricCard
          icon="🕒"
          label="Sự cố gần nhất"
          value={deviceData?.fall_time ? formatTime(deviceData.fall_time) : 'Chưa có sự cố'}
          subValue={deviceData?.fall_time ? formatDate(deviceData.fall_time) : undefined}
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
              onPress={isEmergency ? cancelEmergency : triggerEmergency}
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
                  {isEmergency ? 'HỦY CHẾ ĐỘ KHẨN CẤP' : 'KÍch HOẠT KHẨN CẤP'}
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
    backgroundColor: 'rgba(10,132,255,0.04)',
    top: -100, right: -80,
  },
  blob2: {
    width: 200, height: 200,
    backgroundColor: 'rgba(40,167,69,0.04)',
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
    color: COLORS.textTertiary,
    fontWeight: '500',
    marginBottom: 2,
  },
  title: {
    fontSize: FONT.xxl,
    fontWeight: '800',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
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
    overflow: 'hidden',
    backgroundColor: COLORS.bgSecondary,
    marginBottom: SPACING.lg,
    padding: SPACING.xl,
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
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  deviceDot: { width: 8, height: 8, borderRadius: 4 },
  deviceId: { fontSize: FONT.xs, color: COLORS.textSecondary, fontWeight: '600', letterSpacing: 0.5 },
  heroTime: { fontSize: FONT.sm, color: COLORS.textTertiary, fontWeight: '500' },
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
    color: COLORS.textTertiary,
    marginTop: 6,
    textAlign: 'center',
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
    color: COLORS.textTertiary,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  sosBtn: {
    borderRadius: RADIUS.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,69,58,0.4)',
  },
  sosBtnActive: { borderColor: '#FF453A' },
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
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },

  // GPS Mini Map Card
  gpsMapCard: {
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgSecondary,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  gpsMapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  gpsMapTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  gpsMapIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(10,132,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsMapIcon: { fontSize: 16 },
  gpsMapTitle: {
    fontSize: FONT.xs,
    fontWeight: '700',
    color: COLORS.textTertiary,
    letterSpacing: 0.8,
  },
  gpsMapCoords: {
    fontSize: FONT.sm,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 1,
  },
  gpsMapBadge: {
    backgroundColor: 'rgba(10,132,255,0.08)',
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(10,132,255,0.15)',
  },
  gpsMapBadgeText: {
    fontSize: FONT.xs,
    color: COLORS.primary,
    fontWeight: '700',
  },
  gpsMapBox: {
    height: 150,
    width: '100%',
    position: 'relative',
    borderBottomLeftRadius: RADIUS.xl,
    borderBottomRightRadius: RADIUS.xl,
    overflow: 'hidden',
  },
  gpsMapTouchOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
});