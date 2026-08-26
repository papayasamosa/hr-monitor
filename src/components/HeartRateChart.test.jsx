// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import HeartRateChart from './HeartRateChart';

afterEach(cleanup);

function readings(bpms) {
  return bpms.map((heartRate, i) => ({ elapsedMs: i * 60000, heartRate }));
}

describe('HeartRateChart', () => {
  it('renders the plain HR trace unchanged when no overlay props are given', () => {
    const { container } = render(<HeartRateChart readings={readings([60, 70, 80, 90, 100])} />);
    expect(container.querySelectorAll('polyline').length).toBe(1);
    expect(container.querySelector('.hr-chart-typical-band')).toBeNull();
    expect(container.querySelector('.hr-chart-average-line')).toBeNull();
    expect(container.querySelector('.hr-chart-speed-line')).toBeNull();
    expect(container.textContent).toContain('100 BPM');
    expect(container.textContent).toContain('60 BPM');
  });

  it('shows the waiting-for-data placeholder with fewer than 2 readings, regardless of overlay props', () => {
    const { container } = render(
      <HeartRateChart readings={readings([60])} averageBpm={80} typicalLowBpm={70} typicalHighBpm={90} />
    );
    expect(container.querySelector('.hr-chart-empty')).not.toBeNull();
  });

  it('renders a typical-range band and average line behind the HR trace when provided', () => {
    const { container } = render(
      <HeartRateChart
        readings={readings([60, 70, 80, 90, 100])}
        averageBpm={80}
        typicalLowBpm={65}
        typicalHighBpm={95}
      />
    );
    const band = container.querySelector('.hr-chart-typical-band');
    const avgLine = container.querySelector('.hr-chart-average-line');
    expect(band).not.toBeNull();
    expect(avgLine).not.toBeNull();

    // The HR trace polyline must come after (i.e. paint on top of) the band/line in DOM order.
    const svg = container.querySelector('svg');
    const children = Array.from(svg.children).map((el) => el.tagName.toLowerCase());
    expect(children.indexOf('polyline')).toBeGreaterThan(children.indexOf('rect'));
    expect(children.indexOf('polyline')).toBeGreaterThan(children.indexOf('line'));
  });

  it('widens the visible range so an out-of-range typical band/average line is not clipped', () => {
    const { container } = render(
      <HeartRateChart readings={readings([70, 72, 71])} averageBpm={40} typicalLowBpm={30} typicalHighBpm={50} />
    );
    // Top label should now reflect the widened range, not just the trace's own max.
    expect(container.textContent).toContain('72 BPM');
    const band = container.querySelector('.hr-chart-typical-band');
    expect(Number(band.getAttribute('height'))).toBeGreaterThan(0);
  });

  it('renders speed as a step series (constant-until-next-event), never interpolated', () => {
    const { container } = render(
      <HeartRateChart
        readings={readings([60, 70, 80, 90])}
        speedEvents={[
          { elapsedMs: 0, speed: 5 },
          { elapsedMs: 90000, speed: 6.5 }
        ]}
        speedUnit="kmh"
      />
    );
    const path = container.querySelector('.hr-chart-speed-line');
    expect(path).not.toBeNull();
    const d = path.getAttribute('d');
    // A step path has exactly 2 distinct y-levels and horizontal segments
    // between direction changes - i.e. 4 point pairs: (x0,y0)-(x1,y0)-(x1,y1)-(x2,y1).
    const coords = d.match(/-?\d+\.?\d*/g).map(Number);
    // coords: x0,y0, x1,y0, x1,y1, x2,y1
    expect(coords.length).toBe(8);
    expect(coords[1]).toBe(coords[3]); // first segment is horizontal (same y)
    expect(coords[2]).toBe(coords[4]); // vertical jump happens at the same x
    expect(coords[5]).toBe(coords[7]); // second segment is horizontal (same y)
    expect(container.textContent).toContain('km/h');
  });

  it('does not render the speed overlay when showSpeed is false', () => {
    const { container } = render(
      <HeartRateChart
        readings={readings([60, 70, 80])}
        speedEvents={[{ elapsedMs: 0, speed: 5 }]}
        speedUnit="kmh"
        showSpeed={false}
      />
    );
    expect(container.querySelector('.hr-chart-speed-line')).toBeNull();
  });
});
