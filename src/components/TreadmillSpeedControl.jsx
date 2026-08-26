import React from 'react';

/**
 * Optional, cardio-only treadmill speed input. Deliberately minimal (a
 * number field + a unit dropdown) so it stays fast to use mid-workout - the
 * caller (useRecordingSession's setTreadmillSpeed) handles turning a change
 * into a new timestamped SessionSpeedEvent, this component only reports the
 * raw value/unit.
 */
function TreadmillSpeedControl({ value, unit, onValueChange, onUnitChange, disabled }) {
  const handleValueChange = (e) => {
    const raw = e.target.value;
    if (raw === '') {
      onValueChange(null);
      return;
    }
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed)) onValueChange(parsed);
  };

  return (
    <div className="treadmill-speed-control">
      <label className="treadmill-speed-label" htmlFor="treadmill-speed-input">
        Treadmill speed
      </label>
      <div className="treadmill-speed-inputs">
        <input
          id="treadmill-speed-input"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          placeholder="Optional"
          value={value === null || value === undefined ? '' : value}
          onChange={handleValueChange}
          disabled={disabled}
          className="treadmill-speed-value"
        />
        <select
          aria-label="Speed unit"
          value={unit}
          onChange={(e) => onUnitChange(e.target.value)}
          disabled={disabled}
          className="treadmill-speed-unit"
        >
          <option value="kmh">km/h</option>
          <option value="mph">mph</option>
        </select>
      </div>
    </div>
  );
}

export default TreadmillSpeedControl;
