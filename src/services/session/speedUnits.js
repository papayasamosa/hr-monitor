/**
 * Treadmill speed unit handling. Canonical internal unit is km/h - every
 * stored SessionSpeedEvent keeps its `speedCanonical` in km/h so speeds
 * entered in different units within (or across) sessions can always be
 * compared/bucketed directly, never comparing a raw mph value against a raw
 * km/h value.
 */
const KMH_PER_MPH = 1.609344;

/** Decimal places used to normalize a speed before storage/bucketing, so
 * floating-point noise (5.499999999 vs 5.500000001) never creates spurious
 * separate values/buckets. */
export const SPEED_PRECISION = 2;

export function normalizeSpeed(value) {
  return Math.round(value * 10 ** SPEED_PRECISION) / 10 ** SPEED_PRECISION;
}

/** Convert a user-entered speed into the canonical km/h unit. */
export function toCanonicalKmh(value, unit) {
  const kmh = unit === 'mph' ? value * KMH_PER_MPH : value;
  return normalizeSpeed(kmh);
}

/** Convert a canonical km/h speed back into the given display unit. */
export function fromCanonicalKmh(canonicalKmh, unit) {
  const value = unit === 'mph' ? canonicalKmh / KMH_PER_MPH : canonicalKmh;
  return normalizeSpeed(value);
}

export const SPEED_UNITS = ['kmh', 'mph'];
