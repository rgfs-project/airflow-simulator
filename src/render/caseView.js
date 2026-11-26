import * as THREE from 'three';
import { SLOTS, FACES, PARTS, INTERNAL_FANS, FIXED_VENTS, GPUS, GPU_BLOWER, CASE_FAN, FAN_SPECS, CPU_COOLER, RAM, PSU, psuLayout } from '../sim/model.js';
import { heat } from './colormap.js';

const PLANE_AXES = [[1, 2], [0, 2], [0, 1]];
const MODE_COLORS = { intake: 0x38b6ff, exhaust: 0xff7a3d };

const partBox = (id) => [...PARTS, ...Object.values(GPUS).flatMap((g) => g.parts)].find((p) => p.id === id);

// Parts are shrunk by a fraction of a millimetre so no face is ever coplanar
// with a case panel or a neighbouring part (coplanar faces z-fight / flicker).
const INSET = 0.0004;

function boxMesh(min, max, material) {
  const size = [0, 1, 2].map((a) => {
    const s = max[a] - min[a];
    return s > INSET * 4 ? s - 2 * INSET : s;
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return m;
}

/** Flat geometry in the plane normal to `axis` at coordinate `at`, mapping shape (a, b) to the plane axes. */
function planeShapeGeometry(shape, axis, at, segments = 32) {
  const geo = new THREE.ShapeGeometry(shape, segments);
  const [pa, pb] = PLANE_AXES[axis];
  const pos = geo.attributes.position;
  const p = [0, 0, 0];
  for (let n = 0; n < pos.count; n++) {
    p[pa] = pos.getX(n);
    p[pb] = pos.getY(n);
    p[axis] = at;
    pos.setXYZ(n, p[0], p[1], p[2]);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function grillTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(150,160,175,0.85)';
  ctx.fillRect(0, 0, s, s);
  ctx.globalCompositeOperation = 'destination-out';
  const r = 5.2;
  for (let y = 0, row = 0; y < s + r * 2; y += 11, row++) {
    for (let x = row % 2 ? 6.5 : 0; x < s + r * 2; x += 13) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let hubTexture = null;
/** Hub cap with swirl grooves, drawn once and shared. */
function getHubTexture() {
  if (hubTexture) return hubTexture;
  const n = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const ctx = cv.getContext('2d');
  const c = n / 2;
  ctx.fillStyle = '#2c2e33';
  ctx.fillRect(0, 0, n, n);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const pt = (r, t) => [c + Math.cos(a + t) * r * c, c + Math.sin(a + t) * r * c];
    for (const [col, off, w] of [['#2a2c31', 0, 5], ['#4a4e55', 0.035, 2]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(...pt(0.22, off));
      ctx.quadraticCurveTo(...pt(0.62, 0.42 + off), ...pt(0.96, 0.95 + off));
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#26282c';
  ctx.beginPath(); ctx.arc(c, c, 5, 0, Math.PI * 2); ctx.fill();
  hubTexture = new THREE.CanvasTexture(cv);
  hubTexture.colorSpace = THREE.SRGBColorSpace;
  return hubTexture;
}

/**
 * A fan whose local +Z is the direction it pushes air. Modelled on a premium
 * 140/120 x 25 mm fan: matte black frame with corner pads and screw holes,
 * nine swept sickle blades, grooved hub cap, four motor struts on the outlet.
 */
function makeFan({ size, radius, hub, blades = 9, depth = 0.025, frame = true, struts = true }) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.75, metalness: 0.1 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.85, metalness: 0.05 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050506 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
  if (frame) {
    const sq = new THREE.Shape();
    const hs = size / 2;
    const cr = size * 0.05;
    sq.moveTo(-hs + cr, -hs);
    sq.lineTo(hs - cr, -hs); sq.quadraticCurveTo(hs, -hs, hs, -hs + cr);
    sq.lineTo(hs, hs - cr); sq.quadraticCurveTo(hs, hs, hs - cr, hs);
    sq.lineTo(-hs + cr, hs); sq.quadraticCurveTo(-hs, hs, -hs, hs - cr);
    sq.lineTo(-hs, -hs + cr); sq.quadraticCurveTo(-hs, -hs, -hs + cr, -hs);
    const hole = new THREE.Path();
    hole.absarc(0, 0, radius + 0.0025, 0, Math.PI * 2, true);
    sq.holes.push(hole);
    const fg = new THREE.ExtrudeGeometry(sq, { depth: depth * 0.86, bevelEnabled: false, curveSegments: 48 });
    fg.translate(0, 0, -depth * 0.43);
    group.add(new THREE.Mesh(fg, frameMat));
    // Corner pads (both faces) with screw holes.
    const pad = size * 0.17;
    const padGeo = new THREE.BoxGeometry(pad, pad, depth * 0.07);
    const holeGeo = new THREE.CylinderGeometry(0.0022, 0.0022, depth * 1.02, 12);
    holeGeo.rotateX(Math.PI / 2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(padGeo, padMat);
        p.position.set(sx * (hs - pad / 2), sy * (hs - pad / 2), sz * depth * 0.465);
        group.add(p);
      }
      const h = new THREE.Mesh(holeGeo, holeMat);
      h.position.set(sx * (hs - size * 0.055), sy * (hs - size * 0.055), 0);
      group.add(h);
    }
  }
  if (struts) {
    // Static motor mount on the outlet side.
    const mount = new THREE.CylinderGeometry(hub * 1.02, hub * 1.02, depth * 0.12, 32);
    mount.rotateX(Math.PI / 2);
    mount.translate(0, 0, depth * 0.42);
    group.add(new THREE.Mesh(mount, frameMat));
    const len = radius + 0.004 - hub;
    for (const ang of [1.05, 2.62, 4.19, 5.76]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0032, depth * 0.12), frameMat);
      st.position.set(Math.cos(ang) * (hub + len / 2), Math.sin(ang) * (hub + len / 2), depth * 0.42);
      st.rotation.z = ang;
      group.add(st);
    }
  }
  const rotor = new THREE.Group();
  const hubGeo = new THREE.CylinderGeometry(hub, hub, depth * 0.62, 40);
  hubGeo.rotateX(Math.PI / 2);
  rotor.add(new THREE.Mesh(hubGeo, bladeMat));
  const cap = new THREE.Mesh(new THREE.CircleGeometry(hub * 0.97, 40),
    new THREE.MeshStandardMaterial({ map: getHubTexture(), roughness: 0.75, metalness: 0.05 }));
  cap.position.z = -depth * 0.311;
  cap.rotation.y = Math.PI; // faces the inlet (-Z)
  rotor.add(cap);
  // Sickle blade outline in the rotor plane (x radial, y tangential), swept forward.
  const len = radius - hub * 0.9;
  const bs = new THREE.Shape();
  bs.moveTo(0, -0.32);
  bs.bezierCurveTo(0.35, -0.42, 0.78, -0.25, 1.0, 0.28);
  bs.bezierCurveTo(1.03, 0.52, 0.96, 0.72, 0.84, 0.86);
  bs.bezierCurveTo(0.74, 0.55, 0.5, 0.36, 0.0, 0.3);
  bs.lineTo(0, -0.32);
  const bg = new THREE.ShapeGeometry(bs, 12);
  bg.scale(len, len * 0.62, 1);
  bg.translate(hub * 0.9, 0, 0);
  for (let b = 0; b < blades; b++) {
    const pivot = new THREE.Group();
    const blade = new THREE.Mesh(bg, bladeMat);
    blade.rotation.x = -0.6; // pitch
    pivot.add(blade);
    pivot.rotation.z = (b / blades) * Math.PI * 2;
    rotor.add(pivot);
  }
  group.add(rotor);
  return { group, rotor };
}

function makeArrow(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
  const shaft = new THREE.CylinderGeometry(0.004, 0.004, 0.03, 12);
  shaft.rotateX(Math.PI / 2);
  shaft.translate(0, 0, 0.015);
  const head = new THREE.ConeGeometry(0.011, 0.022, 16);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, 0.04);
  g.add(new THREE.Mesh(shaft, mat), new THREE.Mesh(head, mat));
  return g;
}


/** Radial blower impeller; local +Z is its axis. */
function makeBlower({ radius, hub, height }) {
  const group = new THREE.Group();
  const rotor = new THREE.Group();
  // Large spun-metal hub disc, like the reference card.
  const discMat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.28, metalness: 0.85 });
  const disc = new THREE.CylinderGeometry(hub, hub, 0.004, 48);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 0, -height / 2 + 0.002);
  rotor.add(new THREE.Mesh(disc, discMat));
  const cap = new THREE.SphereGeometry(hub * 0.98, 32, 8, 0, Math.PI * 2, 0, 0.35);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, 0, -height / 2 - hub * 0.92);
  rotor.add(new THREE.Mesh(cap, discMat));
  const backplate = new THREE.CylinderGeometry(radius * 0.97, radius * 0.97, 0.0015, 48);
  backplate.rotateX(Math.PI / 2);
  backplate.translate(0, 0, height / 2 - 0.001);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.2 });
  rotor.add(new THREE.Mesh(backplate, bladeMat));
  // Ring of thin forward-curved blades.
  const blades = 54;
  const len = radius - hub * 1.05;
  const bladeGeo = new THREE.BoxGeometry(len, 0.0007, height * 0.92);
  const inst = new THREE.InstancedMesh(bladeGeo, bladeMat, blades);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const r = (hub * 1.05 + radius) / 2;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2;
    q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + 0.45);
    m.compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(b, m);
  }
  rotor.add(inst);
  group.add(rotor);
  return { group, rotor };
}

