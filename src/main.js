import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FluidGrid } from './sim/fluid.js';
import { PRESETS, SLOTS, SLOT_MODES, CFM_PER_M3S } from './sim/model.js';
import { CaseView } from './render/caseView.js';
import { Particles } from './render/particles.js';
import { Slice } from './render/slice.js';
import { buildUI } from './ui.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  modes: { ...PRESETS.balanced.modes },
  caseFanSpeed: 0.7,
  power: { cpu: 150, gpu: 300 },
  ambient: 22,
  coolerAuto: true,
  coolerManual: 0.7,
  timeScale: 0.25,
  paused: false,
  buoyancy: true,
  resolution: matchMedia('(max-width: 800px)').matches ? 'low' : 'medium',
  view: {
    particles: true,
    count: 3500,
    color: 'temperature',
    seedMix: 0.15,
    slice: false,
    sliceField: 'speed',
    sliceAxis: 0,
    slicePos: 0.55,
    panels: true,
  },
};

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const viewport = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(38, 1, 0.03, 8);
camera.position.set(-0.8, 0.26, 0.64);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.25;
controls.maxDistance = 3;
controls.target.set(0, 0.03, 0);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a1d24, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(-1, 2, 1.5);
scene.add(key);

const root = new THREE.Group();
scene.add(root);
const grid = new THREE.GridHelper(2, 40, 0x2a3242, 0x1a2030);
scene.add(grid);

let caseView = null;
const particles = new Particles(12000, 14);
const slice = new Slice();
let field = null;
let geometry = null;
let summary = null;
let stepMs = 0;

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Simulation worker
// ---------------------------------------------------------------------------
let worker = null;

function workerConfig() {
  return {
    timeScale: state.timeScale,
    paused: state.paused,
    caseFanSpeed: state.caseFanSpeed,
    ambient: state.ambient,
    power: state.power,
    coolerAuto: { cpu: state.coolerAuto, gpu: state.coolerAuto },
    coolerManual: { cpu: state.coolerManual, gpu: state.coolerManual },
    buoyancy: state.buoyancy,
  };
}

function startWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker.postMessage({
    type: 'init',
    options: { resolution: state.resolution, modes: state.modes, caseFanSpeed: state.caseFanSpeed, ambient: state.ambient, power: state.power },
    config: workerConfig(),
  });
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'geometry') {
    const sameGrid = geometry && geometry.nx === m.nx && geometry.ny === m.ny && geometry.nz === m.nz;
    geometry = m;
    if (!sameGrid) {
      field = new FluidGrid(m.nx, m.ny, m.nz, m.h, m.dt);
      field.solid = m.solid;
      buildCase([m.nx * m.h, m.ny * m.h, m.nz * m.h]);
      particles.setField(field);
      slice.setField(field, m.pScale);
      slice.configure({ axis: state.view.sliceAxis, frac: state.view.slicePos, mode: state.view.sliceField });
    }
  } else if (m.type === 'snapshot' && field) {
    field.u = m.u; field.v = m.v; field.w = m.w; field.T = m.T; field.p = m.p;
    summary = { ...m.summary, time: m.time };
    stepMs = m.stepMs;
    if (m.sources) particles.setSources(m.sources);
  }
}

