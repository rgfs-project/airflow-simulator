import { SLOTS, PRESETS, CFM_PER_M3S, GPUS, PSU_MODES, PSU, SLOT_MODES } from './sim/model.js';
import { cssGradient, heat, turbo, diverging, SOURCE_COLORS } from './render/colormap.js';

// ---------------------------------------------------------------------------
// Tiny DOM helpers
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

// Thin line icons (24 x 24, 1.75 stroke).
const P = {
  fan: '<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c-.6-3.2.6-6.4 3.4-6.4 2.4 0 2.6 3.6-1.8 6.6M13.6 12c3.2-.6 6.4.6 6.4 3.4 0 2.4-3.6 2.6-6.6-1.8M12 13.6c.6 3.2-.6 6.4-3.4 6.4-2.4 0-2.6-3.6 1.8-6.6M10.4 12c-3.2.6-6.4-.6-6.4-3.4 0-2.4 3.6-2.6 6.6 1.8"/>',
  case: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h6M9 10h6"/><circle cx="12" cy="16" r="2"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  slice: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5" opacity=".5"/>',
  play: '<path d="M7 5v14l11-7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  home: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  in: '<path d="M4 12h12M11 7l5 5-5 5"/><path d="M20 4v16"/>',
  out: '<path d="M8 12h12M15 7l5 5-5 5"/><path d="M4 4v16"/>',
  grill: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h8"/>',
  shut: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 4l16 16"/>',
  warn: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>',
  auto: '<path d="M4 17 9 7l5 10M6 13h6"/><path d="M16 7h4M18 7v10"/>',
  reset: '<path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 1.6-7.4L4 10"/>',
  step: '<path d="M6 5v14l9-7z"/><path d="M18 5v14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  gpu: '<rect x="2" y="6" width="20" height="11" rx="2"/><circle cx="15" cy="11.5" r="3"/><path d="M5 17v3M9 17v3"/>',
};
const icon = (name, cls = '') => el('span', { class: `ico ${cls}`, 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${P[name]}</svg>` });

const MODE_ICON = { intake: 'in', exhaust: 'out', open: 'grill', blocked: 'shut' };
const MODE_LABEL = { intake: 'In', exhaust: 'Out', open: 'Open', blocked: 'Shut' };
const tempColor = (t, limit) => (t >= limit - 2 ? 'var(--bad)' : t >= limit - 18 ? 'var(--warn)' : 'var(--text)');

// ---------------------------------------------------------------------------
// Controls
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
    b.addEventListener('click', (e) => { e.stopPropagation(); set(key); onPick(key); });
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

/** Big number with chevrons above and below (dock style). */
function stepper({ label, value, fmt, step, min, max, onChange }) {
  let v = value;
  const num = el('div', { class: 'num' }, fmt(v));
  const set = (nv, emit = true) => {
    v = Math.max(min, Math.min(max, Math.round(nv / step) * step));
    setText(num, fmt(v));
    if (emit) onChange(v);
  };
  const wrap = el('div', { class: 'stepper' },
    el('button', { type: 'button', class: 'chev', 'aria-label': `${label} up`, onclick: () => set(v + step) }, icon('up')),
    num,
    el('div', { class: 'cap' }, label),
    el('button', { type: 'button', class: 'chev', 'aria-label': `${label} down`, onclick: () => set(v - step) }, icon('down')));
  wrap.set = (nv) => set(nv, false);
  return wrap;
}

function card(id, title, { closable = true, onClose } = {}, ...body) {
  const c = el('section', { class: 'card', id, 'aria-label': title },
    el('header', {}, el('h2', {}, title),
      closable ? el('button', { type: 'button', class: 'iconbtn', 'aria-label': `Close ${title}`, onclick: () => onClose?.() }, icon('close')) : null),
    el('div', { class: 'card-body' }, ...body));
  return c;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function buildUI(state, h) {
  const view = state.view;
  const cfg = {
    ambient: state.ambient, fan: state.caseFanSpeed, cpu: state.power.cpu, gpu: state.power.gpu,
    auto: state.coolerAuto, paused: false,
  };
  const mq = matchMedia('(max-width: 800px), (pointer: coarse) and (max-height: 520px)');
  const isPhone = () => mq.matches;

  // ---- Cluster (left instrument panel) ----------------------------------------
  const cluster = document.getElementById('cluster');
  const warnIco = icon('warn', 'warn');
  const autoIco = el('span', { class: 'mono autoico', title: 'CPU/GPU fans follow temperature' }, 'AUTO');
  const cpuBig = el('div', { class: 'bignum' }, '–');
  const gpuSmall = el('b', {}, '–');
  const psuSmall = el('b', {}, '–');
  const pressMarker = el('i', { class: 'marker' });
  const pressText = el('span', { class: 'mono' }, '');
  const fanCircle = el('div', { class: 'circle' }, `${Math.round(cfg.fan * 100)}`);
  const roomBadge = el('b', {}, `${cfg.ambient}`);
  const flowIn = el('div', { class: 'bigflow' }, '–');
  const flowOut = el('div', { class: 'bigflow' }, '–');
  const kv = {};
  const kvRow = (key, label) => { kv[key] = el('span', { class: 'v' }, '–'); return el('div', { class: 'kv' }, el('span', { class: 'k' }, label), kv[key]); };
  const throttleNote = el('div', { class: 'throttle mono' }, '');

  const setFan = (v) => {
    cfg.fan = Math.max(0, Math.min(1, Math.round(v * 20) / 20));
    setText(fanCircle, `${Math.round(cfg.fan * 100)}`);
    dockFan.set(Math.round(cfg.fan * 100));
    fanSlider.set(cfg.fan);
    h.onConfig({ caseFanSpeed: cfg.fan });
  };
  const setRoom = (v) => {
    cfg.ambient = v;
    setText(roomBadge, `${v}`);
    dockRoom.set(v);
    roomSlider.set(v);
    h.onConfig({ ambient: v });
  };

  cluster.append(
    el('div', { class: 'cl-top' }, warnIco, el('div', { class: 'brand' }, el('span', { class: 'mark', html: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c-.6-3.2.6-6.4 3.4-6.4 2.4 0 2.6 3.6-1.8 6.6M13.6 12c3.2-.6 6.4.6 6.4 3.4 0 2.4-3.6 2.6-6.6-1.8M12 13.6c.6 3.2-.6 6.4-3.4 6.4-2.4 0-2.6-3.6 1.8-6.6M10.4 12c-3.2.6-6.4-.6-6.4-3.4 0-2.4 3.6-2.6 6.6 1.8"/></svg>' }), 'Airflow'), autoIco),
    el('div', { class: 'cl-hero' }, cpuBig,
      el('div', { class: 'cl-row' },
        el('span', { class: 'side' }, el('span', { class: 'mono' }, 'GPU '), gpuSmall),
        el('span', { class: 'mono unit' }, 'CPU °C'),
        el('span', { class: 'side right' }, el('span', { class: 'mono' }, 'PSU '), psuSmall)),
      el('div', { class: 'pressure', title: 'Case pressure relative to the room' },
        el('div', { class: 'line' }, pressMarker),
        el('div', { class: 'ends mono' }, el('span', {}, 'NEG'), pressText, el('span', {}, 'POS'))),
      throttleNote),
    el('div', { class: 'cl-controls' },
      el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Case fans slower', onclick: () => setFan(cfg.fan - 0.05) }, icon('minus')),
      el('div', { class: 'fanset' }, fanCircle, el('span', { class: 'mono' }, 'FAN %')),
      el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Case fans faster', onclick: () => setFan(cfg.fan + 0.05) }, icon('plus')),
      el('div', { class: 'badge', title: 'Room temperature' }, el('span', { class: 'mono' }, 'ROOM'), roomBadge, el('span', { class: 'mono' }, '°C'))),
    el('div', { class: 'cl-flow' },
      el('div', { class: 'flowcol' }, flowIn, el('span', { class: 'mono' }, 'CFM IN')),
      el('div', { class: 'flowcol' }, flowOut, el('span', { class: 'mono' }, 'CFM OUT'))),
    el('div', { class: 'cl-list' },
      kvRow('air', 'Case air'), kvRow('exh', 'Exhaust air'), kvRow('hot', 'Hottest air'),
      kvRow('gpuOut', 'GPU blower → rear'), kvRow('vent', 'Passive in / out'), kvRow('load', 'System load'), kvRow('fans', 'CPU / GPU fans')),
    el('div', { class: 'cl-bottom' },
      el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Reset heat', title: 'Reset heat', onclick: () => h.onReset() }, icon('reset')),
      el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'Step once', title: 'Step', onclick: () => h.onStep() }, icon('step')),
      el('button', { type: 'button', class: 'iconbtn', 'aria-label': 'How it works', title: 'How it works', onclick: () => openCard('about') }, icon('info'))),
  );

  // ---- Status bar --------------------------------------------------------------
  const statusbar = document.getElementById('statusbar');
  const live = el('span', { class: 'live' }, el('i'), 'LIVE');
  const gridTxt = el('span', {}, '');
  const fpsTxt = el('span', {}, '');
  const timeTxt = el('span', {}, '');
  const roomTxt = el('span', {}, '');
  statusbar.append(el('div', { class: 'grp' }, live, gridTxt, fpsTxt), el('div', { class: 'grp' }, roomTxt, timeTxt));

  // ---- Cards -------------------------------------------------------------------
  const cards = document.getElementById('cards');
  const open = new Set();
  const cardEls = {};
  function openCard(name, force) {
    const want = force ?? !open.has(name);
    if (want) {
      // Only one card at a time on phones; the fan card can sit beside settings on desktop.
      if (isPhone()) for (const n of [...open]) if (n !== name) closeCard(n);
      open.add(name);
    } else open.delete(name);
    cardEls[name].classList.toggle('open', want);
    dockBtns[name]?.classList.toggle('on', want);
    document.getElementById('viewport').classList.toggle('card-open', open.size > 0);
    layoutChanged();
  }
  const closeCard = (name) => openCard(name, false);

  // Fan slots card (like a turn-by-turn list).
  const presetName = el('b', {}, PRESETS.balanced.label);
  const presetMenu = el('div', { class: 'preset-menu' });
  const presetButtons = {};
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = el('button', { type: 'button', class: 'preset', onclick: () => { h.onPreset(id); presetMenu.classList.remove('open'); } },
      el('b', {}, p.label), el('small', {}, p.hint));
    presetButtons[id] = b;
    presetMenu.append(b);
  }
  const presetPill = el('button', { type: 'button', class: 'pillbar', 'aria-haspopup': 'true', onclick: () => presetMenu.classList.toggle('open') },
    icon('fan'), el('span', { class: 'mono' }, 'PRESET'), presetName, icon('right', 'end'));
  const slotRows = {};
  const slotList = el('div', { class: 'slots' });
  for (const slot of SLOTS) {
    const ico = el('span', { class: 'slot-ico' });
    const cfm = el('div', { class: 'cfm' }, '—');
    const s = seg(SLOT_MODES.map((m) => [m, MODE_LABEL[m]]), state.modes[slot.id], (m) => h.onMode(slot.id, m), 'mini');
    slotRows[slot.id] = { seg: s, cfm, ico };
    slotList.append(el('div', { class: 'slot' }, ico, el('div', { class: 'txt' }, cfm, el('div', { class: 'name' }, slot.label)), s));
  }
  const sumIn = el('span', {}, '–');
  const sumOut = el('span', {}, '–');
  const sumP = el('span', {}, '–');
  cardEls.fans = card('card-fans', 'Fan slots', { onClose: () => closeCard('fans') },
    el('div', { class: 'preset-wrap' }, presetPill, presetMenu),
    slotList,
    el('div', { class: 'card-foot' }, sumIn, sumOut, sumP));

  // Settings card.
  const coolerSlider = slider({
    label: 'Cooler fans (manual)', min: 0, max: 1, step: 0.01, value: state.coolerManual,
    fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ coolerManual: { cpu: v, gpu: v } }),
  });
  coolerSlider.hidden = cfg.auto;
  const fanSlider = slider({
    label: 'Case fan speed', min: 0, max: 1, step: 0.05, value: cfg.fan,
    fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { cfg.fan = v; setText(fanCircle, `${Math.round(v * 100)}`); dockFan.set(Math.round(v * 100)); h.onConfig({ caseFanSpeed: v }); },
  });
  const roomSlider = slider({
    label: 'Room temperature', min: 10, max: 40, step: 1, value: cfg.ambient,
    fmt: (v) => `${v}°C`, onInput: (v) => { cfg.ambient = v; setText(roomBadge, `${v}`); dockRoom.set(v); h.onConfig({ ambient: v }); },
  });
  const cpuSlider = slider({
    label: 'CPU power', min: 15, max: 300, step: 5, value: cfg.cpu,
    fmt: (v) => `${v} W`, onInput: (v) => { cfg.cpu = v; dockCpu.set(v); h.onConfig({ power: { cpu: v } }); },
  });
  const gpuSlider = slider({
    label: 'GPU power', min: 20, max: 500, step: 5, value: cfg.gpu,
    fmt: (v) => `${v} W`, onInput: (v) => { cfg.gpu = v; dockGpu.set(v); h.onConfig({ power: { gpu: v } }); },
  });
  const autoToggle = toggle('CPU/GPU fans follow temperature', cfg.auto, (on) => {
    cfg.auto = on;
    coolerSlider.hidden = on;
    autoIco.classList.toggle('on', on);
    h.onConfig({ coolerAuto: { cpu: on, gpu: on } });
  });
  autoIco.classList.toggle('on', cfg.auto);
  const viewCtl = {
    particles: toggle('Air streaks', view.particles, (on) => setView({ particles: on })),
    color: seg([['temperature', 'Temp'], ['speed', 'Speed'], ['source', 'Source']], view.color, (c) => setView({ color: c }), 'wide'),
    count: slider({ label: 'Streak count', min: 500, max: 12000, step: 500, value: view.count, fmt: (x) => `${x}`, onInput: (x) => setView({ count: x }) }),
    seedMix: slider({ label: 'Seeded in volume vs. at inlets', min: 0, max: 1, step: 0.05, value: view.seedMix, fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => setView({ seedMix: x }) }),
    slice: toggle('Cross-section plane', view.slice, (on) => setView({ slice: on })),
    sliceField: seg([['speed', 'Speed'], ['temperature', 'Temp'], ['pressure', 'Pressure']], view.sliceField, (c) => setView({ sliceField: c }), 'wide'),
    sliceAxis: seg([['0', 'Side'], ['1', 'Top'], ['2', 'Front']], String(view.sliceAxis), (c) => setView({ sliceAxis: +c }), 'wide'),
    slicePos: slider({ label: 'Plane position', min: 0, max: 1, step: 0.01, value: view.slicePos, fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => setView({ slicePos: x }) }),
    panels: toggle('Case panels', view.panels, (on) => setView({ panels: on })),
  };
  const group = (title, ...kids) => el('div', { class: 'group' }, el('div', { class: 'mono glabel' }, title), ...kids);
  cardEls.settings = card('card-settings', 'Settings', { onClose: () => closeCard('settings') },
    group('HARDWARE',
      el('div', { class: 'ctl' }, el('label', { for: 'gpu-type' }, 'Graphics card'),
        select('gpu-type', Object.entries(GPUS).map(([id, g]) => [id, g.label]), state.gpuType, (v) => h.onGpu(v))),
      el('div', { class: 'ctl' }, el('label', { for: 'psu-mode' }, `Power supply · ${PSU.rating} W`),
        select('psu-mode', Object.entries(PSU_MODES), state.psuMode, (v) => h.onPsu(v)))),
    group('LOAD & FANS', cpuSlider, gpuSlider, fanSlider, roomSlider, autoToggle, coolerSlider),
    group('VIEW', viewCtl.particles,
      el('div', { class: 'ctl' }, el('label', {}, 'Colour streaks by'), viewCtl.color),
      viewCtl.count, viewCtl.seedMix, viewCtl.slice,
      el('div', { class: 'ctl' }, el('label', {}, 'Plane shows'), viewCtl.sliceField),
      el('div', { class: 'ctl' }, el('label', {}, 'Plane faces'), viewCtl.sliceAxis),
      viewCtl.slicePos, viewCtl.panels),
    group('SIMULATION',
      slider({ label: 'Time scale (slow motion)', min: 0.05, max: 1, step: 0.05, value: state.timeScale, fmt: (x) => `${x.toFixed(2)}×`, onInput: (x) => h.onConfig({ timeScale: x }) }),
      el('div', { class: 'ctl' }, el('label', { for: 'grid-res' }, 'Grid resolution'),
        select('grid-res', [['low', 'Low · fastest'], ['medium', 'Medium'], ['high', 'High · slowest']], state.resolution, (r) => h.onResolution(r))),
      toggle('Buoyancy (hot air rises)', state.buoyancy, (on) => h.onConfig({ buoyancy: on })),
      el('div', { class: 'btnrow' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => h.onReset() }, 'Reset heat'),
        el('button', { type: 'button', class: 'btn ghost', onclick: () => h.onStep() }, 'Step once'))),
  );

  cardEls.about = card('card-about', 'How it works', { onClose: () => closeCard('about') },
    el('p', { class: 'lead' }, 'A real fluid solve, not an animation.'),
    el('p', {}, 'Air is computed as an incompressible flow on a staggered 3D grid, with a pressure projection every step. Fans follow static-pressure curves, so they lose flow against restrictive vents.'),
    el('p', {}, 'Heatsinks are porous blocks with direction-dependent drag. Their heat is carried away by the air moving through them, and energy is conserved.'),
    el('p', {}, 'Open slots and expansion-slot covers are passive vents: more intake than exhaust pushes air out through them (positive pressure); the reverse pulls unfiltered air in.'),
    el('p', { class: 'mono small' }, 'TAP A FAN SLOT IN 3D TO CYCLE IN → OUT → OPEN → SHUT'));

  cards.append(cardEls.fans, cardEls.settings, cardEls.about);

  function setView(patch) {
    h.onView(patch);
    for (const [k, ctl] of Object.entries(viewCtl)) ctl.set?.(k === 'sliceAxis' ? String(view[k]) : view[k]);
    dockBtns.streaks.classList.toggle('on', view.particles);
    dockBtns.slice.classList.toggle('on', view.slice);
    dockBtns.panels.classList.toggle('on', view.panels);
  }

  // ---- Map-style round controls (right edge) -----------------------------------------
  document.getElementById('mapctl').append(
    el('button', { type: 'button', class: 'round', 'aria-label': 'Reset view', title: 'Reset view', onclick: () => h.onCamera('home') }, icon('home')),
    el('div', { class: 'round-pair' },
      el('button', { type: 'button', class: 'round', 'aria-label': 'Zoom in', onclick: () => h.onCamera('in') }, icon('plus')),
      el('button', { type: 'button', class: 'round', 'aria-label': 'Zoom out', onclick: () => h.onCamera('out') }, icon('minus'))),
    el('button', { type: 'button', class: 'round', 'aria-label': 'Settings', title: 'Settings', onclick: () => openCard('settings') }, icon('gear')),
  );

  // ---- Dock ------------------------------------------------------------------------
  const dock = document.getElementById('dock');
  const dockBtns = {};
  const dbtn = (name, ico, label, onclick, extraCls = '') => {
    const b = el('button', { type: 'button', class: `dbtn ${extraCls}`, 'aria-label': label, title: label, onclick }, icon(ico), el('span', { class: 'mono' }, label));
    dockBtns[name] = b;
    return b;
  };
  const dockRoom = stepper({ label: 'ROOM °C', value: cfg.ambient, step: 1, min: 10, max: 40, fmt: (v) => `${v}°`, onChange: (v) => { cfg.ambient = v; setText(roomBadge, `${v}`); roomSlider.set(v); h.onConfig({ ambient: v }); } });
  const dockFan = stepper({ label: 'FANS %', value: Math.round(cfg.fan * 100), step: 5, min: 0, max: 100, fmt: (v) => `${v}`, onChange: (v) => { cfg.fan = v / 100; setText(fanCircle, `${v}`); fanSlider.set(cfg.fan); h.onConfig({ caseFanSpeed: cfg.fan }); } });
  const dockCpu = stepper({ label: 'CPU W', value: cfg.cpu, step: 25, min: 25, max: 300, fmt: (v) => `${v}`, onChange: (v) => { cfg.cpu = v; cpuSlider.set(v); h.onConfig({ power: { cpu: v } }); } });
  const dockGpu = stepper({ label: 'GPU W', value: cfg.gpu, step: 25, min: 25, max: 500, fmt: (v) => `${v}`, onChange: (v) => { cfg.gpu = v; gpuSlider.set(v); h.onConfig({ power: { gpu: v } }); } });
  dockCpu.classList.add('wide-only');
  dockGpu.classList.add('wide-only');
  const playBtn = el('button', { type: 'button', class: 'dbtn play', 'aria-label': 'Pause', onclick: () => h.onPause() }, icon('pause'), el('span', { class: 'mono' }, 'PAUSE'));
  dock.append(
    dbtn('fans', 'list', 'SLOTS', () => openCard('fans')),
    dbtn('streaks', 'wind', 'STREAKS', () => setView({ particles: !view.particles })),
    dbtn('slice', 'slice', 'PLANE', () => setView({ slice: !view.slice })),
    dbtn('panels', 'case', 'PANELS', () => setView({ panels: !view.panels }), 'wide-only'),
    dockCpu, dockRoom, dockFan, dockGpu,
    playBtn,
    dbtn('settings', 'gear', 'SETTINGS', () => openCard('settings')),
  );
  dockBtns.streaks.classList.toggle('on', view.particles);
  dockBtns.slice.classList.toggle('on', view.slice);
  dockBtns.panels.classList.toggle('on', view.panels);

  // ---- Legend, tooltip, toast --------------------------------------------------------
  const legend = document.getElementById('legend');
  function updateLegend(v) {
    legend.innerHTML = '';
    const item = (title, fn, lo, hi, signed) => el('div', { class: 'legend-item' },
      el('div', { class: 'mono title' }, title),
      el('div', { class: 'bar', style: `background:${cssGradient(fn, signed)}` }),
      el('div', { class: 'ends' }, el('span', {}, lo), el('span', {}, hi)));
    if (v.particles) {
      if (v.color === 'temperature') legend.append(item('AIR TEMPERATURE', heat, 'room', '+20°C'));
      else if (v.color === 'speed') legend.append(item('AIR SPEED', turbo, '0 m/s', '3 m/s'));
      else {
        const sw = el('div', { class: 'swatches' });
        SLOTS.forEach((s, i) => {
          const c = SOURCE_COLORS[i % SOURCE_COLORS.length].map((x) => Math.round(x * 255));
          sw.append(el('span', { style: `--c: rgb(${c})` }, s.label.replace(/ \((.*)\)/, ' $1')));
        });
        sw.append(el('span', { style: '--c: rgb(178,184,199)' }, 'Vents'));
        legend.append(el('div', { class: 'legend-item' }, el('div', { class: 'mono title' }, 'AIR SOURCE'), sw));
      }
    }
    if (v.slice) {
      if (v.sliceField === 'speed') legend.append(item('PLANE · SPEED', turbo, '0 m/s', '3 m/s'));
      else if (v.sliceField === 'temperature') legend.append(item('PLANE · TEMPERATURE', heat, 'room', '+20°C'));
      else {
        const it = item('PLANE · PRESSURE', diverging, '−', '+', true);
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

  // ---- Layout reporting (keeps the case centred in the free area) ----------------------
  function layoutChanged() {
    requestAnimationFrame(() => {
      const vp = document.getElementById('viewport').getBoundingClientRect();
      let left = 0, bottom = 0;
      for (const n of open) {
        const r = cardEls[n].getBoundingClientRect();
        if (isPhone()) bottom = Math.max(bottom, vp.bottom - r.top);
        else if (r.left - vp.left < vp.width / 2) left = Math.max(left, r.right - vp.left);
      }
      h.onLayout?.({ left, bottom });
    });
  }
  mq.addEventListener('change', layoutChanged);
  if (!isPhone()) openCard('fans', true);
  else layoutChanged();

  // ---- Live updates ----------------------------------------------------------------
  function updateStats(s, extra) {
    if (!s) return;
    const g = s.groups;
    const cpu = g.cpu, gpu = g.gpu;
    setText(cpuBig, cpu.die.toFixed(0));
    cpuBig.style.color = tempColor(cpu.die, 100);
    setText(gpuSmall, `${gpu.die.toFixed(0)}°`);
    gpuSmall.style.color = tempColor(gpu.die, 90);
    if (g.psu) setText(psuSmall, `${g.psu.die.toFixed(0)}°`);
    const throttling = cpu.throttle < 0.98 || gpu.throttle < 0.98;
    const hot = cpu.die > 85 || gpu.die > 82;
    warnIco.classList.toggle('on', throttling || hot);
    setText(throttleNote, throttling ? `THROTTLING · ${cpu.throttle < 0.98 ? 'CPU' : 'GPU'} ${Math.round(Math.min(cpu.throttle, gpu.throttle) * 100)}%` : '');
    const p = s.pressure;
    const frac = Math.max(0, Math.min(1, 0.5 + p / 6));
    pressMarker.style.left = `${frac * 100}%`;
    pressMarker.dataset.kind = Math.abs(p) < 0.15 ? 'neu' : p > 0 ? 'pos' : 'neg';
    setText(pressText, `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)} PA`);
    const cfm = (q) => (q * CFM_PER_M3S).toFixed(0);
    setText(flowIn, cfm(s.totalIn));
    setText(flowOut, cfm(s.totalOut));
    setText(kv.air, `${s.airTemp.toFixed(1)}°C`);
    setText(kv.exh, `${s.exhaustTemp.toFixed(1)}°C`);
    setText(kv.hot, `${s.airMax.toFixed(1)}°C`);
    setText(kv.gpuOut, s.gpuType === 'blower' ? `${cfm(s.gpuOut)} CFM` : '—');
    setText(kv.vent, `${cfm(s.ventIn)} / ${cfm(s.ventOut)} CFM`);
    setText(kv.load, `${s.psuLoad.toFixed(0)} W · ${(s.psuEff * 100).toFixed(1)}%`);
    setText(kv.fans, `${Math.round(cpu.fan * 100)}% / ${Math.round(gpu.fan * 100)}%${g.psu ? ` · PSU ${g.psu.fan < 0.02 ? 'off' : `${Math.round(g.psu.fan * 100)}%`}` : ''}`);
    setText(sumIn, `${cfm(s.fanIn)} in`);
    setText(sumOut, `${cfm(s.fanOut)} out`);
    setText(sumP, `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)} Pa`);
    for (const f of s.fans) {
      if (f.kind !== 'case') continue;
      const r = slotRows[f.id];
      if (r) setText(r.cfm, `${f.cfm.toFixed(0)} CFM`);
    }
    for (const slot of SLOTS) {
      if (!s.fans.some((f) => f.id === slot.id)) {
        const mode = state.modes[slot.id];
        setText(slotRows[slot.id].cfm, mode === 'open' ? 'Vent' : mode === 'blocked' ? 'Covered' : '—');
      }
    }
    const pe = document.getElementById('pressure-ends');
    if (pe && extra?.pressureRange) {
      pe.children[0].textContent = `−${extra.pressureRange.toFixed(1)} Pa`;
      pe.children[1].textContent = `+${extra.pressureRange.toFixed(1)} Pa`;
    }
    if (extra) {
      setText(gridTxt, `GRID ${extra.grid}`);
      setText(fpsTxt, `${extra.fps.toFixed(0)} FPS`);
    }
    setText(timeTxt, `T ${s.time?.toFixed(1) ?? '0.0'} S`);
    setText(roomTxt, `${cfg.ambient} °C`);
  }

  return {
    updateStats,
    updateLegend,
    toast,
    setModes(modes) {
      for (const [id, r] of Object.entries(slotRows)) {
        r.seg.set(modes[id]);
        r.ico.dataset.mode = modes[id];
        r.ico.innerHTML = `<svg viewBox="0 0 24 24">${P[MODE_ICON[modes[id]]]}</svg>`;
      }
    },
    setActivePreset(id) {
      for (const [k, b] of Object.entries(presetButtons)) b.classList.toggle('active', k === id);
      setText(presetName, id ? PRESETS[id].label : 'Custom');
    },
    setPaused(p) {
      cfg.paused = p;
      playBtn.replaceChildren(icon(p ? 'play' : 'pause'), el('span', { class: 'mono' }, p ? 'PLAY' : 'PAUSE'));
      playBtn.setAttribute('aria-label', p ? 'Play' : 'Pause');
      live.classList.toggle('paused', p);
      live.lastChild.textContent = p ? 'PAUSED' : 'LIVE';
    },
    setCount(n) { viewCtl.count.set(n); },
  };
}
