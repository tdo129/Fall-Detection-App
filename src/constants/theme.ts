// src/constants/theme.ts
export const COLORS = {
  // Backgrounds
  bg: '#F4F8FD',
  bgSecondary: '#FFFFFF',
  bgTertiary: '#F1F5F9',
  surface: '#FFFFFF',
  surfaceHover: '#F8FAFC',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',

  // Brand
  primary: '#0088FF',
  primaryLight: 'rgba(0,136,255,0.12)',
  primaryDark: '#0066CC',

  // Status
  success: '#16A34A',
  successLight: '#DCFCE7',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  info: '#0EA5E9',
  infoLight: '#E0F2FE',

  // Text
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  textDanger: '#DC2626',

  // Gradients (as array tuples)
  gradientBg: ['#F4F8FD', '#FFFFFF'] as [string, string],
  gradientPrimary: ['#0088FF', '#0066CC'] as [string, string],
  gradientDanger: ['#EF4444', '#DC2626'] as [string, string],
  gradientSuccess: ['#16A34A', '#15803D'] as [string, string],
  gradientWarning: ['#F59E0B', '#D97706'] as [string, string],
  gradientHeader: ['#F4F8FD', 'rgba(244,248,253,0)'] as [string, string],
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
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  danger: {
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  primary: {
    shadowColor: '#0088FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
};
