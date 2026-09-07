// src/components/BatteryIndicator.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONT, RADIUS } from '../constants/theme';

interface BatteryIndicatorProps {
  percent: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function getBatteryColor(pct: number) {
  if (pct >= 60) return COLORS.success;
  if (pct >= 30) return COLORS.warning;
  return COLORS.danger;
}

export default function BatteryIndicator({
  percent,
  size = 'md',
  showLabel = true,
}: BatteryIndicatorProps) {
  const clampedPct = Math.min(100, Math.max(0, percent));
  const color = getBatteryColor(clampedPct);

  const barWidths = { sm: 36, md: 52, lg: 72 };
  const barHeights = { sm: 18, md: 24, lg: 32 };
  const fontSizes = { sm: FONT.xs, md: FONT.sm, lg: FONT.md };
  const termWidth = { sm: 3, md: 4, lg: 5 };
  const termHeight = { sm: 8, md: 10, lg: 14 };

  const w = barWidths[size];
  const h = barHeights[size];
  const tw = termWidth[size];
  const th = termHeight[size];
  const fillWidth = (clampedPct / 100) * (w - 4);

  return (
    <View style={styles.container}>
      {/* Battery body */}
      <View
        style={[
          styles.body,
          {
            width: w,
            height: h,
            borderColor: color,
            borderRadius: RADIUS.sm / 1.5,
          },
        ]}
      >
        {/* Fill */}
        <View
          style={[
            styles.fill,
            {
              width: fillWidth,
              backgroundColor: color,
              borderRadius: RADIUS.sm / 2,
            },
          ]}
        />
        {/* Percentage text inside */}
        {size !== 'sm' && (
          <Text style={[styles.insideText, { fontSize: fontSizes[size] - 1, color }]}>
            {Math.round(clampedPct)}%
          </Text>
        )}
      </View>
      {/* Terminal nub */}
      <View
        style={[
          styles.terminal,
          {
            width: tw,
            height: th,
            backgroundColor: color,
            borderRadius: 1,
          },
        ]}
      />
      {/* Label outside */}
      {showLabel && size === 'sm' && (
        <Text style={[styles.label, { color, fontSize: fontSizes[size] }]}>
          {Math.round(clampedPct)}%
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  body: {
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    height: '80%',
    position: 'absolute',
    left: 2,
  },
  insideText: {
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
    zIndex: 1,
  },
  terminal: {
    opacity: 0.8,
  },
  label: {
    fontWeight: '700',
    marginLeft: 4,
  },
});
