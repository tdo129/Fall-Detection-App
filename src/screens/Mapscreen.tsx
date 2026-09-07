// src/screens/MapScreen.tsx
import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { useDevice } from '../context/DeviceContext';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../constants/theme';
import LeafletMap, {
  LeafletMapRef,
  MapTileType,
  openNavigationApp,
  LocationCoord,
} from '../components/LeafletMap';
import { getRouteBetweenPoints, RouteResult } from '../services/routeService';

const { width } = Dimensions.get('window');
const BOTTOM_SHEET_HEIGHT = 235;

function formatCoord(n?: number, decimals = 6) {
  if (n === undefined || n === null) return '--';
  return n.toFixed(decimals);
}

function formatTime(iso?: string) {
  if (!iso) return '--';
  try {
    return new Date(iso).toLocaleTimeString('vi-VN');
  } catch {
    return iso;
  }
}

export default function MapScreen() {
  const { deviceData } = useDevice();
  const mapRef = useRef<LeafletMapRef>(null);
  const sheetAnim = useRef(new Animated.Value(1)).current;

  const [mapType, setMapType] = useState<MapTileType>('standard');
  const [sheetOpen, setSheetOpen] = useState(true);

  // Supervisor & Route Navigation states
  const [supervisorLoc, setSupervisorLoc] = useState<LocationCoord | null>(null);
  const [routeData, setRouteData] = useState<RouteResult | null>(null);
  const [isNavigating, setIsNavigating] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [isSimulatedLocation, setIsSimulatedLocation] = useState(false);
  const [locationStatusText, setLocationStatusText] = useState('Đang lấy GPS điện thoại của bạn...');

  // Target (Fallen person / ESP32) coordinates
  const lat = deviceData?.latitude ?? 10.853868;
  const lng = deviceData?.longitude ?? 106.7;
  const isFall = deviceData?.fall_detected ?? false;

  // Bottom sheet slide animation
  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue: sheetOpen ? 1 : 0,
      tension: 100,
      friction: 12,
      useNativeDriver: true,
    }).start();
  }, [sheetOpen]);

  const sheetTranslate = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BOTTOM_SHEET_HEIGHT + 40, 0],
  });

  /**
   * Automatically fetch supervisor phone's real GPS on mount
   * and calculate route to the fallen person
   */
  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;
    let isMounted = true;

    const autoLocateAndRoute = async () => {
      setLoadingRoute(true);
      setLocationStatusText('Đang kết nối GPS điện thoại người giám hộ...');

      let supLat: number = lat - 0.0105;
      let supLng: number = lng - 0.0082;

      try {
        // 1. Request permission from the supervisor's phone
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status === 'granted') {
          // Check last known position for instant responsiveness
          const lastLoc = await Location.getLastKnownPositionAsync({});
          if (lastLoc && isMounted) {
            supLat = lastLoc.coords.latitude;
            supLng = lastLoc.coords.longitude;
            setSupervisorLoc({ latitude: supLat, longitude: supLng });
            setIsSimulatedLocation(false);
            setLocationStatusText('Đã lấy vị trí GPS từ điện thoại');
          }

          // Fetch fresh, accurate position
          const curLoc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });

          if (isMounted) {
            supLat = curLoc.coords.latitude;
            supLng = curLoc.coords.longitude;
            setSupervisorLoc({ latitude: supLat, longitude: supLng });
            setIsSimulatedLocation(false);
            setLocationStatusText('Đã lấy vị trí GPS từ điện thoại');
          }

          // Watch position continuously as supervisor moves
          locationSubscription = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              distanceInterval: 10,
              timeInterval: 5000,
            },
            async (newLoc) => {
              if (!isMounted) return;
              const newPoint = {
                latitude: newLoc.coords.latitude,
                longitude: newLoc.coords.longitude,
              };
              setSupervisorLoc(newPoint);
            }
          );
        } else {
          // Permission not granted or running in Web/Emulator without GPS
          if (isMounted) {
            setIsSimulatedLocation(true);
            setLocationStatusText('GPS giả lập (Hãy cấp quyền vị trí trên điện thoại)');
            setSupervisorLoc({ latitude: supLat, longitude: supLng });
          }
        }
      } catch (err) {
        if (isMounted) {
          setIsSimulatedLocation(true);
          setLocationStatusText('Đang dùng vị trí mẫu (Không bật được GPS)');
          setSupervisorLoc({ latitude: supLat, longitude: supLng });
        }
      }

      // 2. Fetch driving route between supervisor and fallen person
      try {
        const route = await getRouteBetweenPoints(supLat, supLng, lat, lng);
        if (isMounted) {
          setRouteData(route);
          setIsNavigating(true);
        }
      } catch (err) {
        // Fallback handled inside routeService
      } finally {
        if (isMounted) {
          setLoadingRoute(false);
        }
      }
    };

    autoLocateAndRoute();

    return () => {
      isMounted = false;
      locationSubscription?.remove();
    };
  }, [lat, lng]);

  // Fit all bounds when route is ready
  useEffect(() => {
    if (routeData && isNavigating) {
      const timer = setTimeout(() => {
        mapRef.current?.fitAllBounds();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [routeData]);

  const centerOnDevice = () => {
    mapRef.current?.centerOnLocation(lat, lng);
  };

  const centerOnSupervisor = () => {
    mapRef.current?.centerOnSupervisor();
  };

  const centerOnAll = () => {
    mapRef.current?.fitAllBounds();
  };

  const handleOpenTurnByTurn = () => {
    openNavigationApp(
      lat,
      lng,
      supervisorLoc?.latitude,
      supervisorLoc?.longitude,
      isFall ? 'Khẩn cấp: Người thân té ngã' : 'Vị trí người thân'
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Leaflet OpenStreetMap View with Supervisor & Route */}
      <LeafletMap
        ref={mapRef}
        latitude={lat}
        longitude={lng}
        isFall={isFall}
        mapType={mapType}
        zoom={16}
        interactive={true}
        supervisorLocation={supervisorLoc}
        routeCoordinates={isNavigating && routeData ? routeData.coordinates : undefined}
        style={StyleSheet.absoluteFill}
      />

      {/* Top gradient overlay */}
      <LinearGradient
        colors={['rgba(246,248,250,0.95)', 'rgba(246,248,250,0.0)']}
        style={styles.topOverlay}
        pointerEvents="none"
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.titleWrap}>
          <Text style={styles.topTitle}>Bản đồ cứu hộ</Text>
          <Text style={styles.topSub}>
            {isFall ? '🚨 CẢNH BÁO TÉ NGÃ — ĐANG DẪN ĐƯỜNG' : '📡 Lộ trình cứu hộ thời gian thực'}
          </Text>
        </View>

        {/* Map Type Switcher */}
        <View style={styles.typeToggle}>
          <TouchableOpacity
            style={[styles.typeBtn, mapType === 'dark' && styles.typeBtnActive]}
            onPress={() => setMapType('dark')}
          >
            <Text style={[styles.typeBtnText, mapType === 'dark' && styles.typeBtnTextActive]}>Tối</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, mapType === 'standard' && styles.typeBtnActive]}
            onPress={() => setMapType('standard')}
          >
            <Text style={[styles.typeBtnText, mapType === 'standard' && styles.typeBtnTextActive]}>Đường</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, mapType === 'satellite' && styles.typeBtnActive]}
            onPress={() => setMapType('satellite')}
          >
            <Text style={[styles.typeBtnText, mapType === 'satellite' && styles.typeBtnTextActive]}>Vệ tinh</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Top Navigation Route Card (Always visible once route is calculated) */}
      <View style={[styles.routeFloatingCard, SHADOW.md]}>
        <LinearGradient
          colors={['#FFFFFF', '#F8FAFC']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        
        {loadingRoute ? (
          <View style={styles.routeLoadingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.routeLoadingText}>{locationStatusText}</Text>
          </View>
        ) : (
          <>
            <View style={styles.routeHeader}>
              <View style={styles.routeHeaderLeft}>
                <View style={styles.routeIconBox}>
                  <Text style={{ fontSize: 20 }}>🚗</Text>
                </View>
                <View>
                  <View style={styles.routeStatsRow}>
                    <Text style={styles.routeDistanceText}>
                      {routeData ? `${routeData.distanceKm} km` : '--'}
                    </Text>
                    <Text style={styles.routeDot}>•</Text>
                    <Text style={styles.routeDurationText}>
                      {routeData ? `~${routeData.durationMin} phút di chuyển` : '--'}
                    </Text>
                  </View>
                  <Text style={styles.routeSubtitle}>
                    {isSimulatedLocation
                      ? '⚠️ Vị trí mô phỏng (Điện thoại chưa cấp GPS)'
                      : 'Từ điện thoại của bạn 👤 đến người bị té 🚨'}
                  </Text>
                </View>
              </View>

              {/* Fit view button */}
              <TouchableOpacity
                style={styles.fitViewBtn}
                onPress={centerOnAll}
                activeOpacity={0.7}
                accessibilityLabel="Xem toàn cảnh"
              >
                <Text style={styles.fitViewText}>⛶ Toàn cảnh</Text>
              </TouchableOpacity>
            </View>

            {/* Turn-by-Turn Google Maps Navigation Action */}
            <TouchableOpacity
              style={styles.voiceNavBtn}
              onPress={handleOpenTurnByTurn}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#0A84FF', '#0056B3']}
                style={styles.voiceNavGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.voiceNavText}>🧭 Mở Google Maps chỉ đường bằng giọng nói</Text>
              </LinearGradient>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Quick Center Toggle Buttons on Right Side */}
      <View style={[styles.sideButtonsWrap, { bottom: sheetOpen ? BOTTOM_SHEET_HEIGHT + 14 : 95 }]}>
        {/* Fit both */}
        <TouchableOpacity
          style={[styles.sideIconBtn, SHADOW.md]}
          onPress={centerOnAll}
          activeOpacity={0.8}
        >
          <Text style={styles.sideIconText}>⛶</Text>
        </TouchableOpacity>

        {/* Center on supervisor */}
        <TouchableOpacity
          style={[styles.sideIconBtn, SHADOW.md, { borderColor: '#30D158' }]}
          onPress={centerOnSupervisor}
          activeOpacity={0.8}
        >
          <Text style={styles.sideIconText}>👤</Text>
        </TouchableOpacity>

        {/* Center on target */}
        <TouchableOpacity
          style={[styles.sideIconBtn, SHADOW.md, { borderColor: COLORS.danger }]}
          onPress={centerOnDevice}
          activeOpacity={0.8}
        >
          <Text style={styles.sideIconText}>🚨</Text>
        </TouchableOpacity>
      </View>

      {/* Sheet toggle */}
      <TouchableOpacity
        style={[styles.sheetToggle, SHADOW.md, { bottom: sheetOpen ? BOTTOM_SHEET_HEIGHT + 14 : 95 }]}
        onPress={() => setSheetOpen(!sheetOpen)}
        activeOpacity={0.8}
      >
        <Text style={styles.sheetToggleText}>{sheetOpen ? '▼' : '▲'}</Text>
      </TouchableOpacity>

      {/* Bottom info sheet */}
      <Animated.View style={[styles.bottomSheet, SHADOW.lg, { transform: [{ translateY: sheetTranslate }] }]}>
        <LinearGradient colors={['#FFFFFF', '#F8FAFC']} style={StyleSheet.absoluteFill} />
        <View style={styles.sheetHandle} />
        <View style={styles.sheetContent}>
          {/* Coordinates row */}
          <View style={styles.coordRow}>
            <View style={styles.coordItem}>
              <Text style={styles.coordLabel}>VĨ ĐỘ NGƯỜI NGÃ</Text>
              <Text style={styles.coordValue}>{formatCoord(deviceData?.latitude ?? lat)}°N</Text>
            </View>
            <View style={styles.coordDivider} />
            <View style={styles.coordItem}>
              <Text style={styles.coordLabel}>KINH ĐỘ NGƯỜI NGÃ</Text>
              <Text style={styles.coordValue}>{formatCoord(deviceData?.longitude ?? lng)}°E</Text>
            </View>
          </View>

          {/* Action row with Navigation Trigger */}
          <View style={styles.sheetFooter}>
            <View style={styles.sheetChip}>
              <View style={[styles.chipDot, { backgroundColor: isFall ? COLORS.danger : COLORS.success }]} />
              <Text style={styles.chipText} numberOfLines={1}>
                {isFall
                  ? `Sự cố: ${formatTime(deviceData?.fall_time)}`
                  : `Cập nhật: ${formatTime(deviceData?.last_updated)}`}
              </Text>
            </View>

            {/* Quick direct navigation button */}
            <TouchableOpacity
              style={[styles.navButton, SHADOW.sm]}
              onPress={handleOpenTurnByTurn}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={isFall ? ['#FF453A', '#CC1F16'] : [COLORS.primary, COLORS.primaryDark]}
                style={styles.navButtonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.navButtonText}>🗺️ Chỉ đường ngoài</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F8FA' },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 140, zIndex: 2 },
  topBar: {
    position: 'absolute',
    top: 50,
    left: SPACING.xl,
    right: SPACING.xl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 3,
  },
  titleWrap: { flex: 1, marginRight: SPACING.sm },
  topTitle: { fontSize: FONT.xl, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.3 },
  topSub: { fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2, fontWeight: '500' },
  typeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  typeBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  typeBtnActive: { backgroundColor: COLORS.primary },
  typeBtnText: { fontSize: FONT.xs, color: COLORS.textSecondary, fontWeight: '600' },
  typeBtnTextActive: { color: '#fff' },

  // Floating Route Info Card
  routeFloatingCard: {
    position: 'absolute',
    top: 105,
    left: SPACING.lg,
    right: SPACING.lg,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: 'rgba(10,132,255,0.25)',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    padding: SPACING.md,
    zIndex: 6,
  },
  routeLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  routeLoadingText: {
    fontSize: FONT.xs,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  routeHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  routeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(10,132,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  routeDistanceText: {
    fontSize: FONT.md,
    fontWeight: '900',
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  },
  routeDot: {
    color: COLORS.textTertiary,
    fontSize: FONT.sm,
  },
  routeDurationText: {
    fontSize: FONT.md,
    fontWeight: '900',
    color: COLORS.success,
    letterSpacing: -0.3,
  },
  routeSubtitle: {
    fontSize: FONT.xs,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  fitViewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  fitViewText: {
    color: COLORS.textPrimary,
    fontSize: FONT.xs,
    fontWeight: '700',
  },
  voiceNavBtn: {
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginTop: 4,
  },
  voiceNavGradient: {
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceNavText: {
    fontSize: FONT.xs,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },

  // Side buttons
  sideButtonsWrap: {
    position: 'absolute',
    right: SPACING.xl,
    gap: 10,
    zIndex: 5,
  },
  sideIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideIconText: { fontSize: 18, color: COLORS.textPrimary },

  sheetToggle: {
    position: 'absolute',
    left: SPACING.xl,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  sheetToggleText: { color: COLORS.textPrimary, fontSize: FONT.sm, fontWeight: '700' },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: BOTTOM_SHEET_HEIGHT,
    borderTopLeftRadius: RADIUS.xxl,
    borderTopRightRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    zIndex: 4,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginTop: 10,
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    paddingBottom: 85,
    justifyContent: 'flex-start',
  },
  coordRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  coordItem: { flex: 1, alignItems: 'center' },
  coordLabel: {
    fontSize: FONT.xs,
    color: COLORS.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  coordValue: { fontSize: FONT.md, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: -0.5 },
  coordDivider: { width: 1, height: 36, backgroundColor: COLORS.border, marginHorizontal: SPACING.sm },
  sheetFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    gap: SPACING.sm,
  },
  sheetChip: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: FONT.xs, color: COLORS.textSecondary },
  navButton: {
    borderRadius: RADIUS.full,
    overflow: 'hidden',
  },
  navButtonGradient: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    fontSize: FONT.xs,
    color: '#fff',
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
