import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FluidGrid } from './sim/fluid.js';
import { PRESETS, SLOTS, SLOT_MODES, CFM_PER_M3S, GPUS, DEFAULT_GPU } from './sim/model.js';
import { CaseView } from './render/caseView.js';
import { Particles } from './render/particles.js';
import { Slice } from './render/slice.js';
import { buildUI } from './ui/store.js';

// ---------------------------------------------------------------------------
// Device profile
// ---------------------------------------------------------------------------
const MOBILE = matchMedia('(max-width: 900px)').matches || matchMedia('(pointer: coarse)').matches;
const quality = {
  pixelRatio: Math.min(window.devicePixelRatio, MOBILE ? 1.25 : 2),
  maxFps: MOBILE ? 30 : 0, // phones: cap rendering to save CPU, GPU and battery
  shadows: !MOBILE,
  trail: MOBILE ? 8 : 14,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  mobile: MOBILE,
  modes: { ...PRESETS.balanced.modes },
  caseFanSpeed: 0.7,
  gpuType: DEFAULT_GPU,
  psuMode: 'down',
  power: { cpu: 150, gpu: GPUS[DEFAULT_GPU].power },
  ambient: 22,
  coolerAuto: true,
  coolerManual: 0.7,
  timeScale: 0.25,
  paused: false,
  buoyancy: true,
  resolution: MOBILE ? 'low' : 'medium',
  view: {
    particles: true,
    count: MOBILE ? 1200 : 3500,
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
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.pixelRatio);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;

const camera = new THREE.PerspectiveCamera(36, 1, 0.03, 8);
const HOME_DIR = new THREE.Vector3(-0.8, 0.26, 0.64).normalize();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.25;
controls.maxDistance = 3;
controls.target.set(0, 0.02, 0);
controls.maxPolarAngle = Math.PI * 0.62; // do not dive far under the floor
let cameraTouched = false;
controls.addEventListener('start', () => { cameraTouched = true; });

// Studio lighting: soft sky, a shadow-casting key, a cool rim and a warm fill.
scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1b1e, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.35);
key.position.set(-0.9, 1.6, 1.1);
key.castShadow = quality.shadows;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -0.45; key.shadow.camera.right = 0.45;
key.shadow.camera.top = 0.45; key.shadow.camera.bottom = -0.45;
key.shadow.camera.near = 0.5; key.shadow.camera.far = 4;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.0015;
key.shadow.radius = 4;
scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe8ff, 0.7);
rim.position.set(0.9, 0.7, -1.2);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.3);
fill.position.set(1.2, 0.3, 0.8);
scene.add(fill);

const root = new THREE.Group();
scene.add(root);
const floor = makeFloor();
scene.add(floor);

let caseView = null;
const particles = new Particles(12000, quality.trail);
const slice = new Slice();
let field = null;
let geometry = null;
let summary = null;
let stepMs = 0;
const offset = { left: 0, bottom: 0 }; // px of the viewport covered by cards
let caseSize = [0.21, 0.46, 0.44];

/** Dark studio floor: a faint grid that fades out radially, plus shadow catcher. */
function makeFloor() {
  const g = new THREE.Group();
  const n = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const ctx = cv.getContext('2d');
  // Soft pool of light under the case, with a barely-there grid fading out.
  const pool = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  pool.addColorStop(0, 'rgba(255,255,255,0.16)');
  pool.addColorStop(0.35, 'rgba(255,255,255,0.06)');
  pool.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, n, n);
  const step = n / 48;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1.2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(n / 2, n / 2, n * 0.42, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i <= 48; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, n); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(n, i * step); ctx.stroke();
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.6, 'rgba(0,0,0,0.5)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  gridMesh.rotation.x = -Math.PI / 2;
  g.add(gridMesh);
  if (quality.shadows) {
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.ShadowMaterial({ opacity: 0.5 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.0005;
    catcher.receiveShadow = true;
    g.add(catcher);
  }
  return g;
}

/** Frame the case so it fits the part of the viewport not covered by cards. */
let flat = false;
let flatSaved = null;

/** Frame the case so it fits the part of the viewport not covered by cards. */
function frameCamera() {
  const w = Math.max(1, viewport.clientWidth - offset.left);
  const h = Math.max(1, viewport.clientHeight - offset.bottom);
  const aspect = w / h;
  const fitH = caseSize[1] * (flat ? 1.75 : 1.3);
  const fitW = flat ? caseSize[2] * 1.9 : Math.hypot(caseSize[0], caseSize[2]) * 1.2;
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const dist = Math.max(fitH / 2 / Math.tan(vfov / 2), fitW / 2 / (Math.tan(vfov / 2) * aspect));
  const dir = flat ? FLAT_DIR : HOME_DIR;
  camera.position.copy(controls.target).addScaledVector(dir, Math.min(flat ? 11 : 2.6, dist));
  controls.update();
}

// Flat view: straight-on through the glass with a narrow lens (nearly orthographic).
const FLAT_DIR = new THREE.Vector3(-1, 0, 0);
function setFlat(on) {
  flat = on;
  if (on) {
    flatSaved = { slice: state.view.slice, sliceAxis: state.view.sliceAxis, slicePos: state.view.slicePos };
    Object.assign(state.view, { slice: true, sliceAxis: 0, slicePos: 0.5 });
    camera.fov = 6;
    camera.far = 20;
  } else {
    if (flatSaved) Object.assign(state.view, flatSaved);
    camera.fov = 36;
    camera.far = 8;
  }
  camera.updateProjectionMatrix();
  controls.enableRotate = !on;
  controls.minDistance = on ? 1 : 0.25;
  controls.maxDistance = on ? 12 : 3;
  controls.target.set(0, 0, 0);
  cameraTouched = false;
  applyView();
  frameCamera();
  return flat;
}

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Shift the projection so the case is centred in the free area beside/above the cards.
  if (offset.left || offset.bottom) camera.setViewOffset(w, h, -offset.left / 2, offset.bottom / 2, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  if (!cameraTouched) frameCamera();
}
new ResizeObserver(resize).observe(viewport);
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
    lowPower: MOBILE,
  };
}

function startWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  worker?.postMessage({
    type: 'init',
    options: { resolution: state.resolution, gpuType: state.gpuType, psuMode: state.psuMode, modes: state.modes, caseFanSpeed: state.caseFanSpeed, ambient: state.ambient, power: state.power },
    config: workerConfig(),
    warmupMs: MOBILE ? 1400 : 900,
    warmupSim: 1.5,
  });
  warmedAt = 0;
}

function onWorkerMessage(e) {
  const m = e.data;
  if (m.type === 'geometry') {
    const sameGrid = geometry && geometry.nx === m.nx && geometry.ny === m.ny && geometry.nz === m.nz;
    const sameGpu = geometry && geometry.gpuType === m.gpuType && geometry.psuMode === m.psuMode;
    geometry = m;
    if (!sameGrid) field = new FluidGrid(m.nx, m.ny, m.nz, m.h, m.dt);
    field.solid = m.solid;
    if (!sameGrid || !sameGpu) {
      buildCase([m.nx * m.h, m.ny * m.h, m.nz * m.h], m.gpuType, m.psuMode);
      particles.setField(field);
      slice.setField(field, m.pScale);
      slice.configure({ axis: state.view.sliceAxis, frac: state.view.slicePos, mode: state.view.sliceField });
    }
  } else if (m.type === 'snapshot' && field) {
    if (!warmedAt) warmedAt = performance.now();
    field.u = m.u; field.v = m.v; field.w = m.w; field.T = m.T; field.p = m.p;
    summary = { ...m.summary, time: m.time };
    stepMs = m.stepMs;
    if (m.sources) particles.setSources(m.sources);
  }
}

function buildCase(dims, gpuType, psuMode) {
  if (caseView) root.remove(caseView.group);
  caseView = new CaseView(dims, gpuType, psuMode);
  caseView.setModes(state.modes);
  caseView.setPanelsVisible(state.view.panels);
  root.add(caseView.group);
  root.add(particles.object);
  root.add(slice.group);
  root.position.set(-dims[0] / 2, -dims[1] / 2, -dims[2] / 2);
  floor.position.y = -dims[1] / 2 - 0.016;
  caseSize = dims;
  if (quality.shadows) {
    caseView.group.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      const opaque = !m.transparent || m.alphaTest > 0;
      o.castShadow = opaque;
      o.receiveShadow = opaque;
    });
  }
  if (!cameraTouched) frameCamera();
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function setModes(modes, presetId = null) {
  Object.assign(state.modes, modes);
  ui.setModes(state.modes);
  ui.setActivePreset(presetId);
  caseView?.setModes(state.modes);
  worker?.postMessage({ type: 'modes', modes: state.modes });
}

