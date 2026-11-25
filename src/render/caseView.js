import * as THREE from 'three';
import { SLOTS, FACES, PARTS, INTERNAL_FANS, FIXED_VENTS } from '../sim/model.js';
import { heat } from './colormap.js';

const PLANE_AXES = [[1, 2], [0, 2], [0, 1]];
const MODE_COLORS = { intake: 0x38b6ff, exhaust: 0xff7a3d };

const partBox = (id) => PARTS.find((p) => p.id === id);

function boxMesh(min, max, material) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
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

/** A fan whose local +Z is the direction it pushes air. */
function makeFan({ size, radius, hub, blades = 7, depth = 0.025, frame = true, accent = 0x2a2f3a }) {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.6, metalness: 0.2 });
  if (frame) {
    const sq = new THREE.Shape();
    const hs = size / 2;
    const cr = size * 0.08;
    sq.moveTo(-hs + cr, -hs);
    sq.lineTo(hs - cr, -hs); sq.quadraticCurveTo(hs, -hs, hs, -hs + cr);
    sq.lineTo(hs, hs - cr); sq.quadraticCurveTo(hs, hs, hs - cr, hs);
    sq.lineTo(-hs + cr, hs); sq.quadraticCurveTo(-hs, hs, -hs, hs - cr);
    sq.lineTo(-hs, -hs + cr); sq.quadraticCurveTo(-hs, -hs, -hs + cr, -hs);
    const hole = new THREE.Path();
    hole.absarc(0, 0, radius + 0.002, 0, Math.PI * 2, true);
    sq.holes.push(hole);
    const fg = new THREE.ExtrudeGeometry(sq, { depth, bevelEnabled: false, curveSegments: 32 });
    fg.translate(0, 0, -depth / 2);
    group.add(new THREE.Mesh(fg, frameMat));
  }
  const rotor = new THREE.Group();
  const hubGeo = new THREE.CylinderGeometry(hub, hub, depth * 0.7, 24);
  hubGeo.rotateX(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.4, metalness: 0.3 });
  rotor.add(new THREE.Mesh(hubGeo, hubMat));
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x3a404d, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  const len = radius - hub;
  const bladeShape = new THREE.Shape();
  // A swept blade outline in the rotor plane.
  bladeShape.moveTo(0, -0.35);
  bladeShape.bezierCurveTo(0.35, -0.55, 0.85, -0.45, 1, -0.1);
  bladeShape.bezierCurveTo(1.02, 0.25, 0.8, 0.45, 0.55, 0.5);
  bladeShape.bezierCurveTo(0.35, 0.3, 0.15, 0.25, 0, 0.3);
  bladeShape.lineTo(0, -0.35);
  const bg = new THREE.ShapeGeometry(bladeShape, 10);
  bg.scale(len, len * 0.55, 1);
  bg.translate(hub * 0.95, 0, 0);
  for (let b = 0; b < blades; b++) {
    const blade = new THREE.Mesh(bg, bladeMat);
    blade.material.side = THREE.DoubleSide;
    const pivot = new THREE.Group();
    blade.rotation.x = -0.55; // pitch
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

export class CaseView {
  constructor(dims) {
    this.dims = dims; // [W, H, D] of the simulated interior
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
  }

  slotCenter(slot) {
    const { axis, side } = FACES[slot.face];
    const c = slot.c.slice();
    c[axis] = side ? this.dims[axis] : 0;
    return c;
  }

  buildShell() {
    const [W, H, D] = this.dims;
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
      new THREE.LineBasicMaterial({ color: 0x6d7686, transparent: true, opacity: 0.8 }),
    );
    edges.position.set(W / 2, H / 2, D / 2);
    this.group.add(edges);

    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x262b35, roughness: 0.55, metalness: 0.5, transparent: true, opacity: 0.32,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fc6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
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

  buildParts() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c313b, roughness: 0.5, metalness: 0.6 });
    const pcb = new THREE.MeshStandardMaterial({ color: 0x15201b, roughness: 0.7, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.5, metalness: 0.4 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xc27a45, roughness: 0.3, metalness: 0.9 });
    const g = this.group;
    const W = this.dims[0];

    // PSU shroud with a lighter top edge.
    const shroud = partBox('psu-shroud');
    g.add(boxMesh(shroud.min, [Math.min(shroud.max[0], W), shroud.max[1], shroud.max[2]], metal));
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

    // CPU tower cooler.
    const block = partBox('cpu-block');
    g.add(boxMesh(block.min, block.max, copper));
    const fins = partBox('cpu-fins');
    this.cpuFinMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd5, roughness: 0.32, metalness: 0.85, emissive: 0x000000 });
    const finCount = 38;
    const finGeo = new THREE.BoxGeometry(fins.max[0] - fins.min[0], 0.0008, fins.max[2] - fins.min[2]);
    const cpuFins = new THREE.InstancedMesh(finGeo, this.cpuFinMat, finCount);
    const m4 = new THREE.Matrix4();
    for (let n = 0; n < finCount; n++) {
      const y = fins.min[1] + ((n + 0.5) / finCount) * (fins.max[1] - fins.min[1]);
      m4.makeTranslation((fins.min[0] + fins.max[0]) / 2, y, (fins.min[2] + fins.max[2]) / 2);
      cpuFins.setMatrixAt(n, m4);
    }
    g.add(cpuFins);
    g.add(boxMesh([fins.min[0] - 0.002, fins.min[1], fins.min[2]], [fins.min[0], fins.max[1], fins.max[2]], dark));
    for (const [y, z] of [[0.333, 0.158], [0.357, 0.158], [0.333, 0.182], [0.357, 0.182]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, block.min[0] - fins.min[0] + 0.004, 10), copper);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set((block.min[0] + fins.min[0]) / 2, y, z);
      g.add(pipe);
    }

    // RAM sticks.
    const ram = partBox('ram');
    const ramMat = new THREE.MeshStandardMaterial({ color: 0x30343e, roughness: 0.4, metalness: 0.7 });
    const ramLed = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x7b5cff, emissiveIntensity: 1.2 });
    for (let n = 0; n < 4; n++) {
      const z0 = ram.min[2] + n * 0.0075;
      g.add(boxMesh([ram.min[0] + 0.004, ram.min[1], z0], [ram.max[0], ram.max[1], z0 + 0.005], ramMat));
      g.add(boxMesh([ram.min[0], ram.min[1], z0 + 0.001], [ram.min[0] + 0.004, ram.max[1], z0 + 0.004], ramLed));
    }

    // GPU: PCB + backplate, fin stack, shroud with fan cutouts.
    const gp = partBox('gpu-pcb');
    g.add(boxMesh(gp.min, gp.max, pcb));
    g.add(boxMesh([gp.min[0], gp.max[1], gp.min[2]], [gp.max[0], gp.max[1] + 0.003, gp.max[2]], dark));
    const gf = partBox('gpu-fins');
    this.gpuFinMat = new THREE.MeshStandardMaterial({ color: 0xaeb4be, roughness: 0.35, metalness: 0.85, emissive: 0x000000 });
    const gCount = 70;
    const gGeo = new THREE.BoxGeometry(gf.max[0] - gf.min[0], gf.max[1] - gf.min[1], 0.0008);
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
    for (const f of INTERNAL_FANS.filter((x) => x.group === 'gpu')) {
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

  buildSlots() {
    for (const slot of SLOTS) {
      const { axis, side } = FACES[slot.face];
      const outward = new THREE.Vector3();
      outward.setComponent(axis, side ? 1 : -1);
      const c = new THREE.Vector3(...this.slotCenter(slot));
      const root = new THREE.Group();
      root.position.copy(c);
      this.group.add(root);

      const fan = makeFan({ size: slot.size, radius: 0.058, hub: 0.02 });
      fan.group.position.copy(outward).multiplyScalar(-0.0135);
      root.add(fan.group);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.0605, 0.0022, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
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
    for (const f of INTERNAL_FANS) {
      const isCpu = f.group === 'cpu';
      const fan = makeFan({
        size: 0.12, radius: f.radius, hub: f.hub, blades: isCpu ? 7 : 11,
        depth: isCpu ? 0.025 : 0.012, frame: isCpu, accent: isCpu ? 0x8a5a3a : 0x30343e,
      });
      const dir = new THREE.Vector3();
      dir.setComponent(f.axis, f.dir);
      fan.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const pos = [0, 0, 0];
      const [pa, pb] = PLANE_AXES[f.axis];
      pos[pa] = f.c[0];
      pos[pb] = f.c[1];
      pos[f.axis] = f.at - f.dir * (isCpu ? 0.0128 : 0.0065);
      fan.group.position.set(...pos);
      this.group.add(fan.group);
      this.internalFans.push({ def: f, ...fan });
    }
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
      if (s) f.rotor.rotation.z += dt * 24 * s.speed * visRate;
    }
    if (summary?.groups) {
      const c = [0, 0, 0];
      const glow = (mat, temp) => {
        const t = (temp - 35) / 60;
        heat(t, c);
        const k = Math.max(0, Math.min(1, t)) * 0.45;
        mat.emissive.setRGB(c[0] * k, c[1] * k, c[2] * k);
      };
      glow(this.cpuFinMat, summary.groups.cpu.sink);
      glow(this.gpuFinMat, summary.groups.gpu.sink);
    }
  }
}
