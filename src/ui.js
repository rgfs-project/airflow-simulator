import { SLOTS, PRESETS, CFM_PER_M3S, GPUS, PSU_MODES, PSU, SLOT_MODES, CASE, CPU_COOLER, RAM, CASE_FAN } from './sim/model.js';
import { cssGradient, heat, turbo, diverging, SOURCE_COLORS } from './render/colormap.js';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

const P = {
  mark: '<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c-.6-3.2.6-6.4 3.4-6.4 2.4 0 2.6 3.6-1.8 6.6M13.6 12c3.2-.6 6.4.6 6.4 3.4 0 2.4-3.6 2.6-6.6-1.8M12 13.6c.6 3.2-.6 6.4-3.4 6.4-2.4 0-2.6-3.6 1.8-6.6M10.4 12c-3.2.6-6.4-.6-6.4-3.4 0-2.4 3.6-2.6 6.6 1.8"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  home: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (name) => el('span', { class: 'ico', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${P[name]}</svg>` });
const MODE_LABEL = { intake: 'In', exhaust: 'Out', open: 'Open', blocked: 'Shut' };
const tempTone = (t, limit) => (t >= limit - 2 ? 'bad' : t >= limit - 18 ? 'warm' : '');
const mm = (m) => `${Math.round(m * 1000)}`;

// ---------------------------------------------------------------------------
// Controls (sizes and type come from CSS tokens; one size for everything)
// ---------------------------------------------------------------------------
let uid = 0;
function slider({ label, min, max, step, value, fmt, onInput }) {
  const id = `ctl-${uid++}`;
  const val = el('output', { class: 'val', for: id }, fmt(value));
  const input = el('input', { type: 'range', id, min, max, step, value });
  const paint = () => input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    paint();
    onInput(v);
  });
  paint();
  const wrap = el('div', { class: 'ctl' }, el('label', { for: id }, el('span', {}, label), val), input);
  wrap.set = (v) => { input.value = v; val.textContent = fmt(v); paint(); };
  return wrap;
}

