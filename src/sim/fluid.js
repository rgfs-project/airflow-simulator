// Incompressible air solver on a staggered (MAC) grid.
//
// Velocities live on cell faces, pressure and temperature at cell centers.
// Each step: semi-Lagrangian advection -> body forces (buoyancy, fin drag)
// -> fixed faces (walls, fans) -> pressure projection (red-black SOR).
//
// Pressure is stored in "kinematic" units p' = p * dt / (rho * h) so that a
// face update is simply  u -= coef * (p'_right - p'_left).

export const FREE = 0;
export const FIXED = 1;
export const VENT = 2;

export class FluidGrid {
  constructor(nx, ny, nz, h, dt) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.h = h;
    this.dt = dt;
    const n = nx * ny * nz;
    this.n = n;
    this.nu = (nx + 1) * ny * nz;
    this.nv = nx * (ny + 1) * nz;
    this.nw = nx * ny * (nz + 1);

    this.solid = new Uint8Array(n);
    this.dragX = new Float32Array(n);
    this.dragY = new Float32Array(n);
    this.dragZ = new Float32Array(n);
    this.p = new Float32Array(n);
    this.diag = new Float32Array(n);
    this.rhs = new Float32Array(n);
    this.T = new Float32Array(n);
    this.T0 = new Float32Array(n);

    this.u = new Float32Array(this.nu);
    this.v = new Float32Array(this.nv);
    this.w = new Float32Array(this.nw);
    this.u0 = new Float32Array(this.nu);
    this.v0 = new Float32Array(this.nv);
    this.w0 = new Float32Array(this.nw);

    // Face kinds, pressure coefficients and fixed values.
    this.uK = new Uint8Array(this.nu);
    this.vK = new Uint8Array(this.nv);
    this.wK = new Uint8Array(this.nw);
    this.uC = new Float32Array(this.nu);
    this.vC = new Float32Array(this.nv);
    this.wC = new Float32Array(this.nw);
    this.uF = new Float32Array(this.nu);
    this.vF = new Float32Array(this.nv);
    this.wF = new Float32Array(this.nw);

    this.ambient = 22;
    this.buoyancy = true;
    this.damping = 0.3; // 1/s, stands in for turbulent momentum loss
    this.wallLoss = 0.08; // 1/s, heat lost through the case panels
    this.iterations = 40;
    this.omega = 1.75;

