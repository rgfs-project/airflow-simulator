import { SLOTS, PRESETS, CFM_PER_M3S, GPUS, PSU_MODES, PSU, SLOT_MODES } from './sim/model.js';
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
  flat: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16" opacity=".55"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const icon = (name) => el('span', { class: 'ico', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24">${P[name]}</svg>` });
const MODE_LABEL = { intake: 'In', exhaust: 'Out', open: 'Open', blocked: 'Shut' };
const tempTone = (t, limit) => (t >= limit - 2 ? 'bad' : t >= limit - 18 ? 'warm' : '');

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

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function buildUI(state, h) {
  const view = state.view;
  const presetIds = Object.keys(PRESETS);
  let presetIndex = 0;

  // ---- Top bar ------------------------------------------------------------------
  const playBtn = el('button', { type: 'button', class: 'btn primary', onclick: () => h.onPause() }, icon('pause'), el('span', {}, 'Pause'));
  document.getElementById('topbar').append(
    el('a', { class: 'wordmark', href: '#', 'aria-label': 'Airflow home', onclick: (e) => e.preventDefault() },
      el('span', { class: 'mark', html: `<svg viewBox="0 0 24 24">${P.mark}</svg>` }), 'Airflow'),
    el('div', { class: 'actions' },
      el('button', { type: 'button', class: 'btn soft icon', 'aria-label': 'Settings', title: 'Settings', onclick: () => openModal('settings') }, icon('gear')),
      playBtn),
  );

  // ---- Stage overlays -----------------------------------------------------------------
  const live = el('span', { class: 'live warming' }, el('i'), el('b', {}, 'Starting'));
  document.getElementById('overlay-tl').append(el('div', { class: 'chip' }, live));

  const colorNames = { temperature: 'Temperature', speed: 'Speed', source: 'Source' };
  const pills = {};
  const pill = (key, label, onclick) => {
    pills[key] = el('button', { type: 'button', class: `btn glass pill-${key}`, 'aria-pressed': 'false', onclick }, label);
    return pills[key];
  };
  document.getElementById('overlay-bl').append(
    pill('particles', 'Streaks', () => setView({ particles: !view.particles })),
    pill('color', colorNames[view.color], () => {
      const order = ['temperature', 'speed', 'source'];
      setView({ color: order[(order.indexOf(view.color) + 1) % order.length], particles: true });
    }),
    pill('slice', 'Plane', () => setView({ slice: !view.slice })),
    pill('panels', 'Panels', () => setView({ panels: !view.panels })),
  );
  const flatBtn = el('button', { type: 'button', class: 'btn glass icon flat-btn', 'aria-label': 'Flat View', title: 'Flat View', 'aria-pressed': 'false' }, icon('flat'));
  flatBtn.addEventListener('click', () => {
    const on = h.onCamera('flat');
    flatBtn.classList.toggle('on', on);
    flatBtn.setAttribute('aria-pressed', String(on));
    syncPills();
    for (const [k, ctl] of Object.entries(viewCtl)) ctl.set?.(k === 'sliceAxis' ? String(view[k]) : view[k]);
  });
  document.getElementById('overlay-br').append(
    el('button', { type: 'button', class: 'btn glass icon', 'aria-label': 'Zoom in', onclick: () => h.onCamera('in') }, icon('plus')),
    el('button', { type: 'button', class: 'btn glass icon', 'aria-label': 'Zoom out', onclick: () => h.onCamera('out') }, icon('minus')),
    flatBtn,
  );

  // ---- Preset bar (caption + arrows, under the stage) ------------------------------------
  const presetTitle = el('b', {}, '');
  const stepPreset = (d) => {
    presetIndex = (presetIndex + d + presetIds.length) % presetIds.length;
    h.onPreset(presetIds[presetIndex]);
  };
  document.getElementById('presetbar').append(
    el('div', { class: 'caption' }, el('p', {}, presetTitle)),
    el('div', { class: 'arrows' },
      el('button', { type: 'button', class: 'btn soft icon', 'aria-label': 'Previous preset', onclick: () => stepPreset(-1) }, icon('left')),
      el('button', { type: 'button', class: 'btn soft icon', 'aria-label': 'Next preset', onclick: () => stepPreset(1) }, icon('right'))),
  );

  // ---- Side cards ---------------------------------------------------------------------------
  const side = document.getElementById('side');
  // Cards are <details>: collapsible on phones, always open on wider screens.
  const phoneMq = matchMedia('(max-width: 900px)');
  const cards = [];
  const card = (title, ...kids) => {
    const summary = el('summary', {}, el('h2', {}, title), el('span', { class: 'chev', 'aria-hidden': 'true' }));
    summary.addEventListener('click', (e) => { if (!phoneMq.matches) e.preventDefault(); });
    const d = el('details', { class: 'card' }, summary, el('div', { class: 'card-body' }, ...kids));
    d.dataset.mobileOpen = String(cards.length === 0); // on phones only the first card starts open
    cards.push(d);
    return d;
  };
  const syncCards = () => { for (const d of cards) d.open = phoneMq.matches ? d.dataset.mobileOpen === 'true' : true; };
  phoneMq.addEventListener('change', syncCards);
  queueMicrotask(syncCards);

  const temp = {};
  const tempCol = (key, label) => {
    const num = el('div', { class: 'num' }, '–');
    const sub = el('div', { class: 'sub' }, '');
    temp[key] = { num, sub };
    return el('div', { class: 'stat' }, el('span', { class: 'eyebrow' }, label), num, sub);
  };
  const throttleNote = el('p', { class: 'note bad', hidden: true }, '');
  side.append(card('Temperatures',
    el('div', { class: 'stats3' }, tempCol('cpu', 'CPU'), tempCol('gpu', 'GPU'), tempCol('psu', 'PSU')),
    throttleNote));

  const flowIn = el('div', { class: 'num big in' }, '–');
  const flowOut = el('div', { class: 'num big out' }, '–');
  const pTag = el('span', { class: 'tag' }, '');
  const pVal = el('b', {}, '');
  const kv = {};
  const kvRow = (key, label) => { kv[key] = el('span', {}, '–'); return el('div', { class: 'row' }, el('span', { class: 'k' }, label), kv[key]); };
  side.append(card('Airflow',
    el('div', { class: 'stats2' },
      el('div', { class: 'stat' }, el('span', { class: 'eyebrow' }, 'Intake'), flowIn),
      el('div', { class: 'stat' }, el('span', { class: 'eyebrow' }, 'Exhaust'), flowOut)),
    el('div', { class: 'row strong' }, el('span', { class: 'k' }, 'Pressure'), el('span', {}, pVal, pTag)),
    kvRow('gpuOut', 'GPU Exhaust'), kvRow('vent', 'Passive'),
    kvRow('air', 'Case Air'), kvRow('exh', 'Exhaust Air'), kvRow('hot', 'Peak Air'), kvRow('load', 'Load')));

  const presetSel = select('preset', [['', 'Custom'], ...presetIds.map((id) => [id, PRESETS[id].label])], 'balanced', (id) => { if (id) h.onPreset(id); });
  const slotRows = {};
  const slotList = el('div', { class: 'slots' });
  for (const slot of SLOTS) {
    const dot = el('i', { class: 'dot' });
    const cfm = el('span', { class: 'cfm' }, '—');
    const s = seg(SLOT_MODES.map((m) => [m, MODE_LABEL[m]]), state.modes[slot.id], (m) => h.onMode(slot.id, m), 'wide');
    slotRows[slot.id] = { seg: s, cfm, dot };
    slotList.append(el('div', { class: 'slot' }, el('div', { class: 'slot-head' }, dot, el('span', { class: 'name' }, slot.label), cfm), s));
  }
  side.append(card('Fan Slots', el('div', { class: 'ctl' }, el('label', { for: 'preset' }, 'Preset'), presetSel), slotList,
    ));

  const coolerSlider = slider({
    label: 'Cooler Fans', min: 0, max: 1, step: 0.01, value: state.coolerManual,
    fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ coolerManual: { cpu: v, gpu: v } }),
  });
  coolerSlider.hidden = state.coolerAuto;
  side.append(card('Load & Hardware',
    slider({ label: 'Case Fans', min: 0, max: 1, step: 0.05, value: state.caseFanSpeed, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => h.onConfig({ caseFanSpeed: v }) }),
    slider({ label: 'CPU', min: 15, max: 300, step: 5, value: state.power.cpu, fmt: (v) => `${v} W`, onInput: (v) => h.onConfig({ power: { cpu: v } }) }),
    slider({ label: 'GPU', min: 20, max: 650, step: 5, value: state.power.gpu, fmt: (v) => `${v} W`, onInput: (v) => h.onConfig({ power: { gpu: v } }) }),
    slider({ label: 'Ambient', min: 10, max: 40, step: 0.5, value: state.ambient, fmt: (v) => `${v.toFixed(1)}°C`, onInput: (v) => h.onConfig({ ambient: v }) }),
    toggle('Auto Cooler Fans', state.coolerAuto, (on) => { coolerSlider.hidden = on; h.onConfig({ coolerAuto: { cpu: on, gpu: on } }); }),
    coolerSlider,
    el('div', { class: 'ctl' }, el('label', { for: 'gpu-type' }, 'Graphics Card'),
      select('gpu-type', Object.entries(GPUS).map(([id, g]) => [id, g.label]), state.gpuType, (v) => h.onGpu(v))),
    el('div', { class: 'ctl' }, el('label', { for: 'psu-mode' }, 'Power Supply'),
      select('psu-mode', Object.entries(PSU_MODES), state.psuMode, (v) => h.onPsu(v)))));

  // ---- Modals -----------------------------------------------------------------------------
  const modalRoot = document.getElementById('modal-root');
  const viewCtl = {
    color: seg([['temperature', 'Temperature'], ['speed', 'Speed'], ['source', 'Source']], view.color, (c) => setView({ color: c }), 'wide'),
    count: slider({ label: 'Count', min: 500, max: 12000, step: 500, value: view.count, fmt: (x) => `${x}`, onInput: (x) => setView({ count: x }) }),
    seedMix: slider({ label: 'Seeding', min: 0, max: 1, step: 0.05, value: view.seedMix, fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => setView({ seedMix: x }) }),
    sliceField: seg([['speed', 'Speed'], ['temperature', 'Temperature'], ['pressure', 'Pressure']], view.sliceField, (c) => setView({ sliceField: c, slice: true }), 'wide'),
    sliceAxis: seg([['0', 'Side'], ['1', 'Top'], ['2', 'Front']], String(view.sliceAxis), (c) => setView({ sliceAxis: +c, slice: true }), 'wide'),
    slicePos: slider({ label: 'Position', min: 0, max: 1, step: 0.01, value: view.slicePos, fmt: (x) => `${Math.round(x * 100)}%`, onInput: (x) => setView({ slicePos: x }) }),
  };
  const closeBtn = () => el('button', { type: 'button', class: 'btn soft icon closebtn', 'aria-label': 'Close', onclick: () => closeModal() }, icon('close'));
  const modals = {
    settings: el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-h' },
      closeBtn(),
      el('h1', { id: 'settings-h' }, 'Settings'),
      el('div', { class: 'cols' },
        el('div', {},
          el('h3', { class: 'eyebrow' }, 'Streaks'),
          el('div', { class: 'ctl' }, el('label', {}, 'Colour'), viewCtl.color),
          viewCtl.count, viewCtl.seedMix),
        el('div', {},
          el('h3', { class: 'eyebrow' }, 'Cross-section'),
          el('div', { class: 'ctl' }, el('label', {}, 'Field'), viewCtl.sliceField),
          el('div', { class: 'ctl' }, el('label', {}, 'Axis'), viewCtl.sliceAxis),
          viewCtl.slicePos)),
      el('hr'),
      el('div', { class: 'cols' },
        el('div', {},
          el('h3', { class: 'eyebrow' }, 'Simulation'),
          slider({ label: 'Time Scale', min: 0.05, max: 1, step: 0.05, value: state.timeScale, fmt: (x) => `${x.toFixed(2)}×`, onInput: (x) => h.onConfig({ timeScale: x }) }),
          toggle('Buoyancy', state.buoyancy, (on) => h.onConfig({ buoyancy: on }))),
        el('div', {},
          el('h3', { class: 'eyebrow' }, 'Accuracy'),
          el('div', { class: 'ctl' }, el('label', { for: 'grid-res' }, 'Resolution'),
            select('grid-res', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], state.resolution, (r) => h.onResolution(r))))),
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn primary', onclick: () => closeModal() }, 'Done'),
        el('button', { type: 'button', class: 'textlink', onclick: () => { h.onReset(); closeModal(); } }, 'Reset'))),
  };
  let openName = null;
  let lastFocus = null;
  function openModal(name) {
    closeModal();
    lastFocus = document.activeElement;
    openName = name;
    const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) closeModal(); } });
    scrim.append(modals[name]);
    modalRoot.replaceChildren(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
    modals[name].querySelector('.closebtn').focus();
  }
  function closeModal() {
    if (!openName) return;
    openName = null;
    modalRoot.replaceChildren();
    lastFocus?.focus?.();
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function syncPills() {
    for (const k of ['particles', 'slice', 'panels']) {
      pills[k].classList.toggle('on', view[k]);
      pills[k].setAttribute('aria-pressed', String(view[k]));
    }
  }

  function setView(patch) {
    h.onView(patch);
    syncPills();
    setText(pills.color, colorNames[view.color]);
    for (const [k, ctl] of Object.entries(viewCtl)) ctl.set?.(k === 'sliceAxis' ? String(view[k]) : view[k]);
  }

  // ---- Legend & toast ----------------------------------------------------------------------
  const legend = document.getElementById('legend');
  function updateLegend(v) {
    legend.innerHTML = '';
    const item = (title, fn, lo, hi, signed) => el('div', { class: 'legend-item' },
      el('div', { class: 'title' }, title),
      el('div', { class: 'bar', style: `background:${cssGradient(fn, signed)}` }),
      el('div', { class: 'ends' }, el('span', {}, lo), el('span', {}, hi)));
    if (v.particles) {
      if (v.color === 'temperature') legend.append(item('Temperature', heat, 'Ambient', '+20°'));
      else if (v.color === 'speed') legend.append(item('Speed', turbo, '0', '3 m/s'));
      else {
        const sw = el('div', { class: 'swatches' });
        SLOTS.forEach((s, i) => {
          const c = SOURCE_COLORS[i % SOURCE_COLORS.length].map((x) => Math.round(x * 255));
          sw.append(el('span', { style: `--c: rgb(${c})` }, s.label.replace(/ \((.*)\)/, ' $1')));
        });
        sw.append(el('span', { style: '--c: rgb(178,184,199)' }, 'Vents'));
        legend.append(el('div', { class: 'legend-item' }, el('div', { class: 'title' }, 'Source'), sw));
      }
    }
    if (v.slice) {
      if (v.sliceField === 'speed') legend.append(item('Plane Speed', turbo, '0', '3 m/s'));
      else if (v.sliceField === 'temperature') legend.append(item('Plane Temperature', heat, 'Ambient', '+20°'));
      else {
        const it = item('Plane Pressure', diverging, '−', '+', true);
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

  // ---- Live updates --------------------------------------------------------------------------
  let warmed = false;
  function updateStats(s, extra) {
    if (!s) return;
    if (!warmed) { warmed = true; if (!live.classList.contains('paused')) setText(live.lastChild, 'Live'); live.classList.remove('warming'); }
    const g = s.groups;
    for (const [key, limit] of [['cpu', 100], ['gpu', 90], ['psu', 999]]) {
      const grp = g[key];
      if (!grp) continue;
      setText(temp[key].num, `${grp.die.toFixed(0)}°`);
      temp[key].num.dataset.tone = tempTone(grp.die, limit);
      const fan = grp.fan < 0.02 ? 'Fan Off' : `${Math.round(grp.fan * 100)}%`;
      setText(temp[key].sub, key === 'psu' ? fan : `${grp.power.toFixed(0)} W · ${fan}`);
    }
    const thr = ['cpu', 'gpu'].filter((k) => g[k].throttle < 0.98);
    throttleNote.hidden = !thr.length;
    if (thr.length) setText(throttleNote, `${thr.map((k) => k.toUpperCase()).join(' & ')} Throttling`);
    const cfm = (q) => (q * CFM_PER_M3S).toFixed(0);
    setText(flowIn, cfm(s.totalIn));
    setText(flowOut, cfm(s.totalOut));
    const p = s.pressure;
    setText(pVal, `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(2)} Pa`);
    const kind = Math.abs(p) < 0.15 ? 'neu' : p > 0 ? 'pos' : 'neg';
    pTag.className = `tag ${kind}`;
    setText(pTag, { neu: 'Neutral', pos: 'Positive', neg: 'Negative' }[kind]);
    setText(kv.gpuOut, s.gpuType === 'blower' ? `${cfm(s.gpuOut)} CFM` : '—');
    setText(kv.vent, `${cfm(s.ventIn)} / ${cfm(s.ventOut)} CFM`);
    setText(kv.air, `${s.airTemp.toFixed(1)}°C`);
    setText(kv.exh, `${s.exhaustTemp.toFixed(1)}°C`);
    setText(kv.hot, `${s.airMax.toFixed(1)}°C`);
    setText(kv.load, `${s.psuLoad.toFixed(0)} W`);
    for (const f of s.fans) {
      if (f.kind !== 'case') continue;
      const r = slotRows[f.id];
      if (r) setText(r.cfm, `${f.cfm.toFixed(0)} CFM`);
    }
    for (const slot of SLOTS) {
      if (!s.fans.some((f) => f.id === slot.id)) {
        const mode = state.modes[slot.id];
        setText(slotRows[slot.id].cfm, mode === 'open' ? 'Vent' : mode === 'blocked' ? 'Shut' : '—');
      }
    }
    const pe = document.getElementById('pressure-ends');
    if (pe && extra?.pressureRange) {
      pe.children[0].textContent = `−${extra.pressureRange.toFixed(1)} Pa`;
      pe.children[1].textContent = `+${extra.pressureRange.toFixed(1)} Pa`;
    }
  }

  const api = {
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
      setText(presetTitle, id ? PRESETS[id].label : 'Custom');
    },
    setPaused(p) {
      playBtn.replaceChildren(icon(p ? 'play' : 'pause'), el('span', {}, p ? 'Resume' : 'Pause'));
      live.classList.toggle('paused', p);
      setText(live.lastChild, p ? 'Paused' : 'Live');
    },
    setCount(n) { viewCtl.count.set(n); },
  };
  // Sync pill states once the caller has finished wiring (onView may reference ui).
  queueMicrotask(syncPills);
  return api;
}