function buildCase(dims) {
  if (caseView) root.remove(caseView.group);
  caseView = new CaseView(dims);
  caseView.setModes(state.modes);
  caseView.setPanelsVisible(state.view.panels);
  root.add(caseView.group);
  root.add(particles.object);
  root.add(slice.group);
  root.position.set(-dims[0] / 2, -dims[1] / 2, -dims[2] / 2);
  grid.position.y = -dims[1] / 2 - 0.012;
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function setModes(modes, presetId = null) {
  Object.assign(state.modes, modes);
  ui.setModes(state.modes);
  ui.setActivePreset(presetId);
  caseView?.setModes(state.modes);
  worker.postMessage({ type: 'modes', modes: state.modes });
}

const ui = buildUI(
  {
    modes: state.modes, caseFanSpeed: state.caseFanSpeed, power: state.power, ambient: state.ambient,
    coolerAuto: state.coolerAuto, coolerManual: state.coolerManual, timeScale: state.timeScale,
    resolution: state.resolution, buoyancy: state.buoyancy, view: state.view,
  },
  {
    onPreset: (id) => setModes(PRESETS[id].modes, id),
    onMode: (slotId, mode) => setModes({ [slotId]: mode }),
    onConfig: (patch) => {
      if (patch.caseFanSpeed !== undefined) state.caseFanSpeed = patch.caseFanSpeed;
      if (patch.ambient !== undefined) state.ambient = patch.ambient;
      if (patch.power) Object.assign(state.power, patch.power);
      if (patch.coolerAuto) state.coolerAuto = patch.coolerAuto.cpu;
      if (patch.coolerManual) state.coolerManual = patch.coolerManual.cpu;
      if (patch.timeScale !== undefined) state.timeScale = patch.timeScale;
      if (patch.buoyancy !== undefined) state.buoyancy = patch.buoyancy;
      worker.postMessage({ type: 'config', config: patch });
    },
    onView: (patch) => {
      Object.assign(state.view, patch);
      applyView();
    },
    onPause: togglePause,
    onStep: () => worker.postMessage({ type: 'step' }),
    onReset: () => startWorker(),
    onResolution: (r) => {
      state.resolution = r;
      geometry = null;
      startWorker();
    },
  },
);
ui.setActivePreset('balanced');

function togglePause() {
  state.paused = !state.paused;
  ui.setPaused(state.paused);
  worker.postMessage({ type: 'config', config: { paused: state.paused } });
}

function applyView() {
  const v = state.view;
  particles.object.visible = v.particles;
  particles.setCount(v.count);
  particles.colorMode = v.color;
  particles.seedMix = v.seedMix;
  slice.group.visible = v.slice;
  slice.configure({ axis: v.sliceAxis, frac: v.slicePos, mode: v.sliceField });
  caseView?.setPanelsVisible(v.panels);
  ui.updateLegend(v);
}

// ---------------------------------------------------------------------------
// Picking fan slots
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hovered = null;
let downAt = null;

function pick(ev) {
  if (!caseView) return null;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(caseView.hitTargets, false)[0];
  return hit ? hit.object.userData.slotId : null;
}

renderer.domElement.addEventListener('pointermove', (ev) => {
  const id = pick(ev);
  hovered = id;
  caseView?.setHighlight(id);
  renderer.domElement.style.cursor = id ? 'pointer' : '';
  if (id) {
    const slot = SLOTS.find((s) => s.id === id);
    const fan = summary?.fans.find((f) => f.id === id);
    const mode = state.modes[id];
    const detail = fan ? ` · ${fan.cfm.toFixed(0)} CFM` : '';
    tooltip.innerHTML = `<b>${slot.label}</b> — ${mode}${detail}<br><span style="color:var(--muted)">click to change</span>`;
    const r = viewport.getBoundingClientRect();
    tooltip.style.left = `${ev.clientX - r.left}px`;
    tooltip.style.top = `${ev.clientY - r.top}px`;
    tooltip.hidden = false;
  } else {
    tooltip.hidden = true;
  }
});
renderer.domElement.addEventListener('pointerleave', () => { tooltip.hidden = true; caseView?.setHighlight(null); });
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
  const id = pick(ev);
  if (!id) return;
  const next = SLOT_MODES[(SLOT_MODES.indexOf(state.modes[id]) + 1) % SLOT_MODES.length];
  setModes({ [id]: next });
});
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space' && ev.target === document.body) {
    ev.preventDefault();
    togglePause();
  }
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);
let frame = 0;
let fps = 60;

function animate(timestamp) {
  requestAnimationFrame(animate);
  timer.update(timestamp);
  const dt = Math.min(0.05, timer.getDelta());
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  controls.update();
  if (field && summary) {
    const simDt = state.paused ? 0 : dt * state.timeScale;
    if (state.view.particles) particles.update(simDt, state.ambient);
    caseView.update(state.paused ? 0 : dt, summary, state.timeScale);
    if (state.view.slice && frame % 4 === 0) slice.update(state.ambient);
    if (frame % 10 === 0) {
      ui.updateStats(summary, {
        grid: `${geometry.nx}×${geometry.ny}×${geometry.nz}`, stepMs, fps,
        pressureRange: slice.mode === 'pressure' ? slice.range : null,
      });
    }
  }
  frame++;
  renderer.render(scene, camera);
}

startWorker();
applyView();
animate();

// Handy for poking at things from the console.
window.airflow = {
  state,
  get summary() { return summary; },
  setView(patch) { Object.assign(state.view, patch); applyView(); },
  setModes,
  camera,
  slice,
  particles,
  controls,
  CFM_PER_M3S,
};
