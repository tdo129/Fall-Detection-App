// src/navigation/navigationRef.ts
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

/**
 * Điều hướng lập tức về màn hình Tổng quan khi phát hiện sự cố té ngã
 */
export function navigateToDashboard(): void {
  try {
    if (navigationRef.isReady()) {
      navigationRef.navigate('Tổng quan');
    }
  } catch (e) {
    console.warn('[navigationRef] Error navigating to Dashboard:', e);
  }
}