const ui = buildUI(
  {
    mobile: state.mobile, modes: state.modes, gpuType: state.gpuType, psuMode: state.psuMode, caseFanSpeed: state.caseFanSpeed, power: state.power, ambient: state.ambient,
    coolerAuto: state.coolerAuto, coolerManual: state.coolerManual, timeScale: state.timeScale,
    resolution: state.resolution, buoyancy: state.buoyancy, view: state.view,
  },
  {
    onPreset: (id) => setModes(PRESETS[id].modes, id),
    onPsu: (mode) => {
      state.psuMode = mode;
      worker?.postMessage({ type: 'psu', psuMode: mode, config: workerConfig() });
    },
    onMode: (slotId, mode) => setModes({ [slotId]: mode }),
    onConfig: (patch) => {
      if (patch.caseFanSpeed !== undefined) state.caseFanSpeed = patch.caseFanSpeed;
      if (patch.ambient !== undefined) state.ambient = patch.ambient;
      if (patch.power) Object.assign(state.power, patch.power);
      if (patch.coolerAuto) state.coolerAuto = patch.coolerAuto.cpu;
      if (patch.coolerManual) state.coolerManual = patch.coolerManual.cpu;
      if (patch.timeScale !== undefined) state.timeScale = patch.timeScale;
      if (patch.buoyancy !== undefined) state.buoyancy = patch.buoyancy;
      worker?.postMessage({ type: 'config', config: patch });
    },
    onView: (patch) => {
      Object.assign(state.view, patch);
      applyView();
    },
    onPause: togglePause,
    onLayout: ({ left, bottom }) => {
      offset.left = left;
      offset.bottom = bottom;
      resize();
    },
    onCamera: (action) => {
      if (action === 'flat') return setFlat(!flat);
      if (action === 'home') { cameraTouched = false; controls.target.set(0, flat ? 0 : 0.02, 0); frameCamera(); return flat; }
      const d = camera.position.clone().sub(controls.target);
      const len = THREE.MathUtils.clamp(d.length() * (action === 'in' ? 0.82 : 1.22), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).addScaledVector(d.normalize(), len);
      cameraTouched = true;
      controls.update();
    },
    onStep: () => worker?.postMessage({ type: 'step' }),
    onReset: () => startWorker(),
    onResolution: (r) => {
      state.resolution = r;
      geometry = null;
      startWorker();
    },
  },
);
ui.setActivePreset('balanced');
ui.setModes(state.modes);

function togglePause() {
  state.paused = !state.paused;
  ui.setPaused(state.paused);
  syncRunning();
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
    const modeName = { intake: 'Intake', exhaust: 'Exhaust', open: 'Vent', blocked: 'Shut' }[mode];
    tooltip.innerHTML = `<b>${slot.label}</b> · ${modeName}${detail}`;
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
  const label = { intake: 'Intake', exhaust: 'Exhaust', open: 'Vent', blocked: 'Shut' }[next];
  ui.toast(`${SLOTS.find((s) => s.id === id).label} → ${label}`);
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
let slowFor = 0;
let qualityStep = 0;
let warmedAt = 0;
let stageVisible = true;
let lastRender = 0;

/** Step quality down if the device cannot keep up (fewer streaks, then lower resolution). */
function adaptQuality(dt, now) {
  // Grace period: judge frame rate only once the simulation is running and has had a few seconds.
  if (!warmedAt || now - warmedAt < 4000 || qualityStep >= 3) return;
  slowFor = fps < (quality.maxFps ? 22 : 28) ? slowFor + dt : Math.max(0, slowFor - dt * 2);
  if (slowFor < 2.5) return;
  slowFor = 0;
  qualityStep++;
  if (qualityStep <= 2) {
    state.view.count = Math.max(600, Math.round(state.view.count * 0.6 / 100) * 100);
    particles.setCount(state.view.count);
    ui.setCount(state.view.count);
  } else {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
    resize();
  }
}

// Save battery: stop simulating while the tab is hidden.
function syncRunning() {
  worker?.postMessage({ type: 'config', config: { paused: document.hidden || !stageVisible || state.paused } });
}
document.addEventListener('visibilitychange', syncRunning);
// Stop simulating and rendering while the 3D view is scrolled off screen (phones scroll the page).
new IntersectionObserver(([entry]) => {
  stageVisible = entry.isIntersecting;
  syncRunning();
}, { threshold: 0.05 }).observe(document.getElementById('stage'));

function animate(timestamp) {
  requestAnimationFrame(animate);
  if (!stageVisible || document.hidden) return;
  if (quality.maxFps && timestamp - lastRender < 1000 / quality.maxFps - 2) return;
  lastRender = timestamp;
  timer.update(timestamp);
  const dt = Math.min(0.05, timer.getDelta());
  fps = fps * 0.9 + (1 / Math.max(dt, 1e-3)) * 0.1;
  adaptQuality(dt, timestamp);
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

// Canvas textures (PSU connector labels) are drawn with Inter, so let it load first.
document.fonts.load("600 15px 'Inter Variable'").catch(() => {}).finally(startWorker);
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
  renderer,
  scene,
  CFM_PER_M3S,
};
