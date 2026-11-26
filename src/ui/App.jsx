import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Fan, Play, Pause, SlidersHorizontal, Grid2x2, Plus, Minus, ArrowLeft, ArrowRight, X } from 'lucide-react';
import { SLOTS, PRESETS, CFM_PER_M3S, PSU_MODES, SLOT_MODES } from '../sim/model.js';
import { cssGradient, heat, turbo, diverging, SOURCE_COLORS } from '../render/colormap.js';
import { store, useStore, call, syncView } from './store.js';
import { Slider, Seg, Toggle, Select, Field } from './controls.jsx';

const PRESET_IDS = Object.keys(PRESETS);
const MODE_LABEL = { intake: 'In', exhaust: 'Out', open: 'Open', blocked: 'Shut' };
const COLOR_NAMES = { temperature: 'Temperature', speed: 'Speed', source: 'Source' };
const pct = (v) => `${Math.round(v * 100)}%`;
const cfm = (q) => (q * CFM_PER_M3S).toFixed(0);
const tempTone = (t, limit) => (t >= limit - 2 ? 'bad' : t >= limit - 18 ? 'warm' : undefined);

function Icon({ as: Cmp }) {
  return <span className="ico" aria-hidden="true"><Cmp strokeWidth={1.8} /></span>;
}

const phoneMq = matchMedia('(max-width: 900px)');
const usePhone = () => useSyncExternalStore(
  (cb) => { phoneMq.addEventListener('change', cb); return () => phoneMq.removeEventListener('change', cb); },
  () => phoneMq.matches,
);