    // Solid cells that touch fluid; their temperature is extrapolated from the
    // neighbouring air so the advection does not pull in garbage values.
    this.solidSkin = [];
  }

  // ---- indexing -----------------------------------------------------------
  ci(i, j, k) { return i + this.nx * (j + this.ny * k); }
  ui(i, j, k) { return i + (this.nx + 1) * (j + this.ny * k); }
  vi(i, j, k) { return i + this.nx * (j + (this.ny + 1) * k); }
  wi(i, j, k) { return i + this.nx * (j + this.ny * k); }

  // ---- topology -----------------------------------------------------------

  /** Reset all face flags to "walls on the boundary, free inside, closed at solids". */
  resetFaces() {
    const { nx, ny, nz, solid } = this;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const f = this.ui(i, j, k);
      const wall = i === 0 || i === nx || solid[this.ci(i - 1, j, k)] || solid[this.ci(i, j, k)];
      this.setFace(this.uK, this.uC, this.uF, f, wall);
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.vi(i, j, k);
      const wall = j === 0 || j === ny || solid[this.ci(i, j - 1, k)] || solid[this.ci(i, j, k)];
      this.setFace(this.vK, this.vC, this.vF, f, wall);
    }
    for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.wi(i, j, k);
      const wall = k === 0 || k === nz || solid[this.ci(i, j, k - 1)] || solid[this.ci(i, j, k)];
      this.setFace(this.wK, this.wC, this.wF, f, wall);
    }
  }

  setFace(K, C, F, f, wall) {
    K[f] = wall ? FIXED : FREE;
    C[f] = wall ? 0 : 1;
    F[f] = 0;
  }

  faceArrays(axis) {
    if (axis === 0) return { K: this.uK, C: this.uC, F: this.uF, vel: this.u };
    if (axis === 1) return { K: this.vK, C: this.vC, F: this.vF, vel: this.v };
    return { K: this.wK, C: this.wC, F: this.wF, vel: this.w };
  }

  faceIndex(axis, a, b, c) {
    if (axis === 0) return this.ui(a, b, c);
    if (axis === 1) return this.vi(a, b, c);
    return this.wi(a, b, c);
  }

  /** Cells on the low/high side of a face (-1 when outside the domain). */
  faceCells(axis, i, j, k) {
    const { nx, ny, nz } = this;
    let lo = -1;
    let hi = -1;
    if (axis === 0) {
      if (i > 0) lo = this.ci(i - 1, j, k);
      if (i < nx) hi = this.ci(i, j, k);
    } else if (axis === 1) {
      if (j > 0) lo = this.ci(i, j - 1, k);
      if (j < ny) hi = this.ci(i, j, k);
    } else {
      if (k > 0) lo = this.ci(i, j, k - 1);
      if (k < nz) hi = this.ci(i, j, k);
    }
    return [lo, hi];
  }

  /** Recompute the SOR diagonal and solid skin after face flags changed. */
  finalizeTopology() {
    const { nx, ny, nz, solid, diag } = this;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.ci(i, j, k);
      if (solid[c]) { diag[c] = 0; continue; }
      diag[c] =
        this.uC[this.ui(i, j, k)] + this.uC[this.ui(i + 1, j, k)] +
        this.vC[this.vi(i, j, k)] + this.vC[this.vi(i, j + 1, k)] +
        this.wC[this.wi(i, j, k)] + this.wC[this.wi(i, j, k + 1)];
    }
    this.solidSkin = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.ci(i, j, k);
      if (!solid[c]) continue;
      const nb = [];
      if (i > 0 && !solid[c - 1]) nb.push(c - 1);
      if (i < nx - 1 && !solid[c + 1]) nb.push(c + 1);
      if (j > 0 && !solid[c - nx]) nb.push(c - nx);
      if (j < ny - 1 && !solid[c + nx]) nb.push(c + nx);
      if (k > 0 && !solid[c - nx * ny]) nb.push(c - nx * ny);
      if (k < nz - 1 && !solid[c + nx * ny]) nb.push(c + nx * ny);
      if (nb.length) this.solidSkin.push(c, nb);
    }
  }

  applyFixed() {
    applyFixedArr(this.u, this.uK, this.uF);
    applyFixedArr(this.v, this.vK, this.vF);
    applyFixedArr(this.w, this.wK, this.wF);
  }

  // ---- sampling -----------------------------------------------------------

  sampleU(x, y, z) {
    const h = this.h;
    return trilerp(this.u, this.nx + 1, this.ny, this.nz, x / h, y / h - 0.5, z / h - 0.5);
  }
  sampleV(x, y, z) {
    const h = this.h;
    return trilerp(this.v, this.nx, this.ny + 1, this.nz, x / h - 0.5, y / h, z / h - 0.5);
  }
  sampleW(x, y, z) {
    const h = this.h;
    return trilerp(this.w, this.nx, this.ny, this.nz + 1, x / h - 0.5, y / h - 0.5, z / h);
  }
  sampleT(x, y, z) {
    const h = this.h;
    return trilerp(this.T, this.nx, this.ny, this.nz, x / h - 0.5, y / h - 0.5, z / h - 0.5);
  }
  sampleP(x, y, z) {
    const h = this.h;
    return trilerp(this.p, this.nx, this.ny, this.nz, x / h - 0.5, y / h - 0.5, z / h - 0.5);
  }

  /** Velocity at the center of a cell. */
  cellVel(i, j, k, out) {
    out[0] = 0.5 * (this.u[this.ui(i, j, k)] + this.u[this.ui(i + 1, j, k)]);
    out[1] = 0.5 * (this.v[this.vi(i, j, k)] + this.v[this.vi(i, j + 1, k)]);
    out[2] = 0.5 * (this.w[this.wi(i, j, k)] + this.w[this.wi(i, j, k + 1)]);
    return out;
  }

  // ---- step parts ---------------------------------------------------------

  advectVelocity() {
    const { nx, ny, nz, h, dt } = this;
    const { u, v, w, u0, v0, w0 } = this;
    for (let k = 0; k < nz; k++) {
      const z = (k + 0.5) * h;
      for (let j = 0; j < ny; j++) {
        const y = (j + 0.5) * h;
        for (let i = 0; i <= nx; i++) {
          const f = this.ui(i, j, k);
          if (this.uK[f] !== FREE) { u0[f] = 0; continue; }
          const x = i * h;
          u0[f] = this.sampleU(x - dt * u[f], y - dt * this.sampleV(x, y, z), z - dt * this.sampleW(x, y, z));
        }
      }
    }
    for (let k = 0; k < nz; k++) {
      const z = (k + 0.5) * h;
      for (let j = 0; j <= ny; j++) {
        const y = j * h;
        for (let i = 0; i < nx; i++) {
          const f = this.vi(i, j, k);
          if (this.vK[f] !== FREE) { v0[f] = 0; continue; }
          const x = (i + 0.5) * h;
          v0[f] = this.sampleV(x - dt * this.sampleU(x, y, z), y - dt * v[f], z - dt * this.sampleW(x, y, z));
        }
      }
    }
    for (let k = 0; k <= nz; k++) {
      const z = k * h;
      for (let j = 0; j < ny; j++) {
        const y = (j + 0.5) * h;
        for (let i = 0; i < nx; i++) {
          const f = this.wi(i, j, k);
          if (this.wK[f] !== FREE) { w0[f] = 0; continue; }
          const x = (i + 0.5) * h;
          w0[f] = this.sampleW(x - dt * this.sampleU(x, y, z), y - dt * this.sampleV(x, y, z), z - dt * w[f]);
        }
      }
    }
    this.u = u0; this.u0 = u;
    this.v = v0; this.v0 = v;
    this.w = w0; this.w0 = w;
  }

  applyForces() {
    const { nx, ny, nz, dt, T } = this;
    const damp = 1 / (1 + this.damping * dt);
    const g = this.buoyancy ? (9.81 * dt) / (273.15 + this.ambient) : 0;
    const amb = this.ambient;
    // u faces
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) {
      const f = this.ui(i, j, k);
      if (this.uK[f] !== FREE) continue;
      const c = this.ci(i, j, k);
      const kd = 0.5 * (this.dragX[c] + this.dragX[c - 1]);
      this.u[f] *= damp / (1 + kd * dt);
    }
    // v faces (+ buoyancy)
    for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.vi(i, j, k);
      if (this.vK[f] !== FREE) continue;
      const c = this.ci(i, j, k);
      const cb = c - nx;
      const kd = 0.5 * (this.dragY[c] + this.dragY[cb]);
      const dT = 0.5 * (T[c] + T[cb]) - amb;
      this.v[f] = (this.v[f] + g * dT) * damp / (1 + kd * dt);
    }
    // w faces
    const sz = nx * ny;
    for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.wi(i, j, k);
      if (this.wK[f] !== FREE) continue;
      const c = this.ci(i, j, k);
      const kd = 0.5 * (this.dragZ[c] + this.dragZ[c - sz]);
      this.w[f] *= damp / (1 + kd * dt);
    }
  }

  project() {
    const { nx, ny, nz, solid, diag, rhs, p, u, v, w, uC, vC, wC } = this;
    const sx = 1;
    const sy = nx;
    const sz = nx * ny;
    // Vent faces carry no momentum: their flow is set purely by pressure.
    zeroVents(u, this.uK);
    zeroVents(v, this.vK);
    zeroVents(w, this.wK);

    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.ci(i, j, k);
      if (solid[c]) { rhs[c] = 0; continue; }
      rhs[c] =
        u[this.ui(i + 1, j, k)] - u[this.ui(i, j, k)] +
        v[this.vi(i, j + 1, k)] - v[this.vi(i, j, k)] +
        w[this.wi(i, j, k + 1)] - w[this.wi(i, j, k)];
    }

    const omega = this.omega;
    for (let it = 0; it < this.iterations; it++) {
      for (let color = 0; color < 2; color++) {
        for (let k = 0; k < nz; k++) {
          for (let j = 0; j < ny; j++) {
            let i = (j + k + color) & 1;
            for (; i < nx; i += 2) {
              const c = i + nx * (j + ny * k);
              const d = diag[c];
              if (d === 0) continue;
              let s = 0;
              let cf;
              cf = uC[i + (nx + 1) * (j + ny * k)];
              if (cf && i > 0) s += cf * p[c - sx];
              cf = uC[i + 1 + (nx + 1) * (j + ny * k)];
              if (cf && i < nx - 1) s += cf * p[c + sx];
              cf = vC[i + nx * (j + (ny + 1) * k)];
              if (cf && j > 0) s += cf * p[c - sy];
              cf = vC[i + nx * (j + 1 + (ny + 1) * k)];
              if (cf && j < ny - 1) s += cf * p[c + sy];
              cf = wC[c];
              if (cf && k > 0) s += cf * p[c - sz];
              cf = wC[c + sz];
              if (cf && k < nz - 1) s += cf * p[c + sz];
              const pn = (s - rhs[c]) / d;
              p[c] += omega * (pn - p[c]);
            }
          }
        }
      }
    }

    // Subtract the pressure gradient (ghost pressure outside the case is 0).
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const f = this.ui(i, j, k);
      const cf = uC[f];
      if (!cf) continue;
      const pl = i > 0 ? p[this.ci(i - 1, j, k)] : 0;
      const pr = i < nx ? p[this.ci(i, j, k)] : 0;
      u[f] -= cf * (pr - pl);
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.vi(i, j, k);
      const cf = vC[f];
      if (!cf) continue;
      const pl = j > 0 ? p[this.ci(i, j - 1, k)] : 0;
      const pr = j < ny ? p[this.ci(i, j, k)] : 0;
      v[f] -= cf * (pr - pl);
    }
    for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.wi(i, j, k);
      const cf = wC[f];
      if (!cf) continue;
      const pl = k > 0 ? p[this.ci(i, j, k - 1)] : 0;
      const pr = k < nz ? p[this.ci(i, j, k)] : 0;
      w[f] -= cf * (pr - pl);
    }
  }

  /** Largest absolute cell divergence (m/s per cell), for diagnostics/tests. */
  maxDivergence() {
    const { nx, ny, nz, solid, u, v, w } = this;
    let m = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.ci(i, j, k);
      if (solid[c] || this.diag[c] === 0) continue;
      const d =
        u[this.ui(i + 1, j, k)] - u[this.ui(i, j, k)] +
        v[this.vi(i, j + 1, k)] - v[this.vi(i, j, k)] +
        w[this.wi(i, j, k + 1)] - w[this.wi(i, j, k)];
      if (Math.abs(d) > m) m = Math.abs(d);
    }
    return m;
  }

  /**
   * Conservative first-order upwind transport of temperature using the
   * (discretely divergence-free) face fluxes. Air entering from outside the
   * case carries the ambient temperature. Substeps keep the scheme stable.
   */
  advectTemperature() {
    const { nx, ny, nz, h, dt, solid } = this;
    const T = this.T;
    const acc = this.T0;
    const amb = this.ambient;
    let maxIn = 0;
    // Worst-case inflow per cell bounds the stable substep size.
    for (let c = 0; c < this.n; c++) acc[c] = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.ci(i, j, k);
      if (solid[c]) continue;
      const s =
        Math.max(0, this.u[this.ui(i, j, k)]) + Math.max(0, -this.u[this.ui(i + 1, j, k)]) +
        Math.max(0, this.v[this.vi(i, j, k)]) + Math.max(0, -this.v[this.vi(i, j + 1, k)]) +
        Math.max(0, this.w[this.wi(i, j, k)]) + Math.max(0, -this.w[this.wi(i, j, k + 1)]);
      if (s > maxIn) maxIn = s;
    }
    const steps = Math.max(1, Math.ceil((maxIn * dt) / h / 0.9));
    const r = dt / steps / h;
    const sx = 1;
    const sy = nx;
    const sz = nx * ny;
    for (let s = 0; s < steps; s++) {
      acc.fill(0);
      // x faces
      const u = this.u;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
        let f = this.ui(0, j, k);
        let c = this.ci(0, j, k);
        for (let i = 0; i <= nx; i++, f++, c++) {
          const F = u[f];
          if (F === 0) continue;
          const lo = i > 0 ? c - sx : -1;
          const hi = i < nx ? c : -1;
          const tu = F > 0 ? (lo >= 0 ? T[lo] : amb) : (hi >= 0 ? T[hi] : amb);
          const q = F * tu;
          if (hi >= 0) acc[hi] += q;
          if (lo >= 0) acc[lo] -= q;
        }
      }
      // y faces
      const v = this.v;
      for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) {
        let f = this.vi(0, j, k);
        for (let i = 0; i < nx; i++, f++) {
          const F = v[f];
          if (F === 0) continue;
          const c = i + nx * (j + ny * k);
          const lo = j > 0 ? c - sy : -1;
          const hi = j < ny ? c : -1;
          const tu = F > 0 ? (lo >= 0 ? T[lo] : amb) : (hi >= 0 ? T[hi] : amb);
          const q = F * tu;
          if (hi >= 0) acc[hi] += q;
          if (lo >= 0) acc[lo] -= q;
        }
      }
      // z faces
      const w = this.w;
      for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) {
        let f = this.wi(0, j, k);
        for (let i = 0; i < nx; i++, f++) {
          const F = w[f];
          if (F === 0) continue;
          const c = i + nx * (j + ny * k);
          const lo = k > 0 ? c - sz : -1;
          const hi = k < nz ? c : -1;
          const tu = F > 0 ? (lo >= 0 ? T[lo] : amb) : (hi >= 0 ? T[hi] : amb);
          const q = F * tu;
          if (hi >= 0) acc[hi] += q;
          if (lo >= 0) acc[lo] -= q;
        }
      }
      // Subtract T*div so residual divergence from the iterative solve
      // does not create or destroy heat out of nothing.
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = this.ci(i, j, k);
        if (solid[c]) continue;
        const div =
          this.u[this.ui(i + 1, j, k)] - this.u[this.ui(i, j, k)] +
          this.v[this.vi(i, j + 1, k)] - this.v[this.vi(i, j, k)] +
          this.w[this.wi(i, j, k + 1)] - this.w[this.wi(i, j, k)];
        T[c] += r * (acc[c] + div * T[c]);
      }
    }
    // Extrapolate air temperature into solids that touch air (for display sampling).
    const skin = this.solidSkin;
    for (let q = 0; q < skin.length; q += 2) {
      const nb = skin[q + 1];
      let sum = 0;
      for (let m = 0; m < nb.length; m++) sum += T[nb[m]];
      T[skin[q]] = sum / nb.length;
    }
  }

  /** The case panels slowly leak heat to the room. */
  applyThermalBoundaries() {
    const { nx, ny, nz, dt, T, solid } = this;
    const amb = this.ambient;
    const loss = Math.min(1, this.wallLoss * dt);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i !== 0 && i !== nx - 1 && j !== 0 && j !== ny - 1 && k !== 0 && k !== nz - 1) continue;
      const c = this.ci(i, j, k);
      if (!solid[c]) T[c] += (amb - T[c]) * loss;
    }
  }
}

