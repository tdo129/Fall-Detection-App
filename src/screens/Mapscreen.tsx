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
} from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { useDevice } from '../context/DeviceContext';
import { COLORS, FONT, RADIUS, SHADOW, SPACING } from '../constants/theme';

const { width, height } = Dimensions.get('window');
const BOTTOM_SHEET_HEIGHT = 200;

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0D1117' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ab4f8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c4d' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#316da5' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1a2535' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
];

function formatCoord(n?: number, decimals = 6) {
  if (n === undefined || n === null) return '--';
  return n.toFixed(decimals);
}

function formatTime(iso?: string) {
  if (!iso) return '--';
  try { return new Date(iso).toLocaleTimeString('vi-VN'); }
  catch { return iso; }
}

export default function MapScreen() {
  const { deviceData, settings } = useDevice();
  const mapRef = useRef<MapView>(null);
  const markerBounce = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(1)).current;
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');
  const [sheetOpen, setSheetOpen] = useState(true);

  const lat = deviceData?.latitude ?? 10.853868;
  const lng = deviceData?.longitude ?? 106.7;
  const isFall = deviceData?.fall_detected ?? false;

  // Bounce marker on GPS update
  useEffect(() => {
    Animated.sequence([
      Animated.timing(markerBounce, { toValue: -12, duration: 200, useNativeDriver: true }),
      Animated.spring(markerBounce, { toValue: 0, tension: 200, friction: 5, useNativeDriver: true }),
    ]).start();
  }, [lat, lng]);

  // Bottom sheet slide animation
  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue: sheetOpen ? 1 : 0,
      tension: 100, friction: 12, useNativeDriver: true,
    }).start();
  }, [sheetOpen]);

  const sheetTranslate = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BOTTOM_SHEET_HEIGHT + 40, 0],
  });

  const centerOnDevice = () => {
    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    }, 800);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={mapType === 'standard' ? DARK_MAP_STYLE : []}
        mapType={mapType}
        initialRegion={{
          latitude: lat, longitude: lng,
          latitudeDelta: 0.008, longitudeDelta: 0.008,
        }}
        showsCompass={false}
      >
        <Circle
          center={{ latitude: lat, longitude: lng }}
          radius={50}
          fillColor={isFall ? 'rgba(255,69,58,0.12)' : 'rgba(10,132,255,0.10)'}
          strokeColor={isFall ? 'rgba(255,69,58,0.5)' : 'rgba(10,132,255,0.5)'}
          strokeWidth={1.5}
        />
        <Marker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 1 }}>
          <Animated.View style={{ transform: [{ translateY: markerBounce }] }}>
            <View style={[styles.markerOuter, { borderColor: isFall ? COLORS.danger : COLORS.primary }]}>
              <View style={[styles.markerInner, { backgroundColor: isFall ? COLORS.danger : COLORS.primary }]}>
                <Text style={styles.markerIcon}>{isFall ? '🚨' : '📍'}</Text>
              </View>
            </View>
            <View style={[styles.markerTail, { borderTopColor: isFall ? COLORS.danger : COLORS.primary }]} />
          </Animated.View>
        </Marker>
      </MapView>

      {/* Top gradient overlay */}
      <LinearGradient
        colors={['rgba(13,17,23,0.95)', 'rgba(13,17,23,0.0)']}
        style={styles.topOverlay}
        pointerEvents="none"
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.topTitle}>Bản đồ</Text>
          <Text style={styles.topSub}>
            {isFall ? '🚨 Vị trí té ngã' : '📡 Cập nhật theo thời gian thực'}
          </Text>
        </View>
        <View style={styles.typeToggle}>
          <TouchableOpacity
            style={[styles.typeBtn, mapType === 'standard' && styles.typeBtnActive]}
            onPress={() => setMapType('standard')}
          >
            <Text style={[styles.typeBtnText, mapType === 'standard' && styles.typeBtnTextActive]}>Bản đồ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, mapType === 'satellite' && styles.typeBtnActive]}
            onPress={() => setMapType('satellite')}
          >
            <Text style={[styles.typeBtnText, mapType === 'satellite' && styles.typeBtnTextActive]}>Vệ tinh</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Center button */}
      <TouchableOpacity style={[styles.centerBtn, SHADOW.primary]} onPress={centerOnDevice}>
        <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.centerBtnGradient}>
          <Text style={styles.centerBtnIcon}>⊕</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Sheet toggle */}
      <TouchableOpacity
        style={[styles.sheetToggle, SHADOW.md]}
        onPress={() => setSheetOpen(!sheetOpen)}
      >
        <Text style={styles.sheetToggleText}>{sheetOpen ? '▼' : '▲'}</Text>
      </TouchableOpacity>

      {/* Bottom info sheet */}
      <Animated.View style={[styles.bottomSheet, SHADOW.lg, { transform: [{ translateY: sheetTranslate }] }]}>
        <LinearGradient colors={['#161B22', '#0D1117']} style={StyleSheet.absoluteFill} />
        <View style={styles.sheetHandle} />
        <View style={styles.sheetContent}>
          <View style={styles.coordRow}>
            <View style={styles.coordItem}>
              <Text style={styles.coordLabel}>VĨ ĐỘ (LAT)</Text>
              <Text style={styles.coordValue}>{formatCoord(deviceData?.latitude)}°N</Text>
            </View>
            <View style={styles.coordDivider} />
            <View style={styles.coordItem}>
              <Text style={styles.coordLabel}>KINH ĐỘ (LNG)</Text>
              <Text style={styles.coordValue}>{formatCoord(deviceData?.longitude)}°E</Text>
            </View>
          </View>
          <View style={styles.sheetFooter}>
            <View style={styles.sheetChip}>
              <View style={[styles.chipDot, { backgroundColor: COLORS.success }]} />
              <Text style={styles.chipText}>
                Cập nhật lúc {formatTime(deviceData?.last_updated ?? deviceData?.fall_time)}
              </Text>
            </View>
            <View style={[styles.deviceChipSmall, { borderColor: isFall ? `${COLORS.danger}60` : `${COLORS.primary}60` }]}>
              <Text style={[styles.deviceChipText, { color: isFall ? COLORS.danger : COLORS.primary }]}>
                {isFall ? 'TÉ NGÃ' : 'BÌNH THƯỜNG'}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D1117' },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, height: 140 },
  topBar: {
    position: 'absolute', top: 48, left: SPACING.xl, right: SPACING.xl,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  topTitle: { fontSize: FONT.xl, fontWeight: '800', color: '#fff' },
  topSub: { fontSize: FONT.xs, color: COLORS.textSecondary, marginTop: 2 },
  typeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13,17,23,0.8)',
    borderRadius: RADIUS.full,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  typeBtn: { paddingHorizontal: SPACING.md, paddingVertical: 7 },
  typeBtnActive: { backgroundColor: COLORS.primary },
  typeBtnText: { fontSize: FONT.sm, color: COLORS.textSecondary, fontWeight: '600' },
  typeBtnTextActive: { color: '#fff' },
  centerBtn: {
    position: 'absolute', right: SPACING.xl,
    bottom: BOTTOM_SHEET_HEIGHT + 80,
    borderRadius: RADIUS.full, overflow: 'hidden', width: 52, height: 52,
  },
  centerBtnGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerBtnIcon: { fontSize: 24, color: '#fff' },
  sheetToggle: {
    position: 'absolute', right: SPACING.xl,
    bottom: BOTTOM_SHEET_HEIGHT + 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(22,27,34,0.9)',
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetToggleText: { color: COLORS.textSecondary, fontSize: FONT.sm },
  markerOuter: {
    width: 50, height: 50, borderRadius: 25, borderWidth: 3,
    backgroundColor: 'rgba(13,17,23,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  markerInner: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  markerIcon: { fontSize: 20 },
  markerTail: {
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    alignSelf: 'center', marginTop: -1,
  },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: BOTTOM_SHEET_HEIGHT,
    borderTopLeftRadius: RADIUS.xxl, borderTopRightRadius: RADIUS.xxl,
    borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginTop: SPACING.md,
  },
  sheetContent: { flex: 1, padding: SPACING.xl },
  coordRow: { flexDirection: 'row', flex: 1, alignItems: 'center' },
  coordItem: { flex: 1, alignItems: 'center' },
  coordLabel: {
    fontSize: FONT.xs, color: COLORS.textTertiary, fontWeight: '700',
    letterSpacing: 1, marginBottom: 6,
  },
  coordValue: { fontSize: FONT.xl, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: -0.5 },
  coordDivider: { width: 1, height: 50, backgroundColor: COLORS.border, marginHorizontal: SPACING.md },
  sheetFooter: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: SPACING.md,
  },
  sheetChip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: FONT.xs, color: COLORS.textSecondary },
  deviceChipSmall: {
    borderWidth: 1, borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm, paddingVertical: 4,
  },
  deviceChipText: { fontSize: FONT.xs, fontWeight: '700', letterSpacing: 0.5 },
});