const setView = (patch) => call('onView', patch);

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
function Topbar({ onSettings }) {
  const paused = useStore((s) => s.paused);
  return (
    <header id="topbar">
      <a className="wordmark" href="#" aria-label="Airflow home" onClick={(e) => e.preventDefault()}>
        <span className="mark" aria-hidden="true"><Fan strokeWidth={1.8} /></span>Airflow
      </a>
      <div className="actions">
        <button type="button" className="btn soft icon" aria-label="Settings" title="Settings" onClick={onSettings}>
          <Icon as={SlidersHorizontal} />
        </button>
        <button type="button" className="btn primary" onClick={() => call('onPause')}>
          <Icon as={paused ? Play : Pause} /><span>{paused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Stage overlays
// ---------------------------------------------------------------------------
function LiveChip() {
  const paused = useStore((s) => s.paused);
  const warmed = useStore((s) => s.warmed);
  const cls = paused ? 'paused' : warmed ? '' : 'warming';
  return (
    <div id="overlay-tl">
      <div className="chip">
        <span className={`live ${cls}`}><i /><b>{paused ? 'Paused' : warmed ? 'Live' : 'Starting'}</b></span>
      </div>
    </div>
  );
}

function LegendItem({ title, fn, lo, hi, signed }) {
  return (
    <div className="legend-item">
      <div className="title">{title}</div>
      <div className="bar" style={{ background: cssGradient(fn, signed) }} />
      <div className="ends"><span>{lo}</span><span>{hi}</span></div>
    </div>
  );
}

function Legend() {
  const v = useStore((s) => s.view);
  const range = useStore((s) => s.pressureRange);
  if (!v) return <div id="legend" />;
  let streaks = null;
  if (v.particles) {
    if (v.color === 'temperature') streaks = <LegendItem title="Temperature" fn={heat} lo="Ambient" hi="+20°" />;
    else if (v.color === 'speed') streaks = <LegendItem title="Speed" fn={turbo} lo="0" hi="3 m/s" />;
    else {
      streaks = (
        <div className="legend-item">
          <div className="title">Source</div>
          <div className="swatches">
            {SLOTS.map((s, i) => {
              const c = SOURCE_COLORS[i % SOURCE_COLORS.length].map((x) => Math.round(x * 255));
              return <span key={s.id} style={{ '--c': `rgb(${c})` }}>{s.label}</span>;
            })}
            <span style={{ '--c': 'rgb(178,184,199)' }}>Vents</span>
          </div>
        </div>
      );
    }
  }
  let plane = null;
  if (v.slice) {
    if (v.sliceField === 'speed') plane = <LegendItem title="Plane Speed" fn={turbo} lo="0" hi="3 m/s" />;
    else if (v.sliceField === 'temperature') plane = <LegendItem title="Plane Temperature" fn={heat} lo="Ambient" hi="+20°" />;
    else {
      const r = range ? range.toFixed(1) : null;
      plane = <LegendItem title="Plane Pressure" fn={diverging} lo={r ? `−${r} Pa` : '−'} hi={r ? `+${r} Pa` : '+'} signed />;
    }
  }
  return <div id="legend">{streaks}{plane}</div>;
}

function Pills() {
  const v = useStore((s) => s.view);
  if (!v) return <div id="overlay-bl" />;
  const pill = (key, label, onClick, toggles = true) => (
    <button
      type="button" className={`btn glass pill-${key}${toggles && v[key] ? ' on' : ''}`}
      aria-pressed={toggles ? !!v[key] : false} onClick={onClick}
    >{label}</button>
  );
  const order = ['temperature', 'speed', 'source'];
  return (
    <div id="overlay-bl">
      {pill('particles', 'Streaks', () => setView({ particles: !v.particles }))}
      {pill('color', COLOR_NAMES[v.color], () => setView({ color: order[(order.indexOf(v.color) + 1) % order.length], particles: true }), false)}
      {pill('slice', 'Plane', () => setView({ slice: !v.slice }))}
      {pill('panels', 'Panels', () => setView({ panels: !v.panels }))}
    </div>
  );
}

function CameraButtons() {
  const flat = useStore((s) => s.flat);
  return (
    <div id="overlay-br">
      <button type="button" className="btn glass icon" aria-label="Zoom in" onClick={() => call('onCamera', 'in')}><Icon as={Plus} /></button>
      <button type="button" className="btn glass icon" aria-label="Zoom out" onClick={() => call('onCamera', 'out')}><Icon as={Minus} /></button>
      <button
        type="button" className={`btn glass icon flat-btn${flat ? ' on' : ''}`} aria-label="Flat View" title="Flat View" aria-pressed={flat}
        onClick={() => { store.set({ flat: !!call('onCamera', 'flat') }); syncView(); }}
      ><Icon as={Grid2x2} /></button>
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!toast) return undefined;
    setShow(true);
    const t = setTimeout(() => setShow(false), 1600);
    return () => clearTimeout(t);
  }, [toast]);
  return <div id="toast" role="status" aria-live="polite" className={show ? 'show' : undefined}>{toast?.text}</div>;
}

function Stage() {
  return (
    <section id="stage">
      {/* The engine appends its canvas here and drives #tooltip directly. */}
      <div id="viewport">
        <LiveChip />
        <Legend />
        <Pills />
        <CameraButtons />
        <div id="tooltip" hidden />
        <Toast />
      </div>
    </section>
  );
}

function PresetBar() {
  const preset = useStore((s) => s.preset);
  const index = useRef(0);
  if (preset) index.current = PRESET_IDS.indexOf(preset);
  const step = (d) => {
    index.current = (index.current + d + PRESET_IDS.length) % PRESET_IDS.length;
    call('onPreset', PRESET_IDS[index.current]);
  };
  return (
    <div id="presetbar">
      <div className="caption"><p><b>{preset ? PRESETS[preset].label : 'Custom'}</b></p></div>
      <div className="arrows">
        <button type="button" className="btn soft icon" aria-label="Previous preset" onClick={() => step(-1)}><Icon as={ArrowLeft} /></button>
        <button type="button" className="btn soft icon" aria-label="Next preset" onClick={() => step(1)}><Icon as={ArrowRight} /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side cards (collapsible on phones, always open on wider screens)
// ---------------------------------------------------------------------------
function Card({ title, startOpen = false, children }) {
  const phone = usePhone();
  const [openPhone, setOpenPhone] = useState(startOpen);
  const open = phone ? openPhone : true;
  return (
    <details className="card" open={open}>
      <summary onClick={(e) => { e.preventDefault(); if (phone) setOpenPhone((o) => !o); }}>
        <h2>{title}</h2><span className="chev" aria-hidden="true" />
      </summary>
      <div className="card-body">{children}</div>
    </details>
  );
}

function Temperatures() {
  const s = useStore((st) => st.summary);
  const col = (key, label, limit) => {
    const g = s?.groups?.[key];
    const fan = g ? (g.fan < 0.02 ? 'Fan Off' : pct(g.fan)) : '';
    return (
      <div className="stat">
        <span className="eyebrow">{label}</span>
        <div className="num" data-tone={g ? tempTone(g.die, limit) : undefined}>{g ? `${g.die.toFixed(0)}°` : '–'}</div>
        <div className="sub">{g ? (key === 'psu' ? fan : `${g.power.toFixed(0)} W · ${fan}`) : ''}</div>
      </div>
    );
  };
  const thr = s ? ['cpu', 'gpu'].filter((k) => s.groups[k].throttle < 0.98) : [];
  return (
    <Card title="Temperatures" startOpen>
      <div className="stats3">{col('cpu', 'CPU', 100)}{col('gpu', 'GPU', 90)}{col('psu', 'PSU', 999)}</div>
      {thr.length > 0 && <p className="note bad">{thr.map((k) => k.toUpperCase()).join(' & ')} Throttling</p>}
    </Card>
  );
}

function Airflow() {
  const s = useStore((st) => st.summary);
  const p = s?.pressure ?? 0;
  const kind = Math.abs(p) < 0.15 ? 'neu' : p > 0 ? 'pos' : 'neg';
  const row = (label, value) => <div className="row"><span className="k">{label}</span><span>{s ? value() : '–'}</span></div>;
  return (
    <Card title="Airflow">
      <div className="stats2">
        <div className="stat"><span className="eyebrow">Intake</span><div className="num big in">{s ? cfm(s.totalIn) : '–'}</div></div>
        <div className="stat"><span className="eyebrow">Exhaust</span><div className="num big out">{s ? cfm(s.totalOut) : '–'}</div></div>
      </div>
      <div className="row strong">
        <span className="k">Pressure</span>
        <span>
          <b>{s ? `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)} Pa` : ''}</b>
          {s && <span className={`tag ${kind}`}>{{ neu: 'Neutral', pos: 'Positive', neg: 'Negative' }[kind]}</span>}
        </span>
      </div>
      {row('GPU Exhaust', () => (s.gpuType === 'blower' ? `${cfm(s.gpuOut)} CFM` : '—'))}
      {row('Passive', () => `${cfm(s.ventIn)} / ${cfm(s.ventOut)} CFM`)}
      {row('Case Air', () => `${s.airTemp.toFixed(1)}°C`)}
      {row('Exhaust Air', () => `${s.exhaustTemp.toFixed(1)}°C`)}
      {row('Peak Air', () => `${s.airMax.toFixed(1)}°C`)}
      {row('Load', () => `${s.psuLoad.toFixed(0)} W`)}
    </Card>
  );
}

function FanSlots() {
  const modes = useStore((s) => s.modes);
  const preset = useStore((s) => s.preset);
  const summary = useStore((s) => s.summary);
  return (
    <Card title="Fan Slots">
      <Select
        label="Preset" value={preset || ''}
        options={[['', 'Custom'], ...PRESET_IDS.map((id) => [id, PRESETS[id].label])]}
        onChange={(id) => { if (id) call('onPreset', id); }}
      />
      <div className="slots">
        {SLOTS.map((slot) => {
          const mode = modes[slot.id];
          const fan = summary?.fans.find((f) => f.id === slot.id && f.kind === 'case');
          const flow = fan ? `${fan.cfm.toFixed(0)} CFM` : mode === 'open' ? 'Vent' : mode === 'blocked' ? 'Shut' : '—';
          return (
            <div className="slot" key={slot.id}>
              <div className="slot-head"><i className="dot" data-mode={mode} /><span className="name">{slot.label}</span><span className="cfm">{flow}</span></div>
              <Seg options={SLOT_MODES.map((m) => [m, MODE_LABEL[m]])} value={mode} onPick={(m) => call('onMode', slot.id, m)} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function LoadHardware() {
  const init = useStore((s) => s.init);
  const [auto, setAuto] = useState(init.coolerAuto);
  const [psu, setPsu] = useState(init.psuMode);
  return (
    <Card title="Load & Hardware">
      <Slider label="Case Fans" min={0} max={1} step={0.05} initial={init.caseFanSpeed} fmt={pct} onChange={(v) => call('onConfig', { caseFanSpeed: v })} />
      <Slider label="CPU" min={15} max={300} step={5} initial={init.power.cpu} fmt={(v) => `${v} W`} onChange={(v) => call('onConfig', { power: { cpu: v } })} />
      <Slider label="GPU" min={20} max={500} step={5} initial={init.power.gpu} fmt={(v) => `${v} W`} onChange={(v) => call('onConfig', { power: { gpu: v } })} />
      <Slider label="Ambient" min={10} max={40} step={0.5} initial={init.ambient} fmt={(v) => `${v.toFixed(1)}°C`} onChange={(v) => call('onConfig', { ambient: v })} />
      <Toggle label="Auto Cooler Fans" checked={auto} onChange={(on) => { setAuto(on); call('onConfig', { coolerAuto: { cpu: on, gpu: on } }); }} />
      {!auto && (
        <Slider label="Cooler Fans" min={0} max={1} step={0.01} initial={init.coolerManual} fmt={pct} onChange={(v) => call('onConfig', { coolerManual: { cpu: v, gpu: v } })} />
      )}
      <Select label="Power Supply" options={Object.entries(PSU_MODES)} value={psu} onChange={(v) => { setPsu(v); call('onPsu', v); }} />
    </Card>
  );
}

function Side() {
  const ready = useStore((s) => s.ready);
  return (
    <aside id="side" aria-label="Readouts and controls">
      {ready && (<><Temperatures /><Airflow /><FanSlots /><LoadHardware /></>)}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------
function Settings({ onClose }) {
  const v = useStore((s) => s.view);
  const init = useStore((s) => s.init);
  const [resolution, setResolution] = useState(init.resolution);
  const [buoyancy, setBuoyancy] = useState(init.buoyancy);
  const [shown, setShown] = useState(false);
  const closeRef = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    closeRef.current?.focus();
    const raf = requestAnimationFrame(() => setShown(true));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className={`scrim${shown ? ' in' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-h">
        <button ref={closeRef} type="button" className="btn soft icon closebtn" aria-label="Close" onClick={onClose}><Icon as={X} /></button>
        <h1 id="settings-h">Settings</h1>
        <div className="cols">
          <div>
            <h3 className="eyebrow">Streaks</h3>
            <Field label="Colour">
              <Seg options={Object.entries(COLOR_NAMES)} value={v.color} onPick={(c) => setView({ color: c })} />
            </Field>
            <Slider label="Count" min={500} max={12000} step={500} value={v.count} fmt={(x) => `${x}`} onChange={(x) => setView({ count: x })} />
            <Slider label="Seeding" min={0} max={1} step={0.05} value={v.seedMix} fmt={pct} onChange={(x) => setView({ seedMix: x })} />
          </div>
          <div>
            <h3 className="eyebrow">Cross-section</h3>
            <Field label="Field">
              <Seg options={[['speed', 'Speed'], ['temperature', 'Temperature'], ['pressure', 'Pressure']]} value={v.sliceField} onPick={(c) => setView({ sliceField: c, slice: true })} />
            </Field>
            <Field label="Axis">
              <Seg options={[['0', 'Side'], ['1', 'Top'], ['2', 'Front']]} value={v.sliceAxis} onPick={(c) => setView({ sliceAxis: +c, slice: true })} />
            </Field>
            <Slider label="Position" min={0} max={1} step={0.01} value={v.slicePos} fmt={pct} onChange={(x) => setView({ slicePos: x })} />
          </div>
        </div>
        <hr />
        <div className="cols">
          <div>
            <h3 className="eyebrow">Simulation</h3>
            <Slider label="Time Scale" min={0.05} max={1} step={0.05} initial={init.timeScale} fmt={(x) => `${x.toFixed(2)}×`} onChange={(x) => call('onConfig', { timeScale: x })} />
            <Toggle label="Buoyancy" checked={buoyancy} onChange={(on) => { setBuoyancy(on); call('onConfig', { buoyancy: on }); }} />
          </div>
          <div>
            <h3 className="eyebrow">Accuracy</h3>
            <Select
              label="Resolution" value={resolution} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]}
              onChange={(r) => { setResolution(r); call('onResolution', r); }}
            />
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={onClose}>Done</button>
          <button type="button" className="textlink" onClick={() => { call('onReset'); onClose(); }}>Reset</button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState(false);
  const ready = useStore((s) => s.ready);
  const closeSettings = useRef(() => setSettings(false)).current;
  return (
    <>
      <Topbar onSettings={() => setSettings(true)} />
      <div id="main">
        <div id="stagecol">
          <Stage />
          <PresetBar />
        </div>
        <Side />
      </div>
      <div id="modal-root">{settings && ready && <Settings onClose={closeSettings} />}</div>
    </>
  );
}
