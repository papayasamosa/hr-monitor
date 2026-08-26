const STORAGE_KEY = 'hr-monitor:treadmillSpeedUnit';

/** Best-effort persisted unit preference (localStorage - works in both the
 * browser and the Capacitor Android WebView, no extra native plugin needed).
 * Falls back silently to 'kmh' wherever storage is unavailable/blocked. */
export function getPreferredSpeedUnit() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'mph' ? 'mph' : 'kmh';
  } catch {
    return 'kmh';
  }
}

export function setPreferredSpeedUnit(unit) {
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    // Best-effort only - a failed write just means the next session reverts to the default.
  }
}
