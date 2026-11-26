import { FluidGrid, FIXED, VENT, FREE } from './fluid.js';
import {
  CASE, SLOTS, FACES, CASE_FAN, FAN_SPECS, VENT_K, FIXED_VENTS, PARTS, PLATES,
  INTERNAL_FANS, HEAT_GROUPS, PRESETS, CFM_PER_M3S, GPUS, DEFAULT_GPU, PSU, psuLayout, psuEfficiency,
} from './model.js';

const RHO = 1.2; // kg/m^3
const RHO_CP = 1200; // J/(m^3 K)

export const RESOLUTIONS = {
  low: 0.015,
  medium: 0.0115,
  high: 0.009,
};

/** Fan duty for a temperature-controlled cooler fan. */
export function fanCurve(t) {
  if (t <= 40) return 0.3;
  if (t >= 80) return 1;
  return 0.3 + ((t - 40) / 40) * 0.7;
}

export class Simulation {
  constructor(opts = {}) {
    this.resolution = opts.resolution || 'medium';
    this.h = RESOLUTIONS[this.resolution];
    this.dt = opts.dt || 0.005;
    this.time = 0;
    this.modes = { ...PRESETS.balanced.modes, ...(opts.modes || {}) };
    this.gpuType = GPUS[opts.gpuType] ? opts.gpuType : DEFAULT_GPU;
    this.psuMode = opts.psuMode === 'up' ? 'up' : 'down';
    this.psuLoad = 0;
    this.caseFanSpeed = opts.caseFanSpeed ?? 0.7;
    this.ambient = opts.ambient ?? 22;
    this.power = { cpu: HEAT_GROUPS.cpu.defaultPower, gpu: GPUS[this.gpuType].power, ...(opts.power || {}) };
    this.coolerAuto = { cpu: true, gpu: true };
    this.coolerManual = { cpu: 0.7, gpu: 0.6 };
    this.buildGrid();
  }

  get gpu() { return GPUS[this.gpuType]; }
  get psu() { return psuLayout(this.psuMode); }

  /** Flip the PSU (fan down to the floor, or up into the case); rebuilds the grid. */
  setPsuMode(mode) {
    this.psuMode = mode === 'up' ? 'up' : 'down';
    this.fans = [];
    this.buildGrid();
  }

  /** Swap the graphics card; the grid is rebuilt and temperatures restart. */
  setGpu(type) {
    if (!GPUS[type]) return;
    this.gpuType = type;
    this.fans = [];
    this.buildGrid();
  }

  get W() { return this.grid.nx * this.h; }
  get H() { return this.grid.ny * this.h; }
  get D() { return this.grid.nz * this.h; }

  /** Physical pressure (Pa) per unit of solver pressure. */
  get pScale() { return (RHO * this.h) / this.dt; }

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  buildGrid() {
    const h = this.h;
    const nx = Math.max(4, Math.round(CASE.W / h));
    const ny = Math.max(4, Math.round(CASE.H / h));
    const nz = Math.max(4, Math.round(CASE.D / h));
    const g = new FluidGrid(nx, ny, nz, h, this.dt);
    g.ambient = this.ambient;
    g.T.fill(this.ambient);
    this.grid = g;

    this.groups = {};
    for (const [id, base] of Object.entries(HEAT_GROUPS)) {
      const def = id === 'gpu' ? { ...base, ...this.gpu.heat } : base;
      this.groups[id] = {
        id, def, cells: [], sink: this.ambient, die: this.ambient,
        throttle: 1, fanSpeed: def.hybrid ? 0 : 0.5, fanOn: false, airTemp: this.ambient, speed: 0, G: def.G0, heatOut: 0,
      };
    }

    for (const part of [...PARTS, ...this.gpu.parts, ...this.psu.parts]) {
      const [i0, i1] = this.range(part.min[0], part.max[0], nx);
      const [j0, j1] = this.range(part.min[1], part.max[1], ny);
      const [k0, k1] = this.range(part.min[2], part.max[2], nz);
      for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const c = g.ci(i, j, k);
        if (part.kind === 'solid') {
          g.solid[c] = 1;
        } else if (part.kind === 'fluid') {
          g.solid[c] = 0;
        } else {
          g.solid[c] = 0;
          g.dragX[c] = part.drag[0];
          g.dragY[c] = part.drag[1];
          g.dragZ[c] = part.drag[2];
          if (part.heat) this.groups[part.heat].cells.push(c);
        }
      }
    }
    for (const grp of Object.values(this.groups)) {
      grp.cells = Int32Array.from(grp.cells.filter((c) => !g.solid[c]));
    }