function applyFixedArr(vel, K, F) {
  for (let f = 0; f < vel.length; f++) if (K[f] === FIXED) vel[f] = F[f];
}

function zeroVents(vel, K) {
  for (let f = 0; f < vel.length; f++) if (K[f] === VENT) vel[f] = 0;
}

/** Trilinear interpolation of a node array with dims sx*sy*sz at fractional index coords. */
export function trilerp(a, sx, sy, sz, fx, fy, fz) {
  if (fx < 0) fx = 0; else if (fx > sx - 1) fx = sx - 1;
  if (fy < 0) fy = 0; else if (fy > sy - 1) fy = sy - 1;
  if (fz < 0) fz = 0; else if (fz > sz - 1) fz = sz - 1;
  let i = fx | 0; if (i >= sx - 1) i = sx - 2; if (i < 0) i = 0;
  let j = fy | 0; if (j >= sy - 1) j = sy - 2; if (j < 0) j = 0;
  let k = fz | 0; if (k >= sz - 1) k = sz - 2; if (k < 0) k = 0;
  const tx = fx - i;
  const ty = fy - j;
  const tz = fz - k;
  const sxy = sx * sy;
  const o = i + sx * j + sxy * k;
  const c00 = a[o] + (a[o + 1] - a[o]) * tx;
  const c10 = a[o + sx] + (a[o + sx + 1] - a[o + sx]) * tx;
  const c01 = a[o + sxy] + (a[o + sxy + 1] - a[o + sxy]) * tx;
  const c11 = a[o + sxy + sx] + (a[o + sxy + sx + 1] - a[o + sxy + sx]) * tx;
  const c0 = c00 + (c10 - c00) * ty;
  const c1 = c01 + (c11 - c01) * ty;
  return c0 + (c1 - c0) * tz;
}
