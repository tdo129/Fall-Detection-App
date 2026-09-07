// src/constants/theme.ts
export const COLORS = {
  // Backgrounds (Light Theme)
  bg: '#F6F8FA',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#EEF2F6',
  surface: 'rgba(0, 0, 0, 0.04)',
  surfaceHover: 'rgba(0, 0, 0, 0.07)',
  border: 'rgba(0, 0, 0, 0.08)',
  borderStrong: 'rgba(0, 0, 0, 0.16)',

  // Brand
  primary: '#0A84FF',
  primaryLight: 'rgba(10, 132, 255, 0.12)',
  primaryDark: '#0066CC',

  // Status
  success: '#28A745',
  successLight: 'rgba(40, 167, 69, 0.14)',
  danger: '#FF3B30',
  dangerLight: 'rgba(255, 59, 48, 0.14)',
  warning: '#FF9500',
  warningLight: 'rgba(255, 149, 0, 0.14)',
  info: '#007AFF',
  infoLight: 'rgba(0, 122, 255, 0.14)',

  // Text (Dark text for Light Background)
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  textTertiary: '#9CA3AF',
  textDanger: '#DC2626',

  // Gradients (as array tuples)
  gradientBg: ['#F8FAFC', '#EEF2F6'] as [string, string],
  gradientPrimary: ['#0A84FF', '#0066CC'] as [string, string],
  gradientDanger: ['#FF3B30', '#D32F2F'] as [string, string],
  gradientSuccess: ['#34C759', '#28A745'] as [string, string],
  gradientWarning: ['#FF9500', '#E68500'] as [string, string],
  gradientHeader: ['#FFFFFF', 'rgba(255, 255, 255, 0.0)'] as [string, string],
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
};

export const FONT = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  display: 40,
};

export const SHADOW = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 8,
  },
  danger: {
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  primary: {
    shadowColor: '#0A84FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
};