function seg(options, value, onPick, cls = '') {
  const wrap = el('div', { class: `seg ${cls}`, role: 'radiogroup' });
  const buttons = options.map(([key, label]) => {
    const b = el('button', { 'data-v': key, type: 'button', role: 'radio' }, label);
    b.addEventListener('click', () => { set(key); onPick(key); });
    wrap.append(b);
    return b;
  });
  const set = (v) => buttons.forEach((b) => {
    const on = b.dataset.v === String(v);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  set(value);
  wrap.set = set;
  return wrap;
}

function toggle(label, value, onChange) {
  const id = `ctl-${uid++}`;
  const input = el('input', { type: 'checkbox', id, role: 'switch' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const wrap = el('label', { class: 'toggle', for: id }, el('span', {}, label), input, el('span', { class: 'track', 'aria-hidden': 'true' }));
  wrap.set = (v) => { input.checked = v; };
  return wrap;
}

function select(id, options, value, onChange) {
  const s = el('select', { id }, ...options.map(([k, label]) => el('option', { value: k, selected: k === value }, label)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/** Spec-sheet item: muted label over a bright value. */
function spec(label, value) {
  const v = el('div', { class: 'spec-v' }, value ?? '–');
  return { node: el('div', { class: 'spec' }, el('div', { class: 'spec-k' }, label), v), v };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function buildUI(state, h) {
  const view = state.view;
  const presetIds = Object.keys(PRESETS);
  let presetIndex = 0;
  let gpuType = state.gpuType;
  let psuMode = state.psuMode;

  // ---- Top bar ------------------------------------------------------------------
  const playBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => h.onPause() }, icon('pause'), el('span', {}, 'Pause'));
  const navLink = (href, label) => el('a', { class: 'navlink', href }, label);
  document.getElementById('topbar').append(
    el('a', { class: 'title', href: '#overview' },
      el('span', { class: 'mark', html: `<svg viewBox="0 0 24 24">${P.mark}</svg>` }),
      el('span', { class: 'titles' }, el('b', {}, 'Airflow'), el('small', {}, 'PC case simulator'))),
    el('nav', { class: 'nav', 'aria-label': 'Sections' },
      navLink('#overview', 'Overview'), navLink('#controls', 'Controls'), navLink('#specs', 'Specs'), navLink('#about', 'How it works')),
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn soft icon', 'aria-label': 'Settings', title: 'Settings', onclick: () => openModal() }, icon('gear')),
      playBtn),
  );

  // ---- Stage overlays -----------------------------------------------------------------
  const live = el('span', { class: 'live' }, el('i'), el('b', {}, 'Live'));
  const gridTxt = el('span', {}, '');
  const fpsTxt = el('span', {}, '');
  document.getElementById('overlay-tl').append(el('div', { class: 'chip' }, live, gridTxt, fpsTxt));

  const colorNames = { temperature: 'temperature', speed: 'speed', source: 'source' };
  const pills = {};
  const pill = (key, label, onclick) => {
    pills[key] = el('button', { type: 'button', class: `btn glass pill-${key}`, 'aria-pressed': 'false', onclick }, label);
    return pills[key];
  };
  document.getElementById('overlay-bl').append(
    pill('particles', 'Streaks', () => setView({ particles: !view.particles })),
    pill('color', `Colour: ${colorNames[view.color]}`, () => {
      const order = ['temperature', 'speed', 'source'];
      setView({ color: order[(order.indexOf(view.color) + 1) % order.length], particles: true });
    }),
    pill('slice', 'Plane', () => setView({ slice: !view.slice })),
    pill('panels', 'Panels', () => setView({ panels: !view.panels })),
    pill('dims', 'Dimensions', () => setView({ dims: !view.dims })),
  );
  document.getElementById('overlay-br').append(
    el('button', { type: 'button', class: 'btn glass icon', 'aria-label': 'Zoom in', onclick: () => h.onCamera('in') }, icon('plus')),
    el('button', { type: 'button', class: 'btn glass icon', 'aria-label': 'Zoom out', onclick: () => h.onCamera('out') }, icon('minus')),
    el('button', { type: 'button', class: 'btn glass icon', 'aria-label': 'Reset view', onclick: () => h.onCamera('home') }, icon('home')),
  );

  // ---- Preset bar ---------------------------------------------------------------------
  const presetTitle = el('b', {}, '');
  const presetHint = el('span', {}, '');
  const stepPreset = (d) => {
    presetIndex = (presetIndex + d + presetIds.length) % presetIds.length;
    h.onPreset(presetIds[presetIndex]);
  };
  document.getElementById('presetbar').append(
    el('div', { class: 'caption' }, el('span', { class: 'eyebrow' }, 'Preset'), el('p', {}, presetTitle, ' ', presetHint)),
    el('div', { class: 'arrows' },
      el('button', { type: 'button', class: 'btn soft icon', 'aria-label': 'Previous preset', onclick: () => stepPreset(-1) }, icon('left')),
      el('button', { type: 'button', class: 'btn soft icon', 'aria-label': 'Next preset', onclick: () => stepPreset(1) }, icon('right'))),
  );

  // ---- Live numbers (big-number column) ---------------------------------------------------
  const big = {};
  const bigStat = (key, prefix) => {
    const num = el('span', { class: 'n' }, '–');
    const unit = el('span', { class: 'unit' }, '');
    const value = el('div', { class: 'big' }, num, unit);
    const cap = el('div', { class: 'cap' }, '');
    big[key] = { value, num, unit, cap };
    return el('div', { class: 'bigstat' }, el('div', { class: 'pre' }, prefix), value, cap);
  };
  document.getElementById('live').append(
    bigStat('cpu', 'CPU die'), bigStat('gpu', 'GPU die'), bigStat('flow', 'Air through the case'), bigStat('pressure', 'Case pressure'),
  );
  const setBig = (key, num, unit) => { setText(big[key].num, num); setText(big[key].unit, unit); };

  // ---- Sections -------------------------------------------------------------------------
  const sections = document.getElementById('sections');
  const section = (id, title, lede, ...kids) => el('section', { class: 'block', id },
    el('div', { class: 'block-head' }, el('h2', {}, title), lede ? el('p', { class: 'lede' }, lede) : null), ...kids);

  const presetSel = select('preset', [['', 'Custom'], ...presetIds.map((id) => [id, PRESETS[id].label])], 'balanced', (id) => { if (id) h.onPreset(id); });
  const slotRows = {};
  const slotGrid = el('div', { class: 'grid4' });
  for (const slot of SLOTS) {
    const dot = el('i', { class: 'dot' });
    const cfm = el('div', { class: 'spec-v' }, '—');
    const s = seg(SLOT_MODES.map((m) => [m, MODE_LABEL[m]]), state.modes[slot.id], (m) => h.onMode(slot.id, m), 'wide');
    slotRows[slot.id] = { seg: s, cfm, dot };
    slotGrid.append(el('div', { class: 'slot' }, el('div', { class: 'spec-k' }, dot, slot.label), cfm, s));
  }

  const coolerSlider = slider({
    label: 'Cooler fans (manual)', min: 0, max: 1, step: 0.01, value: state.coolerManual,
    fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ coolerManual: { cpu: v, gpu: v } }),
  });
  coolerSlider.hidden = state.coolerAuto;

  const air = {};
  const airSpec = (key, label) => { const s = spec(label); air[key] = s.v; return s.node; };

  const buildGpu = spec('Graphics card');
  const buildPsu = spec('Power supply');
  const refreshBuild = () => {
    setText(buildGpu.v, gpuType === 'blower' ? 'Workstation blower, 267 × 111 × 40 mm, 300 W' : 'Open-air with 3 fans, 300 W');
    setText(buildPsu.v, `${PSU.rating} W, ${mm(PSU.max[0] - PSU.min[0])} × 86 × ${mm(PSU.max[2])} mm, fan ${psuMode === 'up' ? 'up' : 'down'}`);
  };

  sections.append(
    section('controls', 'Fan slots', 'Set each slot to intake, exhaust, an open vent or shut. You can also click a slot on the 3D case.',
      el('div', { class: 'grid3 head-ctl' }, el('div', { class: 'ctl' }, el('label', { for: 'preset' }, 'Preset'), presetSel)),
      slotGrid),
    section('load', 'Load and hardware', null,
      el('div', { class: 'grid3' },
        slider({ label: 'Case fan speed', min: 0, max: 1, step: 0.05, value: state.caseFanSpeed, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ caseFanSpeed: v }) }),
        slider({ label: 'CPU power', min: 15, max: 300, step: 5, value: state.power.cpu, fmt: (v) => `${v} W`, onInput: (v) => h.onConfig({ power: { cpu: v } }) }),
        slider({ label: 'GPU power', min: 20, max: 500, step: 5, value: state.power.gpu, fmt: (v) => `${v} W`, onInput: (v) => h.onConfig({ power: { gpu: v } }) }),
        slider({ label: 'Room temperature', min: 10, max: 40, step: 0.5, value: state.ambient, fmt: (v) => `${v.toFixed(1)}°C`, onInput: (v) => h.onConfig({ ambient: v }) }),
        el('div', { class: 'ctl' }, el('label', { for: 'gpu-type' }, 'Graphics card'),
          select('gpu-type', Object.entries(GPUS).map(([id, g]) => [id, g.label]), state.gpuType, (v) => { gpuType = v; refreshBuild(); h.onGpu(v); })),
        el('div', { class: 'ctl' }, el('label', { for: 'psu-mode' }, 'Power supply'),
          select('psu-mode', Object.entries(PSU_MODES), state.psuMode, (v) => { psuMode = v; refreshBuild(); h.onPsu(v); })),
        toggle('CPU and GPU fans follow temperature', state.coolerAuto, (on) => { coolerSlider.hidden = on; h.onConfig({ coolerAuto: { cpu: on, gpu: on } }); }),
        coolerSlider)),
    section('specs', 'Airflow', 'Live values from the simulation.',
      el('div', { class: 'grid3' },
        airSpec('fanIn', 'Fan intake'), airSpec('fanOut', 'Fan exhaust'), airSpec('gpuOut', 'GPU blower to rear'),
        airSpec('vent', 'Passive in / out'), airSpec('air', 'Case air'), airSpec('exh', 'Exhaust air'),
        airSpec('hot', 'Hottest air'), airSpec('load', 'System load'), airSpec('psu', 'Power supply'))),
    section('build', 'Build', null,
      el('div', { class: 'grid3' },
        spec('Case (W × H × D)', `${mm(CASE.W)} × ${mm(CASE.H)} × ${mm(CASE.D)} mm`).node,
        spec('Case fans', `${SLOTS.length} slots, ${mm(SLOTS[0].size)} mm, up to ${Math.round(CASE_FAN.qMax * CFM_PER_M3S)} CFM`).node,
        spec('CPU cooler', `Single tower, ${mm(CPU_COOLER.base - CPU_COOLER.top)} × 125 × 112 mm, 2 × 120 mm fans`).node,
        buildGpu.node,
        spec('Memory', `4 × DDR5, ${(RAM.len * 1000).toFixed(2)} × ${(RAM.h * 1000).toFixed(2)} mm`).node,
        buildPsu.node)),
    section('about', 'How it works', null,
      el('div', { class: 'grid3 prose' },
        el('p', {}, 'Air is computed as an incompressible flow on a staggered 3D grid, with a pressure projection every step. Fans follow static-pressure curves, so they lose flow against restrictive vents.'),
        el('p', {}, 'Heatsinks are porous blocks with direction-dependent drag. Their heat is carried away by the air passing through, and energy is conserved.'),
        el('p', {}, 'Open slots and expansion-slot covers are passive vents. More intake than exhaust pushes air out through them (positive pressure); the reverse pulls unfiltered air in.'))),
  );
  refreshBuild();

  // ---- Settings dialog --------------------------------------------------------------------
  const modalRoot = document.getElementById('modal-root');
  const viewCtl = {
    color: seg([['temperature', 'Temperature'], ['speed', 'Speed'], ['source', 'Source']], view.color, (c) => setView({ color: c }), 'wide'),
    count: slider({ label: 'Streak count', min: 500, max: 12000, step: 500, value: view.count, fmt: (x) => `${x}`, onInput: (x) => setView({ count: x }) }),
    seedMix: slider({ label: 'Seeded in volume vs. at inlets', min: 0, max: 1, step: 0.05, value: view.seedMix, fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => setView({ seedMix: x }) }),
    sliceField: seg([['speed', 'Speed'], ['temperature', 'Temperature'], ['pressure', 'Pressure']], view.sliceField, (c) => setView({ sliceField: c, slice: true }), 'wide'),
    sliceAxis: seg([['0', 'Side'], ['1', 'Top'], ['2', 'Front']], String(view.sliceAxis), (c) => setView({ sliceAxis: +c, slice: true }), 'wide'),
    slicePos: slider({ label: 'Plane position', min: 0, max: 1, step: 0.01, value: view.slicePos, fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => setView({ slicePos: x }) }),
  };
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-h' },
    el('button', { type: 'button', class: 'btn soft icon closebtn', 'aria-label': 'Close', onclick: () => closeModal() }, icon('close')),
    el('h1', { id: 'settings-h' }, 'Tune the simulation.'),
    el('div', { class: 'cols' },
      el('div', {},
        el('h3', { class: 'eyebrow' }, 'Streaks'),
        el('div', { class: 'ctl' }, el('label', {}, 'Colour by'), viewCtl.color),
        viewCtl.count, viewCtl.seedMix),
      el('div', {},
        el('h3', { class: 'eyebrow' }, 'Cross-section'),
        el('div', { class: 'ctl' }, el('label', {}, 'Shows'), viewCtl.sliceField),
        el('div', { class: 'ctl' }, el('label', {}, 'Faces'), viewCtl.sliceAxis),
        viewCtl.slicePos)),
    el('hr'),
    el('div', { class: 'cols' },
      el('div', {},
        el('h3', { class: 'eyebrow' }, 'Simulation'),
        slider({ label: 'Time scale (slow motion)', min: 0.05, max: 1, step: 0.05, value: state.timeScale, fmt: (x) => `${x.toFixed(2)}×`, onInput: (x) => h.onConfig({ timeScale: x }) }),
        toggle('Buoyancy (hot air rises)', state.buoyancy, (on) => h.onConfig({ buoyancy: on }))),
      el('div', {},
        el('h3', { class: 'eyebrow' }, 'Accuracy'),
        el('div', { class: 'ctl' }, el('label', { for: 'grid-res' }, 'Grid resolution'),
          select('grid-res', [['low', 'Low (fastest)'], ['medium', 'Medium'], ['high', 'High (slowest)']], state.resolution, (r) => h.onResolution(r))))),
    el('div', { class: 'dialog-actions' },
      el('button', { type: 'button', class: 'btn primary', onclick: () => closeModal() }, 'Done'),
      el('button', { type: 'button', class: 'btn soft', onclick: () => { h.onReset(); closeModal(); } }, 'Reset heat')));
  let isOpen = false;
  let lastFocus = null;
  function openModal() {
    lastFocus = document.activeElement;
    isOpen = true;
    const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) closeModal(); } }, dialog);
    modalRoot.replaceChildren(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
    dialog.querySelector('.closebtn').focus();
  }
  function closeModal() {
    if (!isOpen) return;
    isOpen = false;
    modalRoot.replaceChildren();
    lastFocus?.focus?.();
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function syncPills() {
    for (const k of ['particles', 'slice', 'panels', 'dims']) {
      pills[k].classList.toggle('on', !!view[k]);
      pills[k].setAttribute('aria-pressed', String(!!view[k]));
    }
  }
  function setView(patch) {
    h.onView(patch);
    syncPills();
    setText(pills.color, `Colour: ${colorNames[view.color]}`);
    for (const [k, ctl] of Object.entries(viewCtl)) ctl.set?.(k === 'sliceAxis' ? String(view[k]) : view[k]);
  }

  // ---- Legend & toast -----------------------------------------------------------------------
  const legend = document.getElementById('legend');
  function updateLegend(v) {
    legend.innerHTML = '';
    const item = (title, fn, lo, hi, signed) => el('div', { class: 'legend-item' },
      el('div', { class: 'lg-title' }, title),
      el('div', { class: 'bar', style: `background:${cssGradient(fn, signed)}` }),
      el('div', { class: 'ends' }, el('span', {}, lo), el('span', {}, hi)));
    if (v.particles) {
      if (v.color === 'temperature') legend.append(item('Air temperature', heat, 'Room', '+20°C'));
      else if (v.color === 'speed') legend.append(item('Air speed', turbo, '0 m/s', '3 m/s'));
      else {
        const sw = el('div', { class: 'swatches' });
        SLOTS.forEach((s, i) => {
          const c = SOURCE_COLORS[i % SOURCE_COLORS.length].map((x) => Math.round(x * 255 * 0.8));
          sw.append(el('span', { style: `--c: rgb(${c})` }, s.label.replace(/ \((.*)\)/, ' $1')));
        });
        sw.append(el('span', { style: '--c: rgb(140,146,160)' }, 'Vents'));
        legend.append(el('div', { class: 'legend-item' }, el('div', { class: 'lg-title' }, 'Where air came in'), sw));
      }
    }
    if (v.slice) {
      if (v.sliceField === 'speed') legend.append(item('Plane: speed', turbo, '0 m/s', '3 m/s'));
      else if (v.sliceField === 'temperature') legend.append(item('Plane: temperature', heat, 'Room', '+20°C'));
      else {
        const it = item('Plane: pressure', diverging, '−', '+', true);
        it.querySelector('.ends').id = 'pressure-ends';
        legend.append(it);
      }
    }
  }
  updateLegend(view);

  const toastEl = document.getElementById('toast');
  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  // ---- Live updates ------------------------------------------------------------------------
  function updateStats(s, extra) {
    if (!s) return;
    const g = s.groups;
    const cfm = (q) => (q * CFM_PER_M3S).toFixed(0);
    for (const [key, limit] of [['cpu', 100], ['gpu', 90]]) {
      const grp = g[key];
      setBig(key, grp.die.toFixed(0), '°C');
      big[key].value.dataset.tone = tempTone(grp.die, limit);
      const fan = grp.fan < 0.02 ? 'fan off' : `fan ${Math.round(grp.fan * 100)}%`;
      setText(big[key].cap, `${grp.power.toFixed(0)} W, ${fan}${grp.throttle < 0.98 ? ', throttling' : ''}`);
    }
    setBig('flow', cfm(s.totalIn), 'CFM');
    setText(big.flow.cap, `${cfm(s.totalOut)} CFM out, ${s.airTemp.toFixed(1)}°C inside`);
    const p = s.pressure;
    const kind = Math.abs(p) < 0.15 ? 'neu' : p > 0 ? 'pos' : 'neg';
    setBig('pressure', `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)}`, 'Pa');
    big.pressure.value.dataset.tone = kind;
    setText(big.pressure.cap, { neu: 'Neutral: in and out are balanced', pos: 'Positive: air is pushed out of gaps', neg: 'Negative: unfiltered air leaks in' }[kind]);

    setText(air.fanIn, `${cfm(s.fanIn)} CFM`);
    setText(air.fanOut, `${cfm(s.fanOut)} CFM`);
    setText(air.gpuOut, s.gpuType === 'blower' ? `${cfm(s.gpuOut)} CFM` : '—');
    setText(air.vent, `${cfm(s.ventIn)} / ${cfm(s.ventOut)} CFM`);
    setText(air.air, `${s.airTemp.toFixed(1)}°C`);
    setText(air.exh, `${s.exhaustTemp.toFixed(1)}°C`);
    setText(air.hot, `${s.airMax.toFixed(1)}°C`);
    setText(air.load, `${s.psuLoad.toFixed(0)} W, ${(s.psuEff * 100).toFixed(1)}% efficient`);
    if (g.psu) setText(air.psu, `${g.psu.die.toFixed(0)}°C, ${g.psu.fan < 0.02 ? 'fan off' : `fan ${Math.round(g.psu.fan * 100)}%`}`);

    for (const f of s.fans) {
      if (f.kind !== 'case') continue;
      const r = slotRows[f.id];
      if (r) setText(r.cfm, `${f.cfm.toFixed(0)} CFM`);
    }
    for (const slot of SLOTS) {
      if (!s.fans.some((f) => f.id === slot.id)) {
        const mode = state.modes[slot.id];
        setText(slotRows[slot.id].cfm, mode === 'open' ? 'Passive vent' : mode === 'blocked' ? 'Covered' : '—');
      }
    }
    const pe = document.getElementById('pressure-ends');
    if (pe && extra?.pressureRange) {
      pe.children[0].textContent = `−${extra.pressureRange.toFixed(1)} Pa`;
      pe.children[1].textContent = `+${extra.pressureRange.toFixed(1)} Pa`;
    }
    if (extra) {
      setText(gridTxt, extra.grid);
      setText(fpsTxt, `${extra.fps.toFixed(0)} fps`);
    }
  }

  queueMicrotask(syncPills);
  return {
    updateStats,
    updateLegend,
    toast,
    setModes(modes) {
      for (const [id, r] of Object.entries(slotRows)) {
        r.seg.set(modes[id]);
        r.dot.dataset.mode = modes[id];
      }
    },
    setActivePreset(id) {
      presetSel.value = id || '';
      if (id) presetIndex = presetIds.indexOf(id);
      setText(presetTitle, id ? `${PRESETS[id].label}.` : 'Custom.');
      setText(presetHint, id ? `${PRESETS[id].hint[0].toUpperCase()}${PRESETS[id].hint.slice(1)}.` : 'Your own fan layout.');
    },
    setPaused(p) {
      playBtn.replaceChildren(icon(p ? 'play' : 'pause'), el('span', {}, p ? 'Resume' : 'Pause'));
      live.classList.toggle('paused', p);
      setText(live.lastChild, p ? 'Paused' : 'Live');
    },
    setCount(n) { viewCtl.count.set(n); },
  };
}
