// Runs the simulation off the main thread and streams field snapshots back.
import { Simulation } from './simulation.js';

let sim = null;
let timeScale = 0.25;
let paused = false;
let last = 0;
let debt = 0;
let snapshots = 0;
let stepMs = 5;

function geometry() {
  const g = sim.grid;
  return {
    type: 'geometry',
    nx: g.nx, ny: g.ny, nz: g.nz, h: sim.h, dt: sim.dt, pScale: sim.pScale, gpuType: sim.gpuType, psuMode: sim.psuMode,
    solid: g.solid.slice(),
    porous: Uint8Array.from(g.dragY, (d, c) => (d > 0 || g.dragZ[c] > 0 ? 1 : 0)),
    fans: sim.fans.map((f) => ({ id: f.id, kind: f.kind, mode: f.mode, axis: f.axis, dir: f.dir })),
  };
}

function snapshot(withSources) {
  const g = sim.grid;
  const msg = {
    type: 'snapshot',
    time: sim.time,
    stepMs,
    u: g.u.slice(), v: g.v.slice(), w: g.w.slice(), T: g.T.slice(), p: g.p.slice(),
    summary: strip(sim.summary()),
    sources: withSources ? Float32Array.from(sim.inflowSources()) : null,
  };
  const transfer = [msg.u.buffer, msg.v.buffer, msg.w.buffer, msg.T.buffer, msg.p.buffer];
  if (msg.sources) transfer.push(msg.sources.buffer);
  postMessage(msg, transfer);
}

function strip(s) {
  const out = { ...s };
  delete out.cfm;
  return out;
}

function loop() {
  const now = performance.now();
  const wall = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim && !paused) {
    debt += wall * timeScale;
    const maxSteps = 6;
    let steps = 0;
    const t0 = performance.now();
    while (debt >= sim.dt && steps < maxSteps) {
      sim.step();
      debt -= sim.dt;
      steps++;
    }
    if (steps) stepMs = stepMs * 0.8 + ((performance.now() - t0) / steps) * 0.2;
    // If the machine cannot keep up, drop the backlog instead of spiraling.
    if (debt > sim.dt * maxSteps) debt = 0;
    if (steps) snapshot(snapshots++ % 5 === 0);
  }
  setTimeout(loop, 8);
}

onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      sim = new Simulation(m.options);
      applyConfig(m.config || {});
      postMessage(geometry());
      snapshot(true);
      break;
    case 'config':
      applyConfig(m.config);
      break;
    case 'gpu':
      sim.setGpu(m.gpuType);
      applyConfig(m.config || {});
      postMessage(geometry());
      snapshot(true);
      break;
    case 'psu':
      sim.setPsuMode(m.psuMode);
      applyConfig(m.config || {});
      postMessage(geometry());
      snapshot(true);
      break;
    case 'modes':
      sim.setModes(m.modes);
      postMessage(geometry());
      snapshot(true);
      break;
    case 'step':
      // Single-step while paused.
      sim.step();
      snapshot(true);
      break;
    default:
      break;
  }
};

function applyConfig(c) {
  if (c.timeScale !== undefined) timeScale = c.timeScale;
  if (c.paused !== undefined) paused = c.paused;
  if (!sim) return;
  if (c.caseFanSpeed !== undefined) sim.caseFanSpeed = c.caseFanSpeed;
  if (c.ambient !== undefined) sim.ambient = c.ambient;
  if (c.power) Object.assign(sim.power, c.power);
  if (c.coolerAuto) Object.assign(sim.coolerAuto, c.coolerAuto);
  if (c.coolerManual) Object.assign(sim.coolerManual, c.coolerManual);
  if (c.buoyancy !== undefined) sim.grid.buoyancy = c.buoyancy;
}

last = performance.now();
loop();
