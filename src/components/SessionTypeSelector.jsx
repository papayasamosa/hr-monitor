import React from 'react';

const SESSION_TYPES = [
  { value: 'strength', label: 'Strength' },
  { value: 'cardio', label: 'Cardio' }
];

function SessionTypeSelector({ sessionType, onChange, disabled }) {
  return (
    <div className="session-type-selector">
      <div className="session-type-label">Session type</div>
      <div className="session-type-options" role="radiogroup" aria-label="Session type">
        {SESSION_TYPES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={sessionType === value}
            className={`session-type-option ${sessionType === value ? 'selected' : ''}`}
            onClick={() => onChange(value)}
            disabled={disabled}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default SessionTypeSelector;
