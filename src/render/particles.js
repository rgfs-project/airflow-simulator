import * as THREE from 'three';
import { heat, turbo, SOURCE_COLORS, VENT_COLOR } from './colormap.js';

/**
 * Streak particles advected through the velocity field. Each particle keeps a
 * short ring buffer of past positions that is drawn as fading line segments.
 */
export class Particles {
  constructor(maxCount = 12000, trail = 14) {
    this.max = maxCount;
    this.L = trail;
    this.count = 4000;
    this.pos = new Float32Array(maxCount * 3);
    this.hist = new Float32Array(maxCount * trail * 3);
    this.age = new Float32Array(maxCount);
    this.life = new Float32Array(maxCount);
    this.src = new Int16Array(maxCount);
    this.col = new Float32Array(maxCount * 3);
    this.head = 0;
    this.sources = null;
    this.cdf = null;
    this.seedMix = 0.15;
    this.colorMode = 'temperature';
    this.tempRange = 20;
    this.speedRange = 3;
    this.brightness = 0.9;
    this.colorScale = 1;

    const segs = maxCount * (trail - 1);
    this.positions = new Float32Array(segs * 6);
    this.colors = new Float32Array(segs * 8);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.1, 0.23, 0.22), 1);
    this.object = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
    this.initialized = false;
    this.v1 = [0, 0, 0];
    this.v2 = [0, 0, 0];
  }

  setField(field) {
    this.field = field;
    this.W = field.nx * field.h;
    this.H = field.ny * field.h;
    this.D = field.nz * field.h;
    this.initialized = false;
  }

  setSources(src) {
    if (!src || !src.length) return;
    this.sources = src;
    const n = src.length / 8;
    const cdf = new Float32Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += src[i * 8 + 6]; cdf[i] = acc; }
    this.cdf = cdf;
    this.total = acc;
  }

  setCount(n) {
    const old = this.count;
    this.count = Math.min(this.max, n);
    if (!this.field || !this.initialized) return;
    for (let p = old; p < this.count; p++) this.spawn(p, true);
    this.posAttr.needsUpdate = true;
  }

  solidAt(x, y, z) {
    const f = this.field;
    const i = Math.floor(x / f.h), j = Math.floor(y / f.h), k = Math.floor(z / f.h);
    if (i < 0 || j < 0 || k < 0 || i >= f.nx || j >= f.ny || k >= f.nz) return true;
    return f.solid[i + f.nx * (j + f.ny * k)] === 1;
  }

  spawn(p, initial = false) {
    const f = this.field;
    const h = f.h;
    let x, y, z;
    let src = -2;
    const fromSource = this.cdf && this.total > 0 && Math.random() >= this.seedMix && !initial;
    if (fromSource) {
      const r = Math.random() * this.total;
      let lo = 0, hi = this.cdf.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.cdf[mid] < r) lo = mid + 1; else hi = mid;
      }
      const s = this.sources;
      const o = lo * 8;
      const nrm = [s[o + 3], s[o + 4], s[o + 5]];
      const jitter = () => (Math.random() - 0.5) * h;
      x = s[o] + (nrm[0] ? 0 : jitter()) + nrm[0] * h * 0.3 * Math.random();
      y = s[o + 1] + (nrm[1] ? 0 : jitter()) + nrm[1] * h * 0.3 * Math.random();
      z = s[o + 2] + (nrm[2] ? 0 : jitter()) + nrm[2] * h * 0.3 * Math.random();
      x += nrm[0] * 1e-4; y += nrm[1] * 1e-4; z += nrm[2] * 1e-4;
      src = s[o + 7];
    } else {
      for (let tries = 0; tries < 20; tries++) {
        x = Math.random() * this.W;
        y = Math.random() * this.H;
        z = Math.random() * this.D;
        if (!this.solidAt(x, y, z)) break;
      }
    }
    const i3 = p * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    const L = this.L;
    for (let s = 0; s < L; s++) {
      const o = (p * L + s) * 3;
      this.hist[o] = x; this.hist[o + 1] = y; this.hist[o + 2] = z;
    }
    this.age[p] = initial ? Math.random() * 1.5 : 0;
    this.life[p] = 1.2 + Math.random() * 2.5;
    this.src[p] = src;
  }

  vel(x, y, z, out) {
    const f = this.field;
    out[0] = f.sampleU(x, y, z);
    out[1] = f.sampleV(x, y, z);
    out[2] = f.sampleW(x, y, z);
    return out;
  }

  /** Advance particles by `dt` seconds of simulated time and rebuild the line buffers. */
  update(dt, ambient) {
    if (!this.field) return;
    if (!this.initialized) {
      for (let p = 0; p < this.count; p++) this.spawn(p, true);
      this.initialized = true;
    }
    const { pos, hist, L, v1, v2 } = this;
    const h = this.field.h;
    const moving = dt > 0;
    if (moving) this.head = (this.head + 1) % L;
    const head = this.head;
    const c = [0, 0, 0];
    const mode = this.colorMode;
    for (let p = 0; p < this.count; p++) {
      const i3 = p * 3;
      let x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2];
      if (moving) {
        this.age[p] += dt;
        // Sub-step so no particle moves more than ~half a cell per step.
        this.vel(x, y, z, v1);
        const sp = Math.abs(v1[0]) + Math.abs(v1[1]) + Math.abs(v1[2]);
        const n = Math.min(6, Math.max(1, Math.ceil((sp * dt) / (h * 0.5))));
        const sdt = dt / n;
        let dead = false;
        for (let s = 0; s < n; s++) {
          if (s > 0) this.vel(x, y, z, v1);
          this.vel(x + 0.5 * sdt * v1[0], y + 0.5 * sdt * v1[1], z + 0.5 * sdt * v1[2], v2);
          x += sdt * v2[0]; y += sdt * v2[1]; z += sdt * v2[2];
          if (this.solidAt(x, y, z)) { dead = true; break; }
        }
        if (dead || this.age[p] > this.life[p]) {
          this.spawn(p);
          x = pos[i3]; y = pos[i3 + 1]; z = pos[i3 + 2];
        } else {
          pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z;
          const o = (p * L + head) * 3;
          hist[o] = x; hist[o + 1] = y; hist[o + 2] = z;
        }
      }

      // Color for this particle.
      if (mode === 'temperature') {
        heat((this.field.sampleT(x, y, z) - ambient) / this.tempRange, c);
      } else if (mode === 'speed') {
        this.vel(x, y, z, v1);
        turbo(Math.hypot(v1[0], v1[1], v1[2]) / this.speedRange, c);
      } else {
        const s = this.src[p];
        const sc = s >= 0 ? SOURCE_COLORS[s % SOURCE_COLORS.length] : s === -1 ? VENT_COLOR : [0.55, 0.55, 0.6];
        c[0] = sc[0]; c[1] = sc[1]; c[2] = sc[2];
      }
      if (this.colorScale !== 1) { c[0] *= this.colorScale; c[1] *= this.colorScale; c[2] *= this.colorScale; }
      // Fade in after spawning and out before dying.
      const a = this.age[p];
      const env = Math.min(1, a / 0.12, (this.life[p] - a) / 0.3);
      const bright = Math.max(0, env) * this.brightness;

      const base = p * (L - 1) * 6;
      for (let s = 0; s < L - 1; s++) {
        const na = ((head - s + L) % L) * 3 + p * L * 3;
        const nb = ((head - s - 1 + L) % L) * 3 + p * L * 3;
        const o = base + s * 6;
        this.positions[o] = hist[na];
        this.positions[o + 1] = hist[na + 1];
        this.positions[o + 2] = hist[na + 2];
        this.positions[o + 3] = hist[nb];
        this.positions[o + 4] = hist[nb + 1];
        this.positions[o + 5] = hist[nb + 2];
        const oc = (base / 6 + s) * 8;
        const cl = this.colors;
        cl[oc] = c[0]; cl[oc + 1] = c[1]; cl[oc + 2] = c[2]; cl[oc + 3] = bright * (1 - s / (L - 1));
        cl[oc + 4] = c[0]; cl[oc + 5] = c[1]; cl[oc + 6] = c[2]; cl[oc + 7] = bright * (1 - (s + 1) / (L - 1));
      }
    }
    const used = this.count * (L - 1) * 2;
    this.object.geometry.setDrawRange(0, used);
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, used * 3);
    this.colAttr.clearUpdateRanges();
    this.colAttr.addUpdateRange(0, used * 4);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