/** Rebuild a geometry by mapping every vertex through fn(x, y, z) -> [x, y, z]. */
function remap(geo, fn) {
  const pos = geo.attributes.position;
  for (let n = 0; n < pos.count; n++) {
    const p = fn(pos.getX(n), pos.getY(n), pos.getZ(n));
    pos.setXYZ(n, p[0], p[1], p[2]);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};


/** Perforated honeycomb sheet sized for a w x h (m) panel; holes transparent. */
/** Walnut veneer: warm brown with fine vertical grain. */
function walnutTexture() {
  const w = 64, h = 512;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#6b4128';
  ctx.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    ctx.strokeStyle = rnd() > 0.5 ? `rgba(40,22,12,${0.15 + rnd() * 0.25})` : `rgba(150,100,65,${0.1 + rnd() * 0.2})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= h; y += 32) ctx.lineTo(x + Math.sin(y * 0.02 + i) * 1.5, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function hexPanelTexture(w, h, hole, color = '#b9bdc3') {
  const ppm = 2600;
  const cw = Math.min(2048, Math.round(w * ppm));
  const ch = Math.min(2048, Math.round(h * ppm));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, cw, ch);
  ctx.globalCompositeOperation = 'destination-out';
  const r = (hole / 2) * (cw / w);
  const web = r * 0.32;
  const dx = Math.sqrt(3) * (r + web);
  const dy = 1.5 * (r + web);
  for (let row = 0, y = 0; y < ch + dy; y += dy, row++) {
    for (let x = row % 2 ? dx / 2 : 0; x < cw + dx; x += dx) {
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Modular connector panel artwork for the PSU's front end (150 x 86 mm). */
function psuPanelTexture() {
  const cw = 900, ch = 516; // 6 px per mm
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, cw, ch);
  const conn = (x, y, cols, rows, pin = 15) => {
    const w = cols * pin + 10, hh = rows * pin + 10;
    ctx.fillStyle = '#0c0d0f';
    ctx.fillRect(x, y, w, hh);
    ctx.fillStyle = '#2b2e33';
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) ctx.fillRect(x + 7 + c * pin, y + 7 + r * pin, pin - 6, pin - 6);
    ctx.fillStyle = '#0c0d0f';
    ctx.fillRect(x + w / 2 - 8, y + hh, 16, 14); // latch
    return w;
  };
  ctx.strokeStyle = '#8d939c';
  ctx.lineWidth = 2;
  ctx.font = "600 15px 'Inter Variable', sans-serif";
  ctx.fillStyle = '#8d939c';
  const group = (x, y, w, h, label, top) => {
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#1b1d21';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillRect(x + w / 2 - tw / 2, top ? y - 9 : y + h - 9, tw, 18);
    ctx.fillStyle = '#8d939c';
    ctx.fillText(label, x + w / 2 - tw / 2 + 6, top ? y + 5 : y + h + 5);
  };
  group(38, 80, 340, 400, 'CPU / PCI-E', false);
  group(392, 80, 104, 270, '12V-2x6', true);
  group(510, 80, 352, 270, 'Peripheral', true);
  group(392, 372, 470, 108, 'M / B', false);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) conn(52 + c * 106, 100 + r * 124, 4, 2, 23);
  for (let r = 0; r < 2; r++) conn(404, 110 + r * 116, 6, 2, 13);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) conn(522 + c * 112, 110 + r * 116, 3, 2, 29);
  conn(406, 386, 12, 2, 24);
  conn(712, 386, 6, 2, 22);
  ctx.fillStyle = '#26282d';
  for (const [x, y] of [[22, 22], [cw - 22, 22], [22, ch - 22], [cw - 22, ch - 22]]) {
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A flat rectangle in the plane normal to `axis` at `at`, spanning [a0,a1] x [b0,b1] on the plane axes. */
function planeRect(axis, at, a0, a1, b0, b1, material) {
  const sh = new THREE.Shape();
  sh.moveTo(a0, b0); sh.lineTo(a1, b0); sh.lineTo(a1, b1); sh.lineTo(a0, b1); sh.lineTo(a0, b0);
  const geo = planeShapeGeometry(sh, axis, at, 1);
  const [pa, pb] = PLANE_AXES[axis];
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let n = 0; n < pos.count; n++) {
    const p = [pos.getX(n), pos.getY(n), pos.getZ(n)];
    uv[n * 2] = (p[pa] - a0) / (a1 - a0);
    uv[n * 2 + 1] = (p[pb] - b0) / (b1 - b0);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return new THREE.Mesh(geo, material);
}

export class CaseView {
  constructor(dims, gpuType = 'blower', psuMode = 'down') {
    this.psuMode = psuMode === 'up' ? 'up' : 'down';
    this.dims = dims; // [W, H, D] of the simulated interior
    this.gpuType = GPUS[gpuType] ? gpuType : 'blower';
    this.group = new THREE.Group();
    this.slots = new Map();
    this.internalFans = [];
    this.hitTargets = [];
    this.panelMeshes = [];
    this.grillTex = grillTexture();
    this.buildShell();
    this.buildParts();
    this.buildSlots();
    this.buildInternalFans();
    this.applyClayStyle();
  }

  slotCenter(slot) {
    const { axis, side } = FACES[slot.face];
    const c = slot.c.slice();
    c[axis] = side ? this.dims[axis] : 0;
    return c;
  }

  buildShell() {
    const [W, H, D] = this.dims;
    // Anodised aluminium frame along the 12 edges, plus rubber feet.
    const alu = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.32, metalness: 0.85 });
    const t = 0.005;
    const bar = (sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), alu);
      m.position.set(x, y, z);
      this.group.add(m);
    };
    for (const y of [0, H]) for (const z of [0, D]) bar(W + t, t, t, W / 2, y, z);
    for (const x of [0, W]) for (const z of [0, D]) bar(t, H + t, t, x, H / 2, z);
    for (const x of [0, W]) for (const y of [0, H]) bar(t, t, D + t, x, y, D / 2);
    this.buildExterior();

    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x262b35, roughness: 0.55, metalness: 0.5, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9cbbe0, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.07,
      side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6,
    });
    this.panelMat = panelMat;

    const walls = [
      { face: 'front' }, { face: 'rear' }, { face: 'top' }, { face: 'bottom' }, { face: 'right' }, { face: 'left', glass: true },
    ];
    for (const wall of walls) {
      const { axis, side } = FACES[wall.face];
      const [pa, pb] = PLANE_AXES[axis];
      const A = this.dims[pa];
      const B = this.dims[pb];
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(A, 0); shape.lineTo(A, B); shape.lineTo(0, B); shape.lineTo(0, 0);
      for (const slot of SLOTS.filter((s) => s.face === wall.face)) {
        const hole = new THREE.Path();
        hole.absarc(slot.c[pa], slot.c[pb], slot.size * 0.49, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
      if (wall.face === 'rear') {
        const hole = new THREE.Path();
        const [x0, x1, y0, y1] = [PSU.min[0] + 0.003, PSU.max[0] - 0.003, 0.009, PSU.max[1] - 0.003];
        hole.moveTo(x0, y0); hole.lineTo(x0, y1); hole.lineTo(x1, y1); hole.lineTo(x1, y0); hole.lineTo(x0, y0);
        shape.holes.push(hole);
      }
      for (const v of FIXED_VENTS.filter((s) => s.face === wall.face)) {
        const hole = new THREE.Path();
        hole.moveTo(v.min[0], v.min[1]); hole.lineTo(v.min[0], v.max[1]);
        hole.lineTo(v.max[0], v.max[1]); hole.lineTo(v.max[0], v.min[1]); hole.lineTo(v.min[0], v.min[1]);
        shape.holes.push(hole);
      }
      const mesh = new THREE.Mesh(planeShapeGeometry(shape, axis, side ? this.dims[axis] : 0), wall.glass ? glassMat : panelMat);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      if (!wall.glass) this.panelMeshes.push(mesh);
    }

    // Tempered glass has a black printed border.
    {
      const [Hh, Dd] = [this.dims[1], this.dims[2]];
      const band = 0.016;
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(Hh, 0); sh.lineTo(Hh, Dd); sh.lineTo(0, Dd); sh.lineTo(0, 0);
      const hole = new THREE.Path();
      hole.moveTo(band, band); hole.lineTo(band, Dd - band); hole.lineTo(Hh - band, Dd - band); hole.lineTo(Hh - band, band); hole.lineTo(band, band);
      sh.holes.push(hole);
      const border = new THREE.Mesh(planeShapeGeometry(sh, 0, -0.0012, 1),
        new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.25, metalness: 0.2, side: THREE.DoubleSide }));
      this.group.add(border);
      this.panelMeshes.push(border);
    }

    // Expansion-slot covers (perforated) over the rear vent.
    for (const v of FIXED_VENTS) {
      const { axis, side } = FACES[v.face];
      const shape = new THREE.Shape();
      shape.moveTo(v.min[0], v.min[1]); shape.lineTo(v.max[0], v.min[1]);
      shape.lineTo(v.max[0], v.max[1]); shape.lineTo(v.min[0], v.max[1]); shape.lineTo(v.min[0], v.min[1]);
      const geo = planeShapeGeometry(shape, axis, side ? this.dims[axis] : 0);
      // UVs for the grill texture (one repeat per ~4 cm).
      this.setPlanarUV(geo, axis, 0.04);
      const grill = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: this.grillTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, metalness: 0.6, roughness: 0.4,
      }));
      this.group.add(grill);
      this.panelMeshes.push(grill);
    }
  }

  setPlanarUV(geo, axis, scale) {
    const [pa, pb] = PLANE_AXES[axis];
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let n = 0; n < pos.count; n++) {
      const p = [pos.getX(n), pos.getY(n), pos.getZ(n)];
      uv[n * 2] = p[pa] / scale / 3;
      uv[n * 2 + 1] = p[pb] / scale / 3;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  /**
   * Case exterior modelled on a Scandinavian-style mid-tower: a deep rounded
   * front frame holding ten walnut slats, a perforated top with a solid front
   * cap (brass power button, port row), glass side with a solid front strip,
   * a rear pull tab and black feet with brass rings. No branding.
   */
  buildExterior() {
    const g = this.group;
    const [W, H, D] = this.dims;
    const black = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.75, metalness: 0.15 });
    const inner = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8913f, roughness: 0.35, metalness: 0.9 });
    brass.userData.keep = true;
    const walnut = new THREE.MeshStandardMaterial({ map: walnutTexture(), roughness: 0.62, metalness: 0 });
    walnut.userData.keep = true;
    const leather = new THREE.MeshStandardMaterial({ color: 0x7a4527, roughness: 0.8, metalness: 0 });
    leather.userData.keep = true;

    const rr = (sh, x0, y0, x1, y1, r, hole = false) => {
      const p = hole ? new THREE.Path() : sh;
      p.moveTo(x0 + r, y0);
      p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r);
      p.lineTo(x1, y1 - r); p.quadraticCurveTo(x1, y1, x1 - r, y1);
      p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r);
      p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
      if (hole) sh.holes.push(p);
      return p;
    };

    // Front frame: rounded outer rim, deep recess, slats inside.
    const bz = 0.032; // frame depth in front of the interior
    const m = 0.006;  // rim width
    const x0 = -0.006, x1 = W + 0.006, y0 = -0.004, y1 = H + 0.006;
    const frame = new THREE.Shape();
    rr(frame, x0, y0, x1, y1, 0.016);
    rr(frame, x0 + m, y0 + m, x1 - m, y1 - m, 0.011, true);
    const fGeo = new THREE.ExtrudeGeometry(frame, { depth: bz, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 3, curveSegments: 12 });
    fGeo.translate(0, 0, D);
    g.add(new THREE.Mesh(fGeo, black));
    // Dark filter at the back of the recess (behind the slats, in front of the fans).
    const filter = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 - 2 * m, y1 - y0 - 2 * m), inner);
    filter.position.set((x0 + x1) / 2, (y0 + y1) / 2, D + 0.004);
    filter.material = inner.clone();
    filter.material.transparent = true;
    filter.material.opacity = 0.55;
    filter.material.depthWrite = false;
    g.add(filter);
    this.panelMeshes.push(filter);
    // Ten walnut slats with rounded ends.
    const n = 10, sw = 0.0105, sd = 0.012;
    const span = x1 - x0 - 2 * m - 0.012;
    const slatGeo = new THREE.BoxGeometry(sw, y1 - y0 - 2 * m - 0.014, sd);
    for (let i = 0; i < n; i++) {
      const sx = x0 + m + 0.006 + sw / 2 + (i * (span - sw)) / (n - 1);
      const slat = new THREE.Mesh(slatGeo, walnut);
      slat.position.set(sx, (y0 + y1) / 2, D + bz - sd / 2 - 0.003);
      g.add(slat);
    }

    // Top: solid front cap, flush with the mesh; only its front edge curves into the frame.
    const capD = 0.1;
    const cz0 = D - capD, cz1 = D + bz, cr = 0.016;
    const cap = new THREE.Shape();
    cap.moveTo(x0, cz0);
    cap.lineTo(x1, cz0);
    cap.lineTo(x1, cz1 - cr); cap.quadraticCurveTo(x1, cz1, x1 - cr, cz1);
    cap.lineTo(x0 + cr, cz1); cap.quadraticCurveTo(x0, cz1, x0, cz1 - cr);
    cap.lineTo(x0, cz0);
    const capGeo = new THREE.ExtrudeGeometry(cap, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 2, curveSegments: 12 });
    capGeo.rotateX(Math.PI / 2);   // shape (x, y) -> (x, z), depth -> -y
    const topY = H + 0.007;
    capGeo.translate(0, topY - 0.001, 0);
    g.add(new THREE.Mesh(capGeo, black));

    // Front I/O row: power button, 2 audio jacks, 2 USB-A, USB-C, joined by a fine line.
    const hole = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.6, metalness: 0.2 });
    hole.userData.keep = true;
    const lineMat = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 0.7, metalness: 0.1 });
    lineMat.userData.keep = true;
    const rowZ = cz0 + 0.6 * (cz1 - cz0);
    const at = (f) => x0 + f * (x1 - x0);
    const yS = topY + 0.0002; // just above the cap surface
    const add = (geo, mat, x, y = yS) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, rowZ); g.add(o); return o; };
    // Fine line from the button to the right, with a brass tail past the last port.
    add(new THREE.BoxGeometry(at(0.66) - at(0.14), 0.0003, 0.0005), lineMat, (at(0.14) + at(0.66)) / 2);
    add(new THREE.BoxGeometry(at(0.88) - at(0.66), 0.0003, 0.0005), brass, (at(0.66) + at(0.88)) / 2);
    // Power button: brass disc in a dark recess ring.
    add(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0004, 40), hole, at(0.14));
    add(new THREE.CylinderGeometry(0.0052, 0.0052, 0.0012, 40), brass, at(0.14), yS + 0.0004);
    // Audio jacks: dark holes with a brass rim.
    for (const f of [0.26, 0.33]) {
      add(new THREE.CylinderGeometry(0.0021, 0.0021, 0.0004, 24), brass, at(f));
      add(new THREE.CylinderGeometry(0.0014, 0.0014, 0.0006, 24), hole, at(f));
    }
    // USB-A and USB-C ports.
    for (const f of [0.43, 0.53]) add(new THREE.BoxGeometry(0.0075, 0.0006, 0.003), hole, at(f));
    const usbc = add(new THREE.CylinderGeometry(0.0011, 0.0011, 0.0006, 16), hole, at(0.635) - 0.0018);
    add(new THREE.BoxGeometry(0.0036, 0.0006, 0.0022), hole, at(0.635));
    add(usbc.geometry, hole, at(0.635) + 0.0018);
    const meshTop = new THREE.MeshStandardMaterial({
      map: hexPanelTexture(D - capD + 0.004, W + 0.012, 0.0022, '#1d1e21'), transparent: true, depthWrite: false,
      side: THREE.DoubleSide, roughness: 0.8, metalness: 0.1,
    });
    const top = planeRect(1, topY, x0, x1, -0.004, cz0, meshTop);
    g.add(top);
    this.panelMeshes.push(top);

    // Glass side: solid strip over the front quarter (the glass ends there).
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.004, H + 0.01, capD - 0.004), black);
    strip.position.set(-0.004, H / 2 + 0.001, D - capD / 2 + 0.002);
    g.add(strip);
    this.panelMeshes.push(strip);

    // Bottom trim and feet: black cylinder with a brushed brass ring.
    g.add(boxMesh([x0, -0.006, -0.003], [x1, 0, D + 0.004], black));
    const footGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.008, 32);
    const ringGeo = new THREE.CylinderGeometry(0.0128, 0.0128, 0.003, 32);
    for (const x of [0.032, W - 0.032]) for (const z of [0.04, D - 0.01]) {
      const f = new THREE.Mesh(footGeo, black);
      f.position.set(x, -0.006 - 0.004, z);
      const ring = new THREE.Mesh(ringGeo, brass);
      ring.position.set(x, -0.0155, z);
      g.add(f, ring);
    }

    // Rear pull tab.
    g.add(boxMesh([W / 2 - 0.012, H - 0.002, -0.006], [W / 2 + 0.012, H + 0.008, 0], leather));
  }

  buildParts() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c313b, roughness: 0.5, metalness: 0.6 });
    const pcb = new THREE.MeshStandardMaterial({ color: 0x15201b, roughness: 0.7, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.5, metalness: 0.4 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xc27a45, roughness: 0.3, metalness: 0.9 });
    const g = this.group;
    const W = this.dims[0];

    // PSU shroud with a lighter top edge.
    this.buildShroudAndPsu();
    // Motherboard and details.
    const mb = partBox('motherboard');
    g.add(boxMesh(mb.min, mb.max, pcb));
    g.add(boxMesh(partBox('io-shield').min, partBox('io-shield').max, dark));
    const vrm = new THREE.MeshStandardMaterial({ color: 0x4a505c, roughness: 0.35, metalness: 0.8 });
    g.add(boxMesh([W - 0.028, 0.372, 0.13], [W - 0.01, 0.392, 0.2], vrm));
    g.add(boxMesh([W - 0.028, 0.3, 0.115], [W - 0.01, 0.37, 0.135], vrm));
    g.add(boxMesh([W - 0.02, 0.15, 0.17], [W - 0.01, 0.19, 0.21], vrm)); // chipset
    for (const y of [0.17, 0.13]) g.add(boxMesh([W - 0.018, y, 0.03], [W - 0.01, y + 0.008, 0.115], dark));
    g.add(boxMesh([W - 0.018, 0.255, 0.03], [W - 0.01, 0.263, 0.115], dark));
    // 24-pin ATX and 8-pin EPS power connectors, M.2 heatsink.
    const conn = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.6, metalness: 0.1 });
    g.add(boxMesh([W - 0.027, 0.29, 0.246], [W - 0.01, 0.346, 0.258], conn));
    g.add(boxMesh([W - 0.024, 0.395, 0.02], [W - 0.01, 0.405, 0.042], conn));
    const m2 = new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.35, metalness: 0.85 });
    g.add(boxMesh([W - 0.016, 0.262, 0.035], [W - 0.01, 0.278, 0.13], m2));

    // CPU: single-tower cooler, all black, 158 x 125 x 112 mm.
    const C = CPU_COOLER;
    const blackNickel = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.42, metalness: 0.75 });
    this.cpuFinMat = new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.45, metalness: 0.7, emissive: 0x000000 });
    g.add(boxMesh([C.base, 0.326, 0.151], [W - 0.01, 0.364, 0.189], dark)); // CPU + socket
    g.add(boxMesh([C.base - 0.012, 0.327, 0.152], [C.base, 0.363, 0.188], blackNickel)); // contact base
    // Mounting bar with two spring-loaded screws.
    g.add(boxMesh([C.base - 0.017, 0.298, 0.164], [C.base - 0.012, 0.392, 0.176], blackNickel));
    const helix = new (class extends THREE.Curve {
      getPoint(t) {
        const a = t * Math.PI * 2 * 5;
        return new THREE.Vector3(-t * 0.014, Math.cos(a) * 0.0045, Math.sin(a) * 0.0045);
      }
    })();
    const springGeo = new THREE.TubeGeometry(helix, 120, 0.0008, 6, false);
    for (const y of [0.302, 0.388]) {
      const sp = new THREE.Mesh(springGeo, blackNickel);
      sp.position.set(C.base - 0.012, y, 0.17);
      g.add(sp);
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.018, 10), blackNickel);
      screw.rotation.z = Math.PI / 2;
      screw.position.set(C.base - 0.019, y, 0.17);
      g.add(screw);
    }
    // Fin stack: plates parallel to the motherboard, stacked toward the glass.
    const finCount = 50;
    const finGeo = new THREE.BoxGeometry(0.0006, C.y[1] - C.y[0], C.z[1] - C.z[0]);
    const cpuFins = new THREE.InstancedMesh(finGeo, this.cpuFinMat, finCount);
    const m4 = new THREE.Matrix4();
    for (let n = 0; n < finCount; n++) {
      const x = C.finBottom - 0.0015 - (n / (finCount - 1)) * (C.finBottom - C.top - 0.004);
      m4.makeTranslation(x, (C.y[0] + C.y[1]) / 2, (C.z[0] + C.z[1]) / 2);
      cpuFins.setMatrixAt(n, m4);
    }
    g.add(cpuFins);
    // Top plate (faces the glass) with capped heatpipe ends.
    g.add(boxMesh([C.top, C.y[0], C.z[0]], [C.top + 0.0025, C.y[1], C.z[1]], blackNickel));
    const capGeo = new THREE.ConeGeometry(0.0034, 0.007, 14);
    capGeo.rotateZ(Math.PI / 2); // tip points toward -x (the glass)
    // Seven U-shaped heatpipes: 14 ends in two staggered rows.
    const rows = [C.z[0] + 0.016, C.z[1] - 0.016];
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < C.heatpipes; i++) {
        const y = 0.345 + (i - (C.heatpipes - 1) / 2) * 0.0148 + (r ? 0.0074 : -0.0074) * 0.5;
        const yb = 0.345 + (i - (C.heatpipes - 1) / 2) * 0.0049;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(C.base - 0.004, yb, rows[r] * 0.35 + 0.17 * 0.65),
          new THREE.Vector3(C.base - 0.016, (yb + y) / 2, rows[r] * 0.75 + 0.17 * 0.25),
          new THREE.Vector3(C.finBottom + 0.004, y, rows[r]),
          new THREE.Vector3(C.top + 0.002, y, rows[r]),
        ]);
        g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.003, 10, false), blackNickel));
        const cap = new THREE.Mesh(capGeo, blackNickel);
        cap.position.set(C.top - 0.0035, y, rows[r]);
        g.add(cap);
      }
    }

    // RAM: four bare DDR5 DIMMs (green PCB, 8 DRAM chips + PMIC on one side).
    const ramPcb = new THREE.MeshStandardMaterial({ color: 0x2a7d3c, roughness: 0.6, metalness: 0.1 });
    const chipMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.2 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.3, metalness: 0.95 });
    const slotMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6, metalness: 0.2 });
    const rx1 = W - 0.01, rx0 = rx1 - RAM.h, ry0 = RAM.y0, ry1 = RAM.y0 + RAM.len;
    for (const z of RAM.z) {
      g.add(boxMesh([rx1 - 0.006, ry0 - 0.004, z - 0.0012], [rx1, ry1 + 0.004, z + 0.0032], slotMat)); // DIMM slot
      g.add(boxMesh([rx0, ry0, z], [rx1 - 0.0005, ry1, z + 0.0012], ramPcb));
      g.add(boxMesh([rx1 - 0.0045, ry0 + 0.003, z - 0.0002], [rx1 - 0.0008, ry1 - 0.003, z + 0.0014], gold));
      const yc = (ry0 + ry1) / 2;
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const cy = yc + side * (0.0185 + k * 0.0122);
          g.add(boxMesh([rx0 + 0.009, cy - 0.0051, z - 0.0011], [rx0 + 0.0205, cy + 0.0051, z], chipMat));
        }
      }
      g.add(boxMesh([rx0 + 0.006, yc - 0.004, z - 0.0009], [rx0 + 0.012, yc + 0.004, z], chipMat)); // PMIC
      g.add(boxMesh([rx0 + 0.013, yc - 0.0025, z - 0.0007], [rx0 + 0.017, yc + 0.003, z], chipMat));
    }

    if (this.gpuType === 'blower') this.buildBlowerGpu();
    else this.buildOpenAirGpu();
  }

  /**
   * PSU shroud (solid top and front, perforated glass-side panel so the PSU
   * shows through) and an ATX PSU: matte black body, silver honeycomb fan
   * grille, modular connector panel at the front, honeycomb exhaust at the rear.
   */
  buildShroudAndPsu() {
    const g = this.group;
    const W = this.dims[0];
    const sh = partBox('psu-shroud');
    const top = sh.max[1], zEnd = sh.max[2];
    const up = this.psuMode === 'up';
    const f = PSU.fan;
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
    // Shroud top, with a mesh cut-out over the PSU fan when it faces up.
    const topShape = new THREE.Shape();
    topShape.moveTo(0.004, 0.003); topShape.lineTo(W - 0.004, 0.003); topShape.lineTo(W - 0.004, zEnd); topShape.lineTo(0.004, zEnd); topShape.lineTo(0.004, 0.003);
    const cut = 0.07;
    if (up) {
      const hole = new THREE.Path();
      hole.moveTo(f.c[0] - cut, f.c[1] - cut); hole.lineTo(f.c[0] - cut, f.c[1] + cut);
      hole.lineTo(f.c[0] + cut, f.c[1] + cut); hole.lineTo(f.c[0] + cut, f.c[1] - cut); hole.lineTo(f.c[0] - cut, f.c[1] - cut);
      topShape.holes.push(hole);
    }
    g.add(new THREE.Mesh(remap(new THREE.ExtrudeGeometry(topShape, { depth: 0.003, bevelEnabled: false }), (a, b, d) => [a, top - 0.003 + d, b]), metal));
    if (up) {
      const mesh = new THREE.MeshStandardMaterial({ map: hexPanelTexture(2 * cut, 2 * cut, 0.009, '#30343c'), transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45 });
      g.add(planeRect(1, top - 0.0015, f.c[0] - cut, f.c[0] + cut, f.c[1] - cut, f.c[1] + cut, mesh));
    }
    // Front face of the shroud.
    g.add(boxMesh([0.004, 0, zEnd - 0.003], [W - 0.004, top, zEnd], metal));
    // Solid, smooth side facing the glass (hides the PSU, like the real basement cover).
    g.add(boxMesh([0.002, 0.001, 0.003], [0.006, top, zEnd], metal));

    // ---- The PSU itself ----
    const [x0, y0, z0] = [PSU.min[0], 0.006, 0.002];
    const [x1, y1, z1] = [PSU.max[0], PSU.max[1], PSU.max[2]];
    const body = new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.78, metalness: 0.35 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
    const fanY = up ? y1 : y0; // face carrying the fan
    const backY = up ? y0 : y1;
    // Side walls, the plain face and the two ends.
    g.add(boxMesh([x0, y0, z0], [x0 + 0.0015, y1, z1], body));
    g.add(boxMesh([x1 - 0.0015, y0, z0], [x1, y1, z1], body));
    g.add(boxMesh([x0, backY - (up ? 0 : 0.0015), z0], [x1, backY + (up ? 0.0015 : 0), z1], body));
    // Fan face: black plate with a round opening, silver honeycomb grille over it.
    const plate = new THREE.Shape();
    plate.moveTo(x0, z0); plate.lineTo(x1, z0); plate.lineTo(x1, z1); plate.lineTo(x0, z1); plate.lineTo(x0, z0);
    const fh = new THREE.Path();
    fh.absarc(f.c[0], f.c[1], f.radius + 0.002, 0, Math.PI * 2, true);
    plate.holes.push(fh);
    const plateY = up ? y1 - 0.0015 : y0;
    g.add(new THREE.Mesh(remap(new THREE.ExtrudeGeometry(plate, { depth: 0.0015, bevelEnabled: false, curveSegments: 48 }), (a, b, d) => [a, plateY + d, b]), body));
    const grille = new THREE.MeshStandardMaterial({ map: hexPanelTexture(x1 - x0 - 0.006, z1 - z0 - 0.01, 0.0095), transparent: true, depthWrite: false, side: THREE.DoubleSide, metalness: 0.9, roughness: 0.3 });
    g.add(planeRect(1, up ? y1 + 0.0008 : y0 - 0.0008, x0 + 0.003, x1 - 0.003, z0 + 0.005, z1 - 0.005, grille));
    // Feet under the PSU.
    for (const fx of [x0 + 0.01, x1 - 0.02]) for (const fz of [z0 + 0.01, z1 - 0.02]) g.add(boxMesh([fx, 0, fz], [fx + 0.01, y0, fz + 0.01], body));
    // Modular panel (front end) and honeycomb exhaust with inlet + switch (rear end).
    g.add(planeRect(2, z1, x0, x1, y0, y1, new THREE.MeshStandardMaterial({ map: psuPanelTexture(), roughness: 0.7, metalness: 0.3 })));
    g.add(boxMesh([x0, y0, z1 - 0.0015], [x1, y1, z1 - 0.0002], body));
    const rear = new THREE.MeshStandardMaterial({ map: hexPanelTexture(x1 - x0, y1 - y0, 0.0065, '#1d1f23'), transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
    g.add(planeRect(2, z0, x0, x1, y0, y1, rear));
    g.add(boxMesh([x0 + 0.008, y0 + 0.008, z0 - 0.003], [x0 + 0.04, y0 + 0.032, z0 + 0.002], body)); // AC inlet
    g.add(boxMesh([x0 + 0.014, y0 + 0.013, z0 - 0.0035], [x0 + 0.034, y0 + 0.027, z0 - 0.0028], new THREE.MeshBasicMaterial({ color: 0x050505 })));
    g.add(boxMesh([x0 + 0.012, y0 + 0.04, z0 - 0.004], [x0 + 0.03, y0 + 0.056, z0 + 0.002], body)); // rocker switch
    // Brushed accent panel on the side facing the glass.
    g.add(boxMesh([x0 - 0.0012, y0 + 0.012, z0 + 0.11], [x0 - 0.0002, y1 - 0.012, z1 - 0.012], silver));
  }

  buildOpenAirGpu() {
    const g = this.group;
    const W = this.dims[0];
    const m4 = new THREE.Matrix4();
    const pcb = new THREE.MeshStandardMaterial({ color: 0x15201b, roughness: 0.7, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.5, metalness: 0.4 });
    // GPU: PCB + backplate, fin stack, shroud with fan cutouts.
    const gp = partBox('gpu-pcb');
    g.add(boxMesh(gp.min, gp.max, pcb));
    g.add(boxMesh([gp.min[0], gp.max[1], gp.min[2]], [gp.max[0], gp.max[1] + 0.003, gp.max[2]], dark));
    const gf = partBox('gpu-fins');
    this.gpuFinMat = new THREE.MeshStandardMaterial({ color: 0xaeb4be, roughness: 0.35, metalness: 0.85, emissive: 0x000000 });
    const gCount = 56;
    const gGeo = new THREE.BoxGeometry(gf.max[0] - gf.min[0], gf.max[1] - gf.min[1], 0.0012);
    const gpuFins = new THREE.InstancedMesh(gGeo, this.gpuFinMat, gCount);
    for (let n = 0; n < gCount; n++) {
      const z = gf.min[2] + ((n + 0.5) / gCount) * (gf.max[2] - gf.min[2]);
      m4.makeTranslation((gf.min[0] + gf.max[0]) / 2, (gf.min[1] + gf.max[1]) / 2, z);
      gpuFins.setMatrixAt(n, m4);
    }
    g.add(gpuFins);
    const shroudShape = new THREE.Shape();
    // Plane axes for y-normal faces are (x, z).
    const sx0 = 0.058, sx1 = W - 0.01, sz0 = 0.008, sz1 = 0.31;
    shroudShape.moveTo(sx0, sz0); shroudShape.lineTo(sx1, sz0); shroudShape.lineTo(sx1, sz1);
    shroudShape.lineTo(sx0, sz1); shroudShape.lineTo(sx0, sz0);
    for (const f of GPUS.openair.fans) {
      const hole = new THREE.Path();
      hole.absarc(f.c[0], f.c[1], f.radius + 0.002, 0, Math.PI * 2, true);
      shroudShape.holes.push(hole);
    }
    const shroudMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
    const sGeo = new THREE.ExtrudeGeometry(shroudShape, { depth: 0.004, bevelEnabled: false, curveSegments: 32 });
    // Extrude runs along local z; map shape (x, y) -> world (x, z) and depth -> y.
    sGeo.rotateX(Math.PI / 2);
    const sMesh = new THREE.Mesh(sGeo, shroudMat);
    sMesh.position.y = 0.196;
    g.add(sMesh);
    const accent = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff4d2e, emissiveIntensity: 0.5 });
    g.add(boxMesh([sx0, 0.199, sz0], [sx0 + 0.0015, 0.203, sz1], accent));
  }

  /**
   * Dual-slot workstation blower card (267 x 111 x 40 mm): matte black shroud,
   * spun-metal blower hub near the far end, gold fin stack exposed along the
   * top edge with a swoosh at the fan, slotted silver bracket with four
   * DisplayPort outputs, power connector on the end.
   */
  buildBlowerGpu() {
    const g = this.group;
    const W = this.dims[0];
    const B = GPU_BLOWER;
    const x0 = B.x0, x1 = W - 0.0105, y0 = B.y0, y1 = B.y1, z0 = 0.004, z1 = B.zEnd;
    const fc = B.fan.c;
    const shroud = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.42, metalness: 0.55, side: THREE.DoubleSide });
    const black = new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.7, metalness: 0.2 });
    const pcb = new THREE.MeshStandardMaterial({ color: 0x15201b, roughness: 0.7, metalness: 0.2 });
    const silver = new THREE.MeshStandardMaterial({ color: 0xb9bdc3, roughness: 0.32, metalness: 0.9, side: THREE.DoubleSide });
    this.gpuFinMat = new THREE.MeshStandardMaterial({ color: 0xb39463, roughness: 0.35, metalness: 0.9, emissive: 0x000000 });

    // Fan face (bottom) and back cover (top), each with the blower opening.
    const plate = (y, thick, holeR) => {
      const sh = new THREE.Shape();
      sh.moveTo(x0, z0); sh.lineTo(x1, z0); sh.lineTo(x1, z1); sh.lineTo(x0, z1); sh.lineTo(x0, z0);
      const hole = new THREE.Path();
      hole.absarc(fc[0], fc[1], holeR, 0, Math.PI * 2, true);
      sh.holes.push(hole);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 48 });
      return remap(geo, (a, b, d) => [a, y + d, b]);
    };
    g.add(new THREE.Mesh(plate(y0 - 0.0005, 0.0025, B.fan.radius + 0.004), shroud));
    g.add(new THREE.Mesh(plate(y1 - 0.002, 0.0025, B.fan.radius + 0.002), shroud));
    // Raised bezel ring around the fan opening.
    const bezel = new THREE.TorusGeometry(B.fan.radius + 0.0045, 0.0018, 10, 64);
    bezel.rotateX(Math.PI / 2);
    const bz = new THREE.Mesh(bezel, new THREE.MeshStandardMaterial({ color: 0x34363b, roughness: 0.3, metalness: 0.8 }));
    bz.position.set(fc[0], y0 - 0.001, fc[1]);
    g.add(bz);

    // Far end cap with the power connector.
    g.add(boxMesh([x0, y0, z1 - 0.004], [x1, y1, z1], shroud));
    g.add(boxMesh([x0 + 0.008, y0 + 0.012, z1], [x0 + 0.026, y0 + 0.024, z1 + 0.007], black));

    // PCB under the back cover (stops at the blower chamber).
    g.add(boxMesh([x0 + 0.002, B.pcb[0], z0], [x1, B.pcb[1], B.finEnd], pcb));

    // Top edge (faces the glass): lips around an open window onto the fins.
    // The fan-side lip sweeps up near the blower, like the reference card.
    const lipLo = (z) => y0 + 0.006 + 0.017 * smooth(0.165, 0.215, z);
    const winHi = y1 - 0.006;
    const swoosh = new THREE.Shape();
    const steps = 48;
    swoosh.moveTo(z0, y0);
    swoosh.lineTo(z1, y0);
    for (let n = steps; n >= 0; n--) {
      const z = z0 + (n / steps) * (z1 - z0);
      swoosh.lineTo(z, lipLo(z));
    }
    swoosh.lineTo(z0, y0);
    g.add(new THREE.Mesh(remap(new THREE.ExtrudeGeometry(swoosh, { depth: 0.002, bevelEnabled: false }),
      (a, b, d) => [x0 + d, b, a]), shroud));
    g.add(boxMesh([x0, winHi, z0], [x0 + 0.002, y1, z1], shroud));
    // Short black label panel at the bracket end of the window.
    g.add(boxMesh([x0, lipLo(z0), z0], [x0 + 0.002, winHi, z0 + 0.012], shroud));

    // Gold fin stack seen through the window: plates across the card length.
    const finPitch = 0.0026;
    const fins = [];
    for (let z = z0 + 0.014; z < z1 - 0.006; z += finPitch) fins.push(z);
    const finGeo = new THREE.BoxGeometry(1, 1, 0.0007);
    const finMesh = new THREE.InstancedMesh(finGeo, this.gpuFinMat, fins.length);
    const m = new THREE.Matrix4();
    const imp = B.fan.radius + 0.006;
    fins.forEach((z, n) => {
      const lo = lipLo(z) - 0.003;
      const top = x0 + 0.0025;
      // Near the blower the fins only fill the strip between the edge and the impeller.
      const dz = z - fc[1];
      const clear = Math.abs(dz) < imp ? fc[0] - Math.sqrt(imp * imp - dz * dz) : x1;
      const bottom = Math.min(x1 - 0.001, clear);
      const hgt = Math.max(0.004, winHi - lo);
      m.compose(new THREE.Vector3((top + bottom) / 2, lo + hgt / 2, z), new THREE.Quaternion(),
        new THREE.Vector3(Math.max(0.004, bottom - top), hgt, 1));
      finMesh.setMatrixAt(n, m);
    });
    g.add(finMesh);
    // Dark duct floor behind the fins so the window reads as depth, not a hole.
    g.add(boxMesh([x0 + 0.003, y0 + 0.002, z0], [x1, y0 + 0.004, z1 - 0.004], black));

    // Slotted silver bracket with four DisplayPort outputs, on the rear panel.
    const bx0 = x0 - 0.004, bx1 = W - 0.002, by0 = y0 - 0.003, by1 = y1 + 0.003;
    const bracket = new THREE.Shape();
    bracket.moveTo(bx0, by0); bracket.lineTo(bx1, by0); bracket.lineTo(bx1, by1); bracket.lineTo(bx0, by1); bracket.lineTo(bx0, by0);
    const gy0 = y0 + 0.004, gy1 = B.pcb[0] - 0.006; // grille band
    const slotW = 0.0052, pitch = 0.0078;
    const gx0 = x0 + 0.012, gx1 = W - 0.016;
    const nSlots = Math.floor((gx1 - gx0) / pitch);
    for (let n = 0; n < nSlots; n++) {
      const sx = gx0 + n * pitch;
      const hole = new THREE.Path();
      hole.moveTo(sx, gy0); hole.lineTo(sx, gy1); hole.lineTo(sx + slotW, gy1); hole.lineTo(sx + slotW, gy0); hole.lineTo(sx, gy0);
      bracket.holes.push(hole);
    }
    const bGeo = remap(new THREE.ExtrudeGeometry(bracket, { depth: 0.0012, bevelEnabled: false }), (a, b, d) => [a, b, -0.0016 - d]);
    g.add(new THREE.Mesh(bGeo, silver));
    // Black backing seen through the slots.
    g.add(boxMesh([gx0 - 0.002, gy0 - 0.001, -0.0008], [gx1 + 0.002, gy1 + 0.001, 0.0], black));
    // Four DisplayPort outputs in a row along the PCB side.
    const portMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0.3 });
    for (let n = 0; n < 4; n++) {
      const px = x0 + 0.014 + n * 0.022;
      g.add(boxMesh([px, gy1 + 0.0015, -0.0045], [px + 0.016, gy1 + 0.0075, -0.0026], silver));
      g.add(boxMesh([px + 0.0012, gy1 + 0.0026, -0.0049], [px + 0.0148, gy1 + 0.0064, -0.0044], portMat));
    }
  }

  buildSlots() {
    for (const slot of SLOTS) {
      const { axis, side } = FACES[slot.face];
      const outward = new THREE.Vector3();
      outward.setComponent(axis, side ? 1 : -1);
      const c = new THREE.Vector3(...this.slotCenter(slot));
      const root = new THREE.Group();
      root.position.copy(c);
      this.group.add(root);

      const spec = FAN_SPECS[slot.fan] || CASE_FAN;
      const fan = makeFan({ size: slot.size, radius: spec.radius, hub: spec.hub });
      fan.group.position.copy(outward).multiplyScalar(-0.0135);
      root.add(fan.group);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(slot.size / 2 + 0.001, 0.0022, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      ring.position.copy(outward).multiplyScalar(0.001);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), outward);
      root.add(ring);

      const arrow = makeArrow(0xffffff);
      root.add(arrow);

      const [pa, pb] = PLANE_AXES[axis];
      const half = slot.size / 2;
      const sq = new THREE.Shape();
      const a0 = slot.c[pa] - half, a1 = slot.c[pa] + half, b0 = slot.c[pb] - half, b1 = slot.c[pb] + half;
      sq.moveTo(a0, b0); sq.lineTo(a1, b0); sq.lineTo(a1, b1); sq.lineTo(a0, b1); sq.lineTo(a0, b0);
      const at = side ? this.dims[axis] : 0;
      const grillGeo = planeShapeGeometry(sq, axis, at + (side ? 0.001 : -0.001));
      this.setPlanarUV(grillGeo, axis, 0.04);
      const grill = new THREE.Mesh(grillGeo, new THREE.MeshStandardMaterial({
        map: this.grillTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, metalness: 0.6, roughness: 0.4,
      }));
      this.group.add(grill);

      const circle = new THREE.Shape();
      circle.absarc(slot.c[pa], slot.c[pb], slot.size * 0.5, 0, Math.PI * 2, false);
      const plate = new THREE.Mesh(
        planeShapeGeometry(circle, axis, at),
        new THREE.MeshStandardMaterial({
          color: 0x2b303a, roughness: 0.5, metalness: 0.5, transparent: true, opacity: 0.6,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      this.group.add(plate);

      const hit = new THREE.Mesh(
        planeShapeGeometry(sq, axis, at),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false, side: THREE.DoubleSide }),
      );
      hit.userData.slotId = slot.id;
      this.group.add(hit);
      this.hitTargets.push(hit);

      const highlight = new THREE.Mesh(
        planeShapeGeometry(sq, axis, at + (side ? 0.002 : -0.002)),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
      );
      highlight.visible = false;
      this.group.add(highlight);

      this.slots.set(slot.id, { slot, root, fan, ring, arrow, grill, plate, highlight, outward, mode: null });
    }
  }

  buildInternalFans() {
    for (const f of [...INTERNAL_FANS, ...GPUS[this.gpuType].fans, ...psuLayout(this.psuMode).fans]) {
      const isCpu = f.group === 'cpu';
      if (!isCpu && !f.visual) continue;
      const fan = f.visual === 'psu'
        ? makeFan({ size: 0.135, radius: f.radius, hub: f.hub, blades: 7, depth: 0.02, frame: false, struts: false })
        : f.visual === 'blower'
        ? makeBlower({ radius: f.radius, hub: GPU_BLOWER.fan.hub, height: GPU_BLOWER.y1 - GPU_BLOWER.y0 - 0.006 })
        : makeFan({
          size: 0.12, radius: f.radius, hub: f.hub, blades: isCpu ? 9 : 11,
          depth: isCpu ? 0.025 : 0.012, frame: isCpu, struts: isCpu,
        });
      const dir = new THREE.Vector3();
      dir.setComponent(f.axis, f.dir);
      fan.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const pos = [0, 0, 0];
      const [pa, pb] = PLANE_AXES[f.axis];
      pos[pa] = f.c[0];
      pos[pb] = f.c[1];
      if (f.visual === 'blower') pos[f.axis] = (GPU_BLOWER.y0 + GPU_BLOWER.y1) / 2;
      else if (f.visual === 'psu') pos[f.axis] = this.psuMode === 'up' ? PSU.max[1] - 0.014 : 0.02;
      else pos[f.axis] = f.at + f.dir * (isCpu ? 0.0128 : 0.0065) * (f.pull ? 1 : -1);
      fan.group.position.set(...pos);
      this.group.add(fan.group);
      this.internalFans.push({ def: f, ...fan });
    }
  }

  /**
   * Visualisation style: every part becomes a smooth matte "clay" grey, keeping
   * a little of its original lightness so parts stay distinguishable. Colour is
   * left only on data: fan direction rings/arrows (unlit materials) and the
   * heat glow on hot heatsinks (emissive, set in update()).
   */
  applyClayStyle() {
    const seen = new Set();
    const hsl = {};
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        if (m.userData.keep) continue; // walnut slats and brass accents stay in colour
        m.color.getHSL(hsl);
        const glass = m.transparent && m.opacity < 0.12;
        const smoked = m.transparent && !m.map && m.opacity >= 0.12 && m.opacity < 0.6;
        if (smoked) {
          // Translucent case panels: smoked charcoal so the interior stays readable.
          m.color.setRGB(0.1, 0.105, 0.115);
          m.opacity = 0.3;
          m.needsUpdate = true;
          continue;
        }
        const g = glass ? 0.92 : 0.4 + 0.42 * Math.pow(hsl.l, 0.8);
        m.color.setRGB(g * 0.965, g * 0.98, g);
        if (!glass) {
          m.metalness = Math.min(m.metalness, 0.12);
          m.roughness = Math.max(0.5, Math.min(0.7, m.roughness + 0.2));
        }
        // Keep the LED strips from glowing purple; heat glow is re-applied each frame.
        if (m !== this.cpuFinMat && m !== this.gpuFinMat) m.emissive?.setRGB(0, 0, 0);
        m.envMapIntensity = glass ? 1.2 : 0.7;
        m.needsUpdate = true;
      }
    });
  }

  setModes(modes) {
    for (const [id, v] of this.slots) {
      const mode = modes[id] || 'blocked';
      v.mode = mode;
      const isFan = mode === 'intake' || mode === 'exhaust';
      v.fan.group.visible = isFan;
      v.ring.visible = isFan;
      v.arrow.visible = isFan;
      v.grill.visible = mode === 'open';
      v.plate.visible = mode === 'blocked';
      if (isFan) {
        const color = MODE_COLORS[mode];
        v.ring.material.color.setHex(color);
        v.arrow.children.forEach((m) => m.material.color.setHex(color));
        const flow = v.outward.clone().multiplyScalar(mode === 'exhaust' ? 1 : -1);
        v.fan.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flow);
        v.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flow);
        // Intake arrows sit outside pointing in; exhaust arrows sit outside pointing out.
        v.arrow.position.copy(v.outward).multiplyScalar(mode === 'exhaust' ? 0.012 : 0.062);
      }
    }
  }

  setHighlight(slotId) {
    for (const [id, v] of this.slots) v.highlight.visible = id === slotId;
  }

  setPanelsVisible(on) {
    for (const m of this.panelMeshes) m.visible = on;
  }

  update(dt, summary, timeScale) {
    const visRate = Math.min(1, Math.sqrt(timeScale / 0.25));
    const fanMap = new Map((summary?.fans || []).map((f) => [f.id, f]));
    for (const [id, v] of this.slots) {
      const f = fanMap.get(id);
      if (!f || !v.fan.group.visible) continue;
      v.fan.rotor.rotation.z += dt * 22 * (f.cfm / 70) * visRate;
    }
    for (const f of this.internalFans) {
      const s = fanMap.get(f.def.id);
      if (s) f.rotor.rotation.z += dt * (f.def.visual === 'blower' ? 30 : 24) * s.speed * visRate;
    }
    if (summary?.groups) {
      const c = [0, 0, 0];
      // Heatsinks only glow once they are genuinely hot, in warm colours.
      const glow = (mat, temp) => {
        const t = Math.max(0, Math.min(1, (temp - 50) / 40));
        heat(0.72 + 0.28 * t, c);
        const k = t * 0.5;
        mat.emissive.setRGB(c[0] * k, c[1] * k, c[2] * k);
      };
      glow(this.cpuFinMat, summary.groups.cpu.sink);
      glow(this.gpuFinMat, summary.groups.gpu.sink);
    }
  }
}
