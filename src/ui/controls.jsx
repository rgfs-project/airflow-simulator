import { useId, useState } from 'react';

/** Range slider with a label and live value; keeps its own value after the initial one. */
export function Slider({ label, min, max, step, initial, value, fmt, onChange }) {
  const id = useId();
  const [local, setLocal] = useState(initial);
  const v = value ?? local;
  const pct = `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="ctl">
      <label htmlFor={id}><span>{label}</span><span className="val">{fmt(v)}</span></label>
      <input
        id={id} type="range" min={min} max={max} step={step} value={v} style={{ '--p': pct }}
        onChange={(e) => { const x = parseFloat(e.target.value); setLocal(x); onChange(x); }}
      />
    </div>
  );
}

/** Segmented control (radio group of buttons). */
export function Seg({ options, value, onPick, wide = true }) {
  return (
    <div className={`seg${wide ? ' wide' : ''}`} role="radiogroup">
      {options.map(([key, label]) => {
        const on = String(key) === String(value);
        return (
          <button key={key} type="button" role="radio" aria-checked={on} className={on ? 'on' : undefined} onClick={() => onPick(key)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, checked, onChange }) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
    </label>
  );
}

export function Select({ label, options, value, onChange }) {
  const id = useId();
  return (
    <div className="ctl">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}

export function Field({ label, children }) {
  return <div className="ctl"><label>{label}</label>{children}</div>;
}
