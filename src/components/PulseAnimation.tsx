// src/components/PulseAnimation.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

interface PulseAnimationProps {
  color: string;
  size?: number;
  active?: boolean;
  children?: React.ReactNode;
  style?: ViewStyle;
}

export default function PulseAnimation({
  color,
  size = 80,
  active = true,
  children,
  style,
}: PulseAnimationProps) {
  const pulse1 = useRef(new Animated.Value(1)).current;
  const pulse2 = useRef(new Animated.Value(1)).current;
  const opacity1 = useRef(new Animated.Value(0.6)).current;
  const opacity2 = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (!active) {
      pulse1.setValue(1);
      pulse2.setValue(1);
      opacity1.setValue(0);
      opacity2.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.stagger(400, [
        Animated.parallel([
          Animated.timing(pulse1, {
            toValue: 1.8,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(opacity1, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulse2, {
            toValue: 1.8,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(opacity2, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
      pulse1.setValue(1);
      pulse2.setValue(1);
      opacity1.setValue(0.6);
      opacity2.setValue(0.4);
    };
  }, [active]);

  return (
    <View style={[styles.wrapper, { width: size, height: size }, style]}>
      {active && (
        <>
          <Animated.View
            style={[
              styles.pulse,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: color,
                transform: [{ scale: pulse1 }],
                opacity: opacity1,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.pulse,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: color,
                transform: [{ scale: pulse2 }],
                opacity: opacity2,
              },
            ]}
          />
        </>
      )}
      <View
        style={[
          styles.center,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: `${color}20`,
            borderColor: `${color}60`,
            borderWidth: 2,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    borderWidth: 2,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
