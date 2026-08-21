import React, { useMemo } from 'react';

const MAX_DISPLAY_POINTS = 200;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;
const PADDING = 10;

/**
 * Downsample only the *displayed* points for long recordings - the
 * underlying stored/exported readings are never touched or reduced.
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

/**
 * Simple SVG line chart of heart rate over elapsed session time. Used both
 * live (while recording - `readings` grows over time) and statically (a
 * saved session's readings, already filtered to its effective end time).
 */
function HeartRateChart({ readings }) {
  const points = useMemo(() => downsample(readings || [], MAX_DISPLAY_POINTS), [readings]);

  if (points.length < 2) {
    return (
      <div className="hr-chart hr-chart-empty">
        <p>Waiting for more readings&hellip;</p>
      </div>
    );
  }

  const values = points.map((p) => p.heartRate);
  const minHR = Math.min(...values);
  const maxHR = Math.max(...values);
  const range = maxHR - minHR || 1;
  const maxElapsed = points[points.length - 1].elapsedMs || 1;

  const path = points
    .map((p) => {
      const x = PADDING + (p.elapsedMs / maxElapsed) * (CHART_WIDTH - PADDING * 2);
      const y = CHART_HEIGHT - PADDING - ((p.heartRate - minHR) / range) * (CHART_HEIGHT - PADDING * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

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
    </div>
  );
}

export default HeartRateChart;
