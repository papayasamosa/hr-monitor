import { Capacitor } from '@capacitor/core';

/**
 * Centralized platform detection so components never need to branch on
 * environment directly. Storage and Bluetooth adapters use this to select
 * their web vs. Android implementation.
 */
export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPlatform() {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}
