import * as THREE from 'three';
import { heat, turbo, diverging } from './colormap.js';
import { PSU } from '../sim/model.js';

const PLANE_AXES = [[1, 2], [0, 2], [0, 1]];

const inPsu = (idx, h) => [0, 1, 2].every((k) => {
  const x = (idx[k] + 0.5) * h;
  return x > PSU.min[k] && x < PSU.max[k];
});

/** A colored cross-section through the grid showing speed, temperature or pressure. */
export class Slice {
  constructor() {
    this.axis = 0;
    this.frac = 0.5;
    this.mode = 'speed';
    this.group = new THREE.Group();
    this.mesh = null;
    this.range = 1;
  }

  setField(field, pScale) {
    this.field = field;
    this.pScale = pScale;
    this.rebuild();
  }

  configure({ axis, frac, mode }) {
    const rebuild = axis !== undefined && axis !== this.axis;
    if (axis !== undefined) this.axis = axis;
    if (frac !== undefined) this.frac = frac;
    if (mode !== undefined) this.mode = mode;
    if (rebuild) this.rebuild();
    else this.place();
  }

  rebuild() {
    if (!this.field) return;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.map.dispose();
      this.mesh.material.dispose();
    }
    const f = this.field;
    const n = [f.nx, f.ny, f.nz];
    const [pa, pb] = PLANE_AXES[this.axis];
    this.tw = n[pa];
    this.th = n[pb];
    this.data = new Uint8Array(this.tw * this.th * 4);
    const tex = new THREE.DataTexture(this.data, this.tw, this.th, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;

    const A = n[pa] * f.h;
    const B = n[pb] * f.h;
    const corners = [[0, 0], [A, 0], [A, B], [0, B]];
    const pos = new Float32Array(12);
    corners.forEach(([a, b], idx) => {
      const p = [0, 0, 0];
      p[pa] = a;
      p[pb] = b;
      pos.set(p, idx * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.88, toneMapped: false,
    }));
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    this.place();
  }

  place() {
    if (!this.mesh) return;
    const f = this.field;
    const n = [f.nx, f.ny, f.nz][this.axis];
    this.index = Math.min(n - 1, Math.max(0, Math.floor(this.frac * n)));
    this.mesh.position.set(0, 0, 0);
    this.mesh.position.setComponent(this.axis, (this.index + 0.5) * f.h);
  }

  update(ambient) {
    if (!this.mesh || !this.group.visible) return;
    const f = this.field;
    const [pa, pb] = PLANE_AXES[this.axis];
    const idx = [0, 0, 0];
    idx[this.axis] = this.index;
    const vel = [0, 0, 0];
    const c = [0, 0, 0];
    const d = this.data;
    // Auto-range pressure symmetrically.
    // Auto-range pressure on the 95th percentile so fan-face spikes do not wash it out.
    let pMax = 0.5;
    if (this.mode === 'pressure') {
      const vals = [];
      for (let b = 0; b < this.th; b++) for (let a = 0; a < this.tw; a++) {
        idx[pa] = a; idx[pb] = b;
        const cell = f.ci(idx[0], idx[1], idx[2]);
        if (!f.solid[cell] && !inPsu(idx, f.h)) vals.push(Math.abs(f.p[cell] * this.pScale));
      }
      vals.sort((x, y) => x - y);
      if (vals.length) pMax = Math.max(0.5, vals[Math.floor(vals.length * 0.95)]);
      this.range = pMax;
    }
    for (let b = 0; b < this.th; b++) {
      for (let a = 0; a < this.tw; a++) {
        idx[pa] = a; idx[pb] = b;
        const cell = f.ci(idx[0], idx[1], idx[2]);
        const o = (a + b * this.tw) * 4;
        // Only case air: solid parts and the sealed PSU interior stay clear.
        if (f.solid[cell] || inPsu(idx, f.h)) {
          d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
          continue;
        }
        if (this.mode === 'speed') {
          f.cellVel(idx[0], idx[1], idx[2], vel);
          turbo(Math.hypot(vel[0], vel[1], vel[2]) / 3, c);
        } else if (this.mode === 'temperature') {
          heat((f.T[cell] - ambient) / 20, c);
        } else {
          diverging((f.p[cell] * this.pScale) / pMax, c);
        }
        d[o] = c[0] * 255; d[o + 1] = c[1] * 255; d[o + 2] = c[2] * 255; d[o + 3] = 235;
      }
    }
    this.mesh.material.map.needsUpdate = true;
  }
}
