import React, { useMemo } from 'react';

const MAX_DISPLAY_POINTS = 200;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;
const PADDING = 10;

const SPEED_UNIT_LABEL = { kmh: 'km/h', mph: 'mph' };

/**
 * Downsample only the *displayed* points for long recordings - the
 * underlying stored/exported readings are never touched or reduced. This
 * MUST stay display-only: statistics (average/typical range/etc.) are
 * always computed elsewhere from the complete reading set and simply
 * passed in as `averageBpm`/`typicalLowBpm`/`typicalHighBpm` props.
 */
function downsample(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  return result;
}

function formatMinutes(ms) {
  return `${Math.round(ms / 60000)}m`;
}

function xFor(elapsedMs, maxElapsed) {
  return PADDING + (elapsedMs / maxElapsed) * (CHART_WIDTH - PADDING * 2);
}

function yFor(value, min, range) {
  return CHART_HEIGHT - PADDING - ((value - min) / range) * (CHART_HEIGHT - PADDING * 2);
}

/** Build a "constant until next event" staircase path - never interpolated between events. */
function buildStepPath(events, maxElapsed, scaleY) {
  if (!events || events.length === 0) return '';
  const sorted = [...events].sort((a, b) => a.elapsedMs - b.elapsedMs);
  let d = '';
  sorted.forEach((event, i) => {
    const x0 = xFor(event.elapsedMs, maxElapsed);
    const y = scaleY(event.speed);
    const nextElapsed = i + 1 < sorted.length ? sorted[i + 1].elapsedMs : maxElapsed;
    const x1 = xFor(nextElapsed, maxElapsed);
    d += d ? ` L ${x0.toFixed(1)},${y.toFixed(1)}` : `M ${x0.toFixed(1)},${y.toFixed(1)}`;
    d += ` L ${x1.toFixed(1)},${y.toFixed(1)}`;
  });
  return d;
}

/**
 * Simple SVG line chart of heart rate over elapsed session time. Used both
 * live (while recording - `readings` grows over time) and statically (a
 * saved session's readings, already filtered to its effective end time).
 *
 * Optional overlay props (all additive - omitting them reproduces the
 * original plain HR trace exactly):
 *   averageBpm, typicalLowBpm, typicalHighBpm - drawn behind the HR trace so
 *     the trace itself stays the dominant visual element. Callers must
 *     compute these from the complete, effective-end-filtered reading set
 *     (see services/session/heartRateStats.js), never from `readings` here.
 *   speedEvents - [{ elapsedMs, speed }], already resolved to elapsedMs
 *     offsets and converted to `speedUnit` by the caller. Rendered as a
 *     step series (constant-until-next-event) on a secondary axis.
 *   speedUnit - 'kmh' | 'mph', used only for the axis label.
 *   showSpeed - explicit toggle (default true when speedEvents is non-empty)
 *     so a parent screen can let the user hide the overlay if both series
 *     together hurt readability.
 */
function HeartRateChart({
  readings,
  averageBpm,
  typicalLowBpm,
  typicalHighBpm,
  speedEvents,
  speedUnit,
  showSpeed = true
}) {
  const points = useMemo(() => downsample(readings || [], MAX_DISPLAY_POINTS), [readings]);

  if (points.length < 2) {
    return (
      <div className="hr-chart hr-chart-empty">
        <p>Waiting for more readings&hellip;</p>
      </div>
    );
  }

  const values = points.map((p) => p.heartRate);
  let minHR = Math.min(...values);
  let maxHR = Math.max(...values);
  // Widen the visible range to fit the overlays too, so a typical-range band
  // or average line outside the plotted trace's own min/max doesn't clip.
  const overlayValues = [averageBpm, typicalLowBpm, typicalHighBpm].filter(
    (v) => typeof v === 'number' && !Number.isNaN(v)
  );
  if (overlayValues.length > 0) {
    minHR = Math.min(minHR, ...overlayValues);
    maxHR = Math.max(maxHR, ...overlayValues);
  }
  const range = maxHR - minHR || 1;
  const maxElapsed = points[points.length - 1].elapsedMs || 1;

  const path = points
    .map((p) => `${xFor(p.elapsedMs, maxElapsed).toFixed(1)},${yFor(p.heartRate, minHR, range).toFixed(1)}`)
    .join(' ');

  const hasTypicalBand =
    typeof typicalLowBpm === 'number' && typeof typicalHighBpm === 'number' && !Number.isNaN(typicalLowBpm) && !Number.isNaN(typicalHighBpm);
  const hasAverageLine = typeof averageBpm === 'number' && !Number.isNaN(averageBpm);

  const validSpeedEvents = showSpeed && speedEvents ? speedEvents.filter((e) => typeof e.speed === 'number') : [];
  const hasSpeed = validSpeedEvents.length > 0;
  let speedPath = '';
  let speedMin = 0;
  let speedMax = 1;
  if (hasSpeed) {
    const speedValues = validSpeedEvents.map((e) => e.speed);
    speedMin = Math.min(0, ...speedValues);
    speedMax = Math.max(...speedValues) || 1;
    const speedRange = speedMax - speedMin || 1;
    speedPath = buildStepPath(validSpeedEvents, maxElapsed, (v) => yFor(v, speedMin, speedRange));
  }

  return (
    <div className="hr-chart">
      <div className="hr-chart-top-label">{maxHR} BPM</div>
      <svg
        className="hr-chart-svg"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Heart rate over time"
      >
        {hasTypicalBand && (
          <rect
            className="hr-chart-typical-band"
            x={PADDING}
            y={yFor(typicalHighBpm, minHR, range)}
            width={CHART_WIDTH - PADDING * 2}
            height={Math.max(0, yFor(typicalLowBpm, minHR, range) - yFor(typicalHighBpm, minHR, range))}
            fill="var(--accent-danger)"
            fillOpacity="0.12"
          />
        )}
        {hasSpeed && (
          <path
            className="hr-chart-speed-line"
            d={speedPath}
            fill="none"
            stroke="var(--accent-primary, #2563eb)"
            strokeWidth="1.5"
            strokeDasharray="3 2"
            opacity="0.8"
          />
        )}
        {hasAverageLine && (
          <line
            className="hr-chart-average-line"
            x1={PADDING}
            x2={CHART_WIDTH - PADDING}
            y1={yFor(averageBpm, minHR, range)}
            y2={yFor(averageBpm, minHR, range)}
            stroke="var(--accent-danger)"
            strokeWidth="1"
            strokeDasharray="4 3"
            opacity="0.6"
          />
        )}
        <polyline
          points={path}
          fill="none"
          stroke="var(--accent-danger)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="hr-chart-bottom-row">
        <span>{minHR} BPM</span>
        <span className="hr-chart-x-axis">
          <span>0m</span>
          <span>{formatMinutes(maxElapsed)}</span>
        </span>
      </div>
      {hasSpeed && (
        <div className="hr-chart-speed-legend">
          Speed: {speedMin}–{speedMax} {SPEED_UNIT_LABEL[speedUnit] || speedUnit || ''}
        </div>
      )}
    </div>
  );
}

export default HeartRateChart;