    this.collectBoundary();
    this.rebuildFaces();
  }

  /** Cell index range [a, b) covering the interval [lo, hi] in meters (at least one cell). */
  range(lo, hi, n) {
    let a = Math.round(lo / this.h);
    let b = Math.round(hi / this.h);
    if (b <= a) b = a + 1;
    a = Math.max(0, Math.min(n - 1, a));
    b = Math.max(a + 1, Math.min(n, b));
    return [a, b];
  }

  /** Dimensions of the in-plane axes for faces normal to `axis`. */
  planeAxes(axis) {
    if (axis === 0) return [1, 2];
    if (axis === 1) return [0, 2];
    return [0, 1];
  }

  dims() { return [this.grid.nx, this.grid.ny, this.grid.nz]; }

  /**
   * Visit faces normal to `axis` at plane index `plane` whose in-plane
   * centers satisfy `test(a, b)` (a, b in meters along the plane axes).
   */
  forPlaneFaces(axis, plane, test, fn) {
    const g = this.grid;
    const h = this.h;
    const [pa, pb] = this.planeAxes(axis);
    const d = this.dims();
    for (let b = 0; b < d[pb]; b++) {
      for (let a = 0; a < d[pa]; a++) {
        if (!test((a + 0.5) * h, (b + 0.5) * h)) continue;
        const idx = [0, 0, 0];
        idx[axis] = plane;
        idx[pa] = a;
        idx[pb] = b;
        const f = g.faceIndex(axis, idx[0], idx[1], idx[2]);
        const [lo, hi] = g.faceCells(axis, idx[0], idx[1], idx[2]);
        fn(f, lo, hi, idx);
      }
    }
  }

  collectBoundary() {
    // Every face on the case walls with the inward direction and its cell.
    const g = this.grid;
    const list = [];
    for (let axis = 0; axis < 3; axis++) {
      const n = this.dims()[axis];
      for (const side of [0, 1]) {
        const plane = side ? n : 0;
        this.forPlaneFaces(axis, plane, () => true, (f, lo, hi) => {
          list.push(axis, f, side ? -1 : 1, side ? lo : hi);
        });
      }
    }
    this.boundary = Int32Array.from(list);
    void g;
  }

  setModes(modes) {
    Object.assign(this.modes, modes);
    this.rebuildFaces();
  }

  setMode(slotId, mode) {
    this.modes[slotId] = mode;
    this.rebuildFaces();
  }

  /** Re-derive face flags (walls, vents, fans) from the current slot modes. */
  rebuildFaces() {
    const g = this.grid;
    const h = this.h;
    g.resetFaces();
    const old = new Map((this.fans || []).map((f) => [f.id, f.q]));
    this.fans = [];
    const alpha = (k) => (k * RHO * h) / this.dt;

    const block = (axis) => (f, lo, hi) => {
      const { K, C, F } = g.faceArrays(axis);
      if (lo < 0 || hi < 0) return;
      K[f] = FIXED; C[f] = 0; F[f] = 0;
    };
    for (const pl of [...PLATES, ...this.gpu.plates, ...this.psu.plates]) {
      const plane = Math.round(pl.at / h);
      this.forPlaneFaces(pl.axis, plane,
        (a, b) => a >= pl.min[0] && a <= pl.max[0] && b >= pl.min[1] && b <= pl.max[1],
        block(pl.axis));
    }

    this.gpuVentFaces = new Set();
    this.psuFaces = new Set();
    const makeVent = (axis, k, tag) => (f, lo, hi) => {
      const cell = lo >= 0 ? lo : hi;
      if (cell < 0 || g.solid[cell]) return;
      const { K, C, F } = g.faceArrays(axis);
      K[f] = VENT; C[f] = alpha(k); F[f] = 0;
      if (tag === 'gpu') this.gpuVentFaces.add(axis * 1e7 + f);
      if (tag === 'psu') this.psuFaces.add(axis * 1e7 + f);
    };

    for (const v of [...FIXED_VENTS, ...this.gpu.vents, ...this.psu.vents]) {
      const { axis, side } = FACES[v.face];
      const plane = side ? this.dims()[axis] : 0;
      this.forPlaneFaces(axis, plane,
        (a, b) => a >= v.min[0] && a <= v.max[0] && b >= v.min[1] && b <= v.max[1],
        makeVent(axis, v.k, v.tag));
    }

    for (const slot of SLOTS) {
      const mode = this.modes[slot.id] || 'blocked';
      const { axis, side } = FACES[slot.face];
      const plane = side ? this.dims()[axis] : 0;
      const [pa, pb] = this.planeAxes(axis);
      const ca = slot.c[pa];
      const cb = slot.c[pb];
      if (mode === 'open') {
        const half = slot.size * 0.47;
        this.forPlaneFaces(axis, plane,
          (a, b) => Math.abs(a - ca) <= half && Math.abs(b - cb) <= half,
          makeVent(axis, VENT_K.mesh));
      } else if (mode === 'intake' || mode === 'exhaust') {
        // Outward normal sign is +1 on the high side; intake pushes inward.
        const outward = side ? 1 : -1;
        const dir = mode === 'exhaust' ? outward : -outward;
        this.addFan({
          id: slot.id, kind: 'case', slot, mode, axis, plane, dir,
          ca, cb, radius: (FAN_SPECS[slot.fan] || CASE_FAN).radius, hub: (FAN_SPECS[slot.fan] || CASE_FAN).hub,
          qMax: (FAN_SPECS[slot.fan] || CASE_FAN).qMax, pMax: (FAN_SPECS[slot.fan] || CASE_FAN).pMax,
        }, old);
      }
    }

    for (const f of [...INTERNAL_FANS, ...this.gpu.fans, ...this.psu.fans]) {
      this.addFan({
        id: f.id, kind: 'internal', group: f.group, axis: f.axis,
        plane: Math.round(f.at / h), dir: f.dir, ca: f.c[0], cb: f.c[1],
        radius: f.radius, hub: f.hub, qMax: f.qMax, pMax: f.pMax, tag: f.tag,
      }, old);
    }

    g.finalizeTopology();
    this.updateFanFaces(true);
  }

  addFan(spec, old) {
    const g = this.grid;
    const faces = [];
    const lo = [];
    const hi = [];
    const r2 = spec.radius * spec.radius;
    const hub2 = Math.pow(spec.hub * 0.8, 2);
    const collect = (allowHub) => {
      this.forPlaneFaces(spec.axis, spec.plane, (a, b) => {
        const d2 = (a - spec.ca) ** 2 + (b - spec.cb) ** 2;
        return d2 <= r2 && (allowHub || d2 >= hub2);
      }, (f, l, hgh) => {
        if ((l >= 0 && g.solid[l]) || (hgh >= 0 && g.solid[hgh])) return;
        faces.push(f); lo.push(l); hi.push(hgh);
      });
    };
    collect(false);
    if (faces.length < 4) { faces.length = 0; lo.length = 0; hi.length = 0; collect(true); }
    if (!faces.length) return;
    const { K, C } = g.faceArrays(spec.axis);
    for (const f of faces) { K[f] = FIXED; C[f] = 0; }
    if (spec.tag === 'psu') for (const f of faces) this.psuFaces.add(spec.axis * 1e7 + f);
    this.fans.push({
      ...spec,
      faces: Int32Array.from(faces),
      lo: Int32Array.from(lo),
      hi: Int32Array.from(hi),
      area: faces.length * this.h * this.h,
      q: old.get(spec.id) ?? 0,
      dp: 0,
      speed: 0,
      angle: 0,
    });
  }

  // -------------------------------------------------------------------------
  // Stepping
  // -------------------------------------------------------------------------

  fanSpeedFor(fan) {
    if (fan.kind === 'case') return this.caseFanSpeed;
    const grp = this.groups[fan.group];
    return grp.fanSpeed;
  }

  /** Apply each fan's static-pressure curve and write its face velocities. */
  updateFanFaces(instant = false) {
    const g = this.grid;
    const p = g.p;
    const ps = this.pScale;
    for (const fan of this.fans) {
      const s = this.fanSpeedFor(fan);
      fan.speed = s;
      let sum = 0;
      for (let n = 0; n < fan.faces.length; n++) {
        const pl = fan.lo[n] >= 0 ? p[fan.lo[n]] : 0;
        const ph = fan.hi[n] >= 0 ? p[fan.hi[n]] : 0;
        sum += fan.dir > 0 ? ph - pl : pl - ph;
      }
      fan.dp = (sum / fan.faces.length) * ps; // Pa the fan works against
      let target = 0;
      if (s > 0.01) {
        target = s * fan.qMax * (1 - fan.dp / (s * s * fan.pMax));
        target = Math.max(0, Math.min(1.3 * s * fan.qMax, target));
      }
      fan.q = instant && fan.q === 0 ? target : fan.q + (target - fan.q) * 0.12;
      const vel = (fan.dir * fan.q) / fan.area;
      const { F } = g.faceArrays(fan.axis);
      for (let n = 0; n < fan.faces.length; n++) F[fan.faces[n]] = vel;
    }
  }

  step() {
    const g = this.grid;
    g.ambient = this.ambient;
    this.updateCoolerFans();
    this.updateFanFaces();
    g.advectVelocity();
    g.applyForces();
    g.applyFixed();
    g.project();
    g.advectTemperature();
    g.applyThermalBoundaries();
    this.exchangeHeat();
    this.time += this.dt;
  }

  updateCoolerFans() {
    for (const grp of Object.values(this.groups)) {
      if (grp.def.hybrid) {
        // Fanless until warm, with hysteresis, then ramps with temperature.
        if (grp.fanOn && grp.die < 45) grp.fanOn = false;
        else if (!grp.fanOn && grp.die > 55) grp.fanOn = true;
        const t = grp.fanOn ? Math.min(1, Math.max(0.3, 0.3 + ((grp.die - 50) / 30) * 0.7)) : 0;
        grp.fanSpeed += (t - grp.fanSpeed) * 0.02;
        continue;
      }
      const target = this.coolerAuto[grp.id] ? fanCurve(grp.die) : this.coolerManual[grp.id];
      grp.fanSpeed += (target - grp.fanSpeed) * 0.02;
    }
  }

  exchangeHeat() {
    const g = this.grid;
    const dt = this.dt;
    const cAir = RHO_CP * this.h ** 3;
    const vel = [0, 0, 0];
    const nx = g.nx;
    const nxy = g.nx * g.ny;
    for (const grp of Object.values(this.groups)) {
      const { cells, def } = grp;
      if (!cells.length) continue;
      let vsum = 0;
      let tsum = 0;
      for (let n = 0; n < cells.length; n++) {
        const c = cells[n];
        const k = (c / nxy) | 0;
        const j = ((c - k * nxy) / nx) | 0;
        const i = c - k * nxy - j * nx;
        g.cellVel(i, j, k, vel);
        vsum += Math.hypot(vel[0], vel[1], vel[2]);
        tsum += g.T[c];
      }
      grp.speed = vsum / cells.length;
      grp.airTemp = tsum / cells.length;
      grp.G = def.G0 + def.G1 * Math.pow(grp.speed, 0.8);
      const gc = grp.G / cells.length;
      const a = (gc * dt) / cAir;
      const f = a / (1 + a);
      let qTotal = 0;
      const T = g.T;
      for (let n = 0; n < cells.length; n++) {
        const c = cells[n];
        const dT = (grp.sink - T[c]) * f;
        T[c] += dT;
        qTotal += dT;
      }
      qTotal *= cAir / dt; // W into the air
      let power;
      if (grp.def.hybrid) {
        // PSU loss from the DC load it is delivering this step.
        const cpu = this.groups.cpu, gpu = this.groups.gpu;
        const load = this.power.cpu * cpu.throttle + this.power.gpu * gpu.throttle + PSU.baseLoad;
        const eff = psuEfficiency(load / PSU.rating);
        this.psuLoad = load;
        this.psuEff = eff;
        power = load * (1 / eff - 1);
      } else {
        power = this.power[grp.id] * grp.throttle;
      }
      grp.heatOut = qTotal;
      grp.power = power;
      grp.sink += ((power - qTotal) * dt) / def.cap;
      grp.die = grp.sink + power * def.rjc;
      // Crude thermal throttling.
      const over = grp.die > def.tjMax;
      grp.throttle = Math.max(0.35, Math.min(1, grp.throttle + (over ? -0.6 : 0.25) * dt));
    }
  }

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  stats() {
    const g = this.grid;
    const b = this.boundary;
    const h2 = this.h * this.h;
    let fanIn = 0, fanOut = 0, ventIn = 0, ventOut = 0, gpuOut = 0, psuIn = 0, psuOut = 0, outT = 0;
    for (let n = 0; n < b.length; n += 4) {
      const axis = b[n];
      const f = b[n + 1];
      const sign = b[n + 2];
      const cell = b[n + 3];
      const { K, vel } = g.faceArrays(axis);
      const kind = K[f];
      if (kind === FREE) continue;
      const q = vel[f] * sign * h2; // inward flux
      if (q === 0) continue;
      if (this.psuFaces.has(axis * 1e7 + f)) {
        if (q > 0) psuIn += q; else psuOut -= q;
        continue;
      }
      const isVent = kind === VENT;
      if (q > 0) { if (isVent) ventIn += q; else fanIn += q; }
      else {
        if (!isVent) fanOut -= q;
        else if (this.gpuVentFaces.has(axis * 1e7 + f)) gpuOut -= q;
        else ventOut -= q;
        outT += -q * g.T[cell];
      }
    }
    let pSum = 0, tSum = 0, nFluid = 0, tMax = -Infinity;
    for (let c = 0; c < g.n; c++) {
      if (g.solid[c]) continue;
      pSum += g.p[c];
      tSum += g.T[c];
      if (g.T[c] > tMax) tMax = g.T[c];
      nFluid++;
    }
    const totalOut = fanOut + ventOut + gpuOut;
    return {
      fanIn, fanOut, ventIn, ventOut, gpuOut, psuIn, psuOut, gpuType: this.gpuType,
      psuMode: this.psuMode, psuLoad: this.psuLoad, psuEff: this.psuEff ?? 0.9,
      totalIn: fanIn + ventIn,
      totalOut,
      pressure: (pSum / nFluid) * this.pScale,
      airTemp: tSum / nFluid,
      airMax: tMax,
      exhaustTemp: totalOut > 0 ? outT / totalOut : this.ambient,
      cfm: (q) => q * CFM_PER_M3S,
    };
  }

  /** Velocity at an arbitrary point (case coordinates, meters). */
  velocityAt(x, y, z, out) {
    const g = this.grid;
    out[0] = g.sampleU(x, y, z);
    out[1] = g.sampleV(x, y, z);
    out[2] = g.sampleW(x, y, z);
    return out;
  }

  isSolidAt(x, y, z) {
    const g = this.grid;
    const i = Math.floor(x / this.h);
    const j = Math.floor(y / this.h);
    const k = Math.floor(z / this.h);
    if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz) return true;
    return g.solid[g.ci(i, j, k)] === 1;
  }

  /**
   * Faces through which air currently enters the case, with flux weights.
   * Returns flat [x, y, z, nx, ny, nz, weight, sourceId] records.
   */
  inflowSources() {
    const g = this.grid;
    const h = this.h;
    const b = this.boundary;
    const out = [];
    const slotByFace = this.slotLookup();
    for (let n = 0; n < b.length; n += 4) {
      const axis = b[n];
      const f = b[n + 1];
      const sign = b[n + 2];
      const { K, vel } = g.faceArrays(axis);
      if (K[f] === FREE) continue;
      const q = vel[f] * sign;
      if (q <= 1e-4) continue;
      const pos = this.facePosition(axis, f);
      const nrm = [0, 0, 0];
      nrm[axis] = sign;
      out.push(pos[0], pos[1], pos[2], nrm[0], nrm[1], nrm[2], q * h * h, slotByFace.get(axis * 1e7 + f) ?? -1);
    }
    return out;
  }

  slotLookup() {
    if (this._slotLookup && this._slotLookupFans === this.fans) return this._slotLookup;
    const m = new Map();
    SLOTS.forEach((slot, idx) => {
      const { axis, side } = FACES[slot.face];
      const plane = side ? this.dims()[axis] : 0;
      const [pa, pb] = this.planeAxes(axis);
      const half = slot.size / 2;
      this.forPlaneFaces(axis, plane,
        (a, b) => Math.abs(a - slot.c[pa]) <= half && Math.abs(b - slot.c[pb]) <= half,
        (f) => m.set(axis * 1e7 + f, idx));
    });
    this._slotLookup = m;
    this._slotLookupFans = this.fans;
    return m;
  }

  facePosition(axis, f) {
    const g = this.grid;
    const h = this.h;
    const sx = axis === 0 ? g.nx + 1 : g.nx;
    const sy = axis === 1 ? g.ny + 1 : g.ny;
    const i = f % sx;
    const j = Math.floor(f / sx) % sy;
    const k = Math.floor(f / (sx * sy));
    const pos = [(i + 0.5) * h, (j + 0.5) * h, (k + 0.5) * h];
    pos[axis] = [i, j, k][axis] * h;
    return pos;
  }

  /** Total heat (W) currently delivered to the air by each group. */
  summary() {
    const s = this.stats();
    const fans = this.fans.map((f) => ({
      id: f.id, kind: f.kind, mode: f.mode, cfm: f.q * CFM_PER_M3S, speed: f.speed, dp: f.dp,
    }));
    const groups = Object.fromEntries(Object.values(this.groups).map((grp) => [grp.id, {
      die: grp.die, sink: grp.sink, air: grp.airTemp, speed: grp.speed, power: grp.power ?? 0,
      throttle: grp.throttle, fan: grp.fanSpeed, heatOut: grp.heatOut,
    }]));
    return { ...s, fans, groups };
  }
}
