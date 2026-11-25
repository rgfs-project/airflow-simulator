import { SLOTS, PRESETS, CFM_PER_M3S } from './sim/model.js';
import { cssGradient, heat, turbo, diverging, SOURCE_COLORS } from './render/colormap.js';

const MODE_LABELS = { intake: 'In', exhaust: 'Out', open: 'Open', blocked: 'Shut' };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function slider({ label, min, max, step, value, fmt, onInput }) {
  const val = el('span', { class: 'val' }, fmt(value));
  const input = el('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  const wrap = el('div', { class: 'ctl' }, el('label', {}, el('span', {}, label), val), input);
  wrap.set = (v) => { input.value = v; val.textContent = fmt(v); };
  return wrap;
}

function seg(options, value, onPick, wide = false) {
  const wrap = el('div', { class: `seg${wide ? ' wide' : ''}` });
  const buttons = options.map(([key, label]) => {
    const b = el('button', { 'data-mode': key, type: 'button' }, label);
    b.addEventListener('click', () => { set(key); onPick(key); });
    wrap.append(b);
    return b;
  });
  const set = (v) => buttons.forEach((b) => b.classList.toggle('on', b.dataset.mode === v));
  set(value);
  wrap.set = set;
  return wrap;
}

function check(label, value, onChange) {
  const input = el('input', { type: 'checkbox' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return el('div', { class: 'ctl inline' }, el('label', {}, label), input);
}

const fmtT = (t) => `${t.toFixed(1)}°C`;
const tempColor = (t, limit) => (t >= limit - 2 ? 'var(--bad)' : t >= limit - 20 ? 'var(--warn)' : 'var(--good)');

export function buildUI(state, h) {
  const panel = document.getElementById('panel');
  panel.append(
    el('h1', {}, 'PC Airflow Simulator'),
    el('div', { class: 'sub' }, '3D incompressible airflow + heat transport inside a mid-tower case.'),
  );

  // Presets
  const presetButtons = {};
  const presets = el('div', { class: 'presets' });
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = el('button', { type: 'button', onclick: () => h.onPreset(id) }, p.label, el('small', {}, p.hint));
    presetButtons[id] = b;
    presets.append(b);
  }
  panel.append(el('div', { class: 'section' }, el('h2', {}, 'Presets'), presets));

  // Slots
  const slotRows = {};
  const slotsBox = el('div');
  for (const slot of SLOTS) {
    const cfm = el('div', { class: 'cfm' }, '');
    const s = seg(Object.entries(MODE_LABELS), state.modes[slot.id], (m) => h.onMode(slot.id, m));
    slotRows[slot.id] = { seg: s, cfm };
    slotsBox.append(el('div', { class: 'slot-row' }, el('div', { class: 'name' }, slot.label, cfm), s));
  }
  panel.append(el('div', { class: 'section' }, el('h2', {}, 'Fan slots'), slotsBox));

  // Fans & load
  const coolerSlider = slider({
    label: 'Cooler fans (manual)', min: 0, max: 1, step: 0.01, value: state.coolerManual,
    fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ coolerManual: { cpu: v, gpu: v } }),
  });
  coolerSlider.style.display = state.coolerAuto ? 'none' : '';
  panel.append(el('div', { class: 'section' },
    el('h2', {}, 'Fans & load'),
    slider({
      label: 'Case fan speed', min: 0, max: 1, step: 0.01, value: state.caseFanSpeed,
      fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ caseFanSpeed: v }),
    }),
    check('CPU/GPU fans follow temperature', state.coolerAuto, (on) => {
      coolerSlider.style.display = on ? 'none' : '';
      h.onConfig({ coolerAuto: { cpu: on, gpu: on } });
    }),
    coolerSlider,
    slider({
      label: 'CPU power', min: 15, max: 300, step: 5, value: state.power.cpu,
      fmt: (v) => `${v} W`, onInput: (v) => h.onConfig({ power: { cpu: v } }),
    }),
    slider({
      label: 'GPU power', min: 20, max: 500, step: 5, value: state.power.gpu,
      fmt: (v) => `${v} W`, onInput: (v) => h.onConfig({ power: { gpu: v } }),
    }),
    slider({
      label: 'Room temperature', min: 10, max: 40, step: 0.5, value: state.ambient,
      fmt: (v) => `${v.toFixed(1)}°C`, onInput: (v) => h.onConfig({ ambient: v }),
    }),
  ));

  // Visualization
  const v = state.view;
  panel.append(el('div', { class: 'section' },
    el('h2', {}, 'Particles'),
    check('Show streaks', v.particles, (on) => h.onView({ particles: on })),
    slider({
      label: 'Count', min: 500, max: 12000, step: 500, value: v.count,
      fmt: (x) => `${x}`, onInput: (x) => h.onView({ count: x }),
    }),
    el('div', { class: 'ctl' }, el('label', {}, 'Color by'),
      seg([['temperature', 'Temp'], ['speed', 'Speed'], ['source', 'Source']], v.color, (c) => h.onView({ color: c }), true)),
    slider({
      label: 'Seeded in volume (vs. at inlets)', min: 0, max: 1, step: 0.05, value: v.seedMix,
      fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => h.onView({ seedMix: x }),
    }),
  ));

  const slicePos = slider({
    label: 'Position', min: 0, max: 1, step: 0.01, value: v.slicePos,
    fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => h.onView({ slicePos: x }),
  });
  panel.append(el('div', { class: 'section' },
    el('h2', {}, 'Cross-section'),
    check('Show slice plane', v.slice, (on) => h.onView({ slice: on })),
    el('div', { class: 'ctl' }, el('label', {}, 'Field'),
      seg([['speed', 'Speed'], ['temperature', 'Temp'], ['pressure', 'Pressure']], v.sliceField, (c) => h.onView({ sliceField: c }), true)),
    el('div', { class: 'ctl' }, el('label', {}, 'Normal axis'),
      seg([['0', 'Side (X)'], ['1', 'Top (Y)'], ['2', 'Front (Z)']], String(v.sliceAxis), (c) => h.onView({ sliceAxis: +c }), true)),
    slicePos,
  ));

  const pauseBtn = el('button', { type: 'button', onclick: () => h.onPause() }, 'Pause');
  const resSel = el('select', {},
    ...['low', 'medium', 'high'].map((r) => {
      const o = el('option', { value: r }, r[0].toUpperCase() + r.slice(1));
      if (r === state.resolution) o.selected = true;
      return o;
    }));
  resSel.addEventListener('change', () => h.onResolution(resSel.value));
  const perf = el('div', { class: 'note' }, '');
  panel.append(el('div', { class: 'section' },
    el('h2', {}, 'Simulation'),
    slider({
      label: 'Time scale (slow motion)', min: 0.05, max: 1, step: 0.05, value: state.timeScale,
      fmt: (x) => `${x.toFixed(2)}×`, onInput: (x) => h.onConfig({ timeScale: x }),
    }),
    el('div', { class: 'ctl inline' }, el('label', {}, 'Grid resolution'), resSel),
    check('Buoyancy (hot air rises)', state.buoyancy, (on) => h.onConfig({ buoyancy: on })),
    check('Show case panels', v.panels, (on) => h.onView({ panels: on })),
    el('div', { class: 'row-buttons ctl' },
      pauseBtn,
      el('button', { type: 'button', onclick: () => h.onStep() }, 'Step'),
      el('button', { type: 'button', onclick: () => h.onReset() }, 'Reset heat'),
    ),
    perf,
  ));

  panel.append(el('div', { class: 'section' },
    el('h2', {}, 'How it works'),
    el('div', {
      class: 'note',
      html: `Air is solved as an incompressible flow on a staggered 3D grid with a pressure projection each step.
      Case fans follow a static-pressure curve, so they lose flow when vents are restrictive.
      Heatsinks are porous blocks with direction-dependent drag; their heat goes into the air passing through,
      which is then carried with the flow (energy is conserved).
      Open slots and the rear expansion slots act as passive vents, so a case with more intake than exhaust
      pushes air out through them (<b>positive pressure</b>), and the reverse pulls unfiltered air in.`,
    }),
  ));

  // ---- HUD + legend -------------------------------------------------------
  const temps = document.getElementById('hud-temps');
  const flow = document.getElementById('hud-flow');
  const legend = document.getElementById('legend');

  function updateLegend(view) {
    legend.innerHTML = '';
    const item = (title, fn, lo, hi, signed) => el('div', { class: 'legend-item' },
      el('div', { class: 'title' }, title),
      el('div', { class: 'bar', style: `background:${cssGradient(fn, signed)}` }),
      el('div', { class: 'ends' }, el('span', {}, lo), el('span', {}, hi)));
    if (view.particles) {
      if (view.color === 'temperature') legend.append(item('Streaks: air temperature', heat, 'room', '+20°C'));
      else if (view.color === 'speed') legend.append(item('Streaks: air speed', turbo, '0 m/s', '3 m/s'));
      else {
        const sw = el('div', { class: 'legend-swatches' });
        SLOTS.forEach((s, i) => {
          const c = SOURCE_COLORS[i % SOURCE_COLORS.length].map((x) => Math.round(x * 255));
          sw.append(el('span', { style: `--c: rgb(${c})` }, s.label.replace(/ \(.*\)/, '') + ' ' + (s.label.match(/\((.*)\)/)?.[1] ?? '')));
        });
        sw.append(el('span', { style: '--c: rgb(178,184,199)' }, 'passive vents'));
        legend.append(el('div', { class: 'legend-item' }, el('div', { class: 'title' }, 'Streaks: where the air came in'), sw));
      }
    }
    if (view.slice) {
      if (view.sliceField === 'speed') legend.append(item('Slice: air speed', turbo, '0 m/s', '3 m/s'));
      else if (view.sliceField === 'temperature') legend.append(item('Slice: air temperature', heat, 'room', '+20°C'));
      else {
        const it = item('Slice: pressure vs. room', diverging, '−', '+', true);
        it.querySelector('.ends').id = 'pressure-ends';
        legend.append(it);
      }
    }
  }
  updateLegend(v);

  // HUD is built once; updates only change text so nothing reflows or jumps.
  const row = (k) => {
    const v = el('span', { class: 'v' });
    return { node: el('div', { class: 'hud-row' }, el('span', { class: 'k' }, k), v), v };
  };
  const gauge = (label) => {
    const t = el('div', { class: 't' }, '–');
    const sub = el('div', { class: 's' }, '');
    const thr = el('div', { class: 'throttle' }, 'THROTTLING');
    return { node: el('div', { class: 'gauge' }, el('div', { class: 'l' }, label), t, sub, thr), t, sub, thr };
  };
  const hud = {
    cpu: gauge('CPU'), gpu: gauge('GPU'),
    air: row('Case air (avg)'), exh: row('Exhaust air'), hot: row('Hottest air'),
    fin: row('Fan intake'), fout: row('Fan exhaust'), vent: row('Passive in / out'), pres: row('Case pressure'),
  };
  const pill = el('span', { class: 'pill' });
  const presVal = el('span');
  hud.pres.v.append(presVal, pill);
  temps.append(el('div', { class: 'hud-big' }, hud.cpu.node, hud.gpu.node), hud.air.node, hud.exh.node, hud.hot.node);
  flow.append(hud.fin.node, hud.fout.node, hud.vent.node, hud.pres.node);

  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  function updateStats(s, extra) {
    if (!s) return;
    const g = s.groups;
    for (const [key, limit] of [['cpu', 100], ['gpu', 90]]) {
      const grp = g[key];
      const ui = hud[key];
      setText(ui.t, `${grp.die.toFixed(0)}°`);
      ui.t.style.color = tempColor(grp.die, limit);
      setText(ui.sub, `${grp.power.toFixed(0)} W · fan ${Math.round(grp.fan * 100)}%`);
      ui.thr.style.visibility = grp.throttle < 0.98 ? 'visible' : 'hidden';
      setText(ui.thr, `THROTTLING ${Math.round(grp.throttle * 100)}%`);
    }
    setText(hud.air.v, fmtT(s.airTemp));
    setText(hud.exh.v, fmtT(s.exhaustTemp));
    setText(hud.hot.v, fmtT(s.airMax));
    const cfm = (q) => `${(q * CFM_PER_M3S).toFixed(0)} CFM`;
    setText(hud.fin.v, cfm(s.fanIn));
    setText(hud.fout.v, cfm(s.fanOut));
    setText(hud.vent.v, `${(s.ventIn * CFM_PER_M3S).toFixed(0)} / ${(s.ventOut * CFM_PER_M3S).toFixed(0)}`);
    const p = s.pressure;
    setText(presVal, `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)} Pa`);
    const kind = Math.abs(p) < 0.15 ? 'neu' : p > 0 ? 'pos' : 'neg';
    pill.className = `pill ${kind}`;
    setText(pill, { neu: 'neutral', pos: 'positive', neg: 'negative' }[kind]);
    for (const f of s.fans) {
      if (f.kind !== 'case') continue;
      const r = slotRows[f.id];
      if (r) setText(r.cfm, `${f.cfm.toFixed(0)} CFM · against ${Math.max(0, f.dp).toFixed(1)} Pa`);
    }
    for (const slot of SLOTS) {
      if (!s.fans.some((f) => f.id === slot.id)) {
        const mode = state.modes[slot.id];
        setText(slotRows[slot.id].cfm, mode === 'open' ? 'passive vent' : mode === 'blocked' ? 'covered' : '—');
      }
    }
    const pe = document.getElementById('pressure-ends');
    if (pe && extra?.pressureRange) {
      pe.children[0].textContent = `−${extra.pressureRange.toFixed(1)} Pa`;
      pe.children[1].textContent = `+${extra.pressureRange.toFixed(1)} Pa`;
    }
    if (extra) setText(perf, `Grid ${extra.grid} · ${extra.stepMs.toFixed(1)} ms/step · ${extra.fps.toFixed(0)} fps · sim t = ${s.time?.toFixed(1) ?? '—'} s`);
  }

  return {
    updateStats,
    updateLegend,
    setModes(modes) { for (const [id, r] of Object.entries(slotRows)) r.seg.set(modes[id]); },
    setActivePreset(id) { for (const [k, b] of Object.entries(presetButtons)) b.classList.toggle('active', k === id); },
    setPaused(p) { pauseBtn.textContent = p ? 'Resume' : 'Pause'; },
  };
}
