// Physical layout of the simulated PC case. Everything is in meters.
//
// Coordinate system (case interior):
//   x: 0 = glass side panel,  W = motherboard tray side
//   y: 0 = floor,             H = roof
//   z: 0 = rear panel,        D = front panel

// Interior of an original minimal ATX airflow case (W x H x D). Perforated
// front and top panels, glass side and trim sit just outside this volume.
export const CASE = { W: 0.21, H: 0.46, D: 0.44 };

export const CFM_PER_M3S = 2118.88;

// Fan slots in the case walls. `face` names the wall, `c` is the slot center
// in case coordinates, `size` is the fan frame size, `fan` the fan model.
// Mounts: 3 x 140 mm front, 2 x 140 mm top, 1 x 140 mm rear, 1 x 140 mm bottom
// (under the open front section, ahead of the PSU shroud).
export const SLOTS = [
  { id: 'front-top', label: 'Front Top', face: 'front', c: [0.105, 0.365, CASE.D], size: 0.14, fan: 'a14' },
  { id: 'front-mid', label: 'Front Middle', face: 'front', c: [0.105, 0.225, CASE.D], size: 0.14, fan: 'a14' },
  { id: 'front-low', label: 'Front Bottom', face: 'front', c: [0.105, 0.085, CASE.D], size: 0.14, fan: 'a14' },
  { id: 'top-front', label: 'Top Front', face: 'top', c: [0.09, CASE.H, 0.27], size: 0.14, fan: 'a14' },
  { id: 'top-rear', label: 'Top Rear', face: 'top', c: [0.09, CASE.H, 0.12], size: 0.14, fan: 'a14' },
  { id: 'rear', label: 'Rear', face: 'rear', c: [0.1, 0.345, 0], size: 0.14, fan: 'a14' },
  { id: 'bottom', label: 'Bottom', face: 'bottom', c: [0.105, 0, 0.36], size: 0.14, fan: 'a14' },
];

// Outward normal axis/sign of each wall.
export const FACES = {
  front: { axis: 2, side: 1 },
  rear: { axis: 2, side: 0 },
  top: { axis: 1, side: 1 },
  bottom: { axis: 1, side: 0 },
  left: { axis: 0, side: 0 },
  right: { axis: 0, side: 1 },
};

export const SLOT_MODES = ['intake', 'exhaust', 'open', 'blocked'];

// Case fans at 100 % duty (manufacturer data sheets):
//   a14: 140 x 140 x 25 mm, 1500 rpm, 155.6 m3/h, 2.56 mm H2O (25.1 Pa)
//   a12: 120 x 120 x 25 mm, 2000 rpm, 102.1 m3/h, 2.34 mm H2O (22.9 Pa)
export const FAN_SPECS = {
  a14: { qMax: 155.6 / 3600, pMax: 2.56 * 9.80665, radius: 0.0675, hub: 0.021 },
  a12: { qMax: 102.1 / 3600, pMax: 2.34 * 9.80665, radius: 0.057, hub: 0.02 },
};
export const CASE_FAN = FAN_SPECS.a14;

// Vent conductances in (m/s of face velocity) per Pa of pressure difference.
export const VENT_K = {
  mesh: 1.1, // an empty fan slot covered by dust-filter mesh
  pci: 0.18, // expansion slot covers and bracket perforations
};

// Always-present leak/vent openings that are not fan slots.
export const FIXED_VENTS = [
  // Rear expansion slots (GPU bracket and slot covers).
  { id: 'pci', face: 'rear', min: [0.06, 0.11], max: [0.195, 0.26], k: VENT_K.pci },
];

const W = CASE.W;

export const RAM = { len: 0.13335, h: 0.03125, t: 0.0032, y0: 0.279, z: [0.222, 0.2295, 0.237, 0.2445] };

export const CPU_COOLER = {
  base: W - 0.017, // cooler contact plate (CPU + socket below it)
  top: W - 0.017 - 0.158, // 158 mm tall
  finBottom: 0.163, // heatpipes are bare between the base and here
  y: [0.345 - 0.0625, 0.345 + 0.0625], // 125 mm wide
  z: [0.141, 0.199], // 58 mm fin stack
  fanC: [0.1, 0.345], // [x, y] center of both 120 mm fans
  heatpipes: 7,
};

// Internal parts. `kind`:
//   solid  - blocks flow completely
//   porous - heatsink fins: flow passes with anisotropic drag (1/s per axis)
// `heat` names the heat group that a porous block exchanges heat with.
export const PARTS = [
  { id: 'psu-shroud', kind: 'solid', min: [0, 0, 0], max: [W, 0.1, 0.285] },
  { id: 'motherboard', kind: 'solid', min: [W - 0.01, 0.11, 0.015], max: [W, 0.415, 0.26] },
  { id: 'io-shield', kind: 'solid', min: [W - 0.035, 0.3, 0], max: [W, 0.415, 0.015] },
  // Single-tower cooler: 158 mm tall (base at x = 0.193), 125 mm wide, 58 mm fin stack
  // (112 mm deep with both fans). Fin plates are parallel to the motherboard,
  // stacked along the heatpipes toward the glass.
  { id: 'cpu-block', kind: 'solid', min: [W - 0.032, 0.325, 0.15], max: [W - 0.01, 0.365, 0.19] },
  {
    id: 'cpu-fins', kind: 'porous', heat: 'cpu',
    min: [CPU_COOLER.top, CPU_COOLER.y[0], CPU_COOLER.z[0]], max: [CPU_COOLER.finBottom, CPU_COOLER.y[1], CPU_COOLER.z[1]],
    drag: [220, 14, 6],
  },
  // Four bare DDR5 DIMMs, 133.35 x 31.25 mm, in slots right of the cooler.
  { id: 'ram', kind: 'solid', min: [W - 0.01 - RAM.h, RAM.y0, RAM.z[0]], max: [W - 0.01, RAM.y0 + RAM.len, RAM.z[RAM.z.length - 1] + RAM.t] },
];

// Thin plates that block faces without filling cells (fan shrouds).
// Faces on the plane are blocked inside the rectangle except where a fan sits.
export const PLATES = [
  { id: 'cpu-fan-frame', axis: 2, at: 0.199, min: [0.04, 0.285], max: [0.16, 0.405] }, // [x,y]
  { id: 'cpu-fan-frame-rear', axis: 2, at: 0.141, min: [0.04, 0.285], max: [0.16, 0.405] },
];

// Fans that live inside the case (coolers). `dir` is the push direction.
export const INTERNAL_FANS = [
  // Push-pull pair of 120 x 25 mm fans (102.1 m3/h, 2.34 mm H2O each at 2000 rpm).
  { id: 'cpu-fan', group: 'cpu', axis: 2, dir: -1, at: 0.199, c: [0.1, 0.345], radius: 0.057, hub: 0.02, qMax: 102.1 / 3600, pMax: 2.34 * 9.80665 },
  { id: 'cpu-fan-rear', group: 'cpu', axis: 2, dir: -1, at: 0.141, c: [0.1, 0.345], radius: 0.057, hub: 0.02, qMax: 102.1 / 3600, pMax: 2.34 * 9.80665, pull: true },
];

// Heat-producing components.
//   G0 + G1 * v^0.8  is the heatsink-to-air conductance (W/K) at mean fin air speed v (m/s)
//   rjc              is the die-to-heatsink resistance (K/W)
//   cap              is the heatsink heat capacity (J/K), kept small so the demo settles quickly
export const HEAT_GROUPS = {
  cpu: { label: 'CPU', G0: 0.7, G1: 5.2, rjc: 0.1, cap: 5, tjMax: 100, defaultPower: 150 },
  gpu: { label: 'GPU', G0: 1.2, G1: 10.5, rjc: 0.05, cap: 9, tjMax: 90, defaultPower: 300 }, // overridden per card in GPUS
  // PSU: conversion losses heat its internals; hybrid fan (off until warm), never throttles.
  psu: { label: 'PSU', G0: 0.8, G1: 6, rjc: 0, cap: 7, tjMax: 999, defaultPower: 0, hybrid: true },
};

// Graphics cards. Each brings its own parts, shroud plates, fans, vents and
// heatsink parameters. Card length runs along z from the rear bracket.
//
// The workstation blower card follows a 267 x 111 x 40 mm dual-slot design:
// one radial blower near the far end pulls air in through both faces, pushes
// it through an enclosed fin stack and out of the slotted rear bracket.
export const GPU_BLOWER = {
  x0: 0.089, // card edge facing the glass (111 mm tall card on a board at x = 0.2)
  y0: 0.214, // fan face (40 mm thick, PCB side up)
  y1: 0.254, // back cover
  pcb: [0.246, 0.252],
  zEnd: 0.272, // 267 mm long
  finEnd: 0.19, // fins run from the bracket to here; the blower chamber follows
  fan: { c: [0.147, 0.224], radius: 0.033, hub: 0.019 }, // [x, z]
};

const B = GPU_BLOWER;
export const GPUS = {
  blower: {
    label: 'Workstation Blower',
    power: 300,
    parts: [
      { id: 'blower-pcb', kind: 'solid', min: [B.x0 + 0.002, B.pcb[0], 0.005], max: [W - 0.01, B.y1, B.finEnd] },
      {
        id: 'blower-fins', kind: 'porous', heat: 'gpu',
        min: [B.x0 + 0.003, B.y0, 0], max: [W - 0.012, B.pcb[0], B.finEnd],
        // Long fins aligned with the duct: air is guided toward the bracket.
        drag: [220, 30, 8],
      },
    ],
    plates: [
      // Enclosed shroud: both side walls, the far end, the fan face and the back cover.
      { id: 'blower-side-glass', axis: 0, at: B.x0 + 0.003, min: [B.y0, 0], max: [B.y1, B.zEnd - 0.004] }, // [y,z]
      { id: 'blower-side-board', axis: 0, at: W - 0.012, min: [B.y0, 0], max: [B.y1, B.zEnd - 0.004] },
      { id: 'blower-end', axis: 2, at: B.zEnd - 0.004, min: [B.x0, B.y0], max: [W - 0.01, B.y1] }, // [x,y]
      { id: 'blower-fan-face', axis: 1, at: B.y0, min: [B.x0, 0], max: [W - 0.01, B.zEnd - 0.004] }, // [x,z]
      { id: 'blower-back', axis: 1, at: B.y1, min: [B.x0, B.finEnd], max: [W - 0.01, B.zEnd - 0.004] },
    ],
    fans: [
      { id: 'gpu-blower', group: 'gpu', axis: 1, dir: 1, at: B.y0, c: B.fan.c, radius: B.fan.radius, hub: 0.012, qMax: 0.0085, pMax: 110, visual: 'blower' },
      { id: 'gpu-blower-back', group: 'gpu', axis: 1, dir: -1, at: B.y1, c: B.fan.c, radius: B.fan.radius, hub: 0.012, qMax: 0.006, pMax: 110, visual: null },
    ],
    vents: [
      // Slotted bracket grille that the blower exhausts through.
      { id: 'gpu-bracket', face: 'rear', min: [B.x0 + 0.003, B.y0], max: [W - 0.012, B.pcb[0]], k: 1.0, tag: 'gpu' },
    ],
    heat: { G0: 1.0, G1: 4.2, rjc: 0.05, cap: 9, tjMax: 90 },
  },
  openair: {
    label: 'Open-Air',
    power: 300,
    parts: [
      { id: 'gpu-pcb', kind: 'solid', min: [0.06, 0.245, 0.005], max: [W - 0.01, 0.253, 0.31] },
      {
        id: 'gpu-fins', kind: 'porous', heat: 'gpu',
        min: [0.065, 0.205, 0.02], max: [W - 0.012, 0.245, 0.3],
        // GPU fin plates are perpendicular to the card length: air leaves sideways.
        drag: [6, 10, 220],
      },
    ],
    plates: [
      { id: 'gpu-shroud', axis: 1, at: 0.205, min: [0.06, 0.015], max: [W - 0.01, 0.305] }, // [x,z]
    ],
    fans: [
      { id: 'gpu-fan-1', group: 'gpu', axis: 1, dir: 1, at: 0.205, c: [0.128, 0.065], radius: 0.044, hub: 0.014, qMax: 0.02, pMax: 26, visual: 'axial' },
      { id: 'gpu-fan-2', group: 'gpu', axis: 1, dir: 1, at: 0.205, c: [0.128, 0.16], radius: 0.044, hub: 0.014, qMax: 0.02, pMax: 26, visual: 'axial' },
      { id: 'gpu-fan-3', group: 'gpu', axis: 1, dir: 1, at: 0.205, c: [0.128, 0.255], radius: 0.044, hub: 0.014, qMax: 0.02, pMax: 26, visual: 'axial' },
    ],
    vents: [],
    heat: { G0: 1.2, G1: 10.5, rjc: 0.05, cap: 9, tjMax: 90 },
  },
};
export const DEFAULT_GPU = 'blower';

// ATX power supply under the shroud at the rear: 150 x 86 x 210 mm, 1600 W,
// 135 mm fan behind a honeycomb grille, honeycomb exhaust through the rear panel.
export const PSU = {
  min: [0.03, 0, 0], max: [0.18, 0.092, 0.21], // sim volume (86 mm body + feet)
  fan: { c: [0.105, 0.105], radius: 0.0655, hub: 0.021 }, // [x, z]
  rating: 1600,
  baseLoad: 60, // motherboard, RAM, drives, fans (W)
  // Efficiency vs load fraction (Titanium-class curve).
  eff: [[0, 0.82], [0.1, 0.9], [0.2, 0.92], [0.5, 0.94], [1, 0.91]],
};
export const PSU_MODES = { down: 'Fan Down', up: 'Fan Up' };

export function psuEfficiency(lf) {
  const e = PSU.eff;
  if (lf <= e[0][0]) return e[0][1];
  for (let i = 1; i < e.length; i++) {
    if (lf <= e[i][0]) {
      const t = (lf - e[i - 1][0]) / (e[i][0] - e[i - 1][0]);
      return e[i - 1][1] + t * (e[i][1] - e[i - 1][1]);
    }
  }
  return e[e.length - 1][1];
}

/** Sim geometry for the PSU in a given orientation. */
export function psuLayout(mode) {
  const f = PSU.fan;
  const layout = {
    parts: [{ id: 'psu', kind: 'porous', heat: 'psu', min: PSU.min, max: PSU.max, drag: [25, 25, 25] }],
    plates: [],
    vents: [{ id: 'psu-rear', face: 'rear', min: [PSU.min[0] + 0.005, 0.004], max: [PSU.max[0] - 0.005, PSU.max[1] - 0.004], k: 0.9, tag: 'psu' }],
    fans: [],
  };
  if (mode === 'up') {
    // Shroud cut-out above the fan so it can breathe case air.
    layout.parts.push({ id: 'psu-cutout', kind: 'fluid', min: [f.c[0] - 0.07, PSU.max[1], f.c[1] - 0.07], max: [f.c[0] + 0.07, 0.1, f.c[1] + 0.07] });
    layout.plates.push({ id: 'psu-top', axis: 1, at: PSU.max[1], min: [PSU.min[0], PSU.min[2]], max: [PSU.max[0], PSU.max[2]] });
    layout.fans.push({ id: 'psu-fan', group: 'psu', axis: 1, dir: -1, at: PSU.max[1], c: f.c, radius: f.radius, hub: f.hub, qMax: 0.03, pMax: 30, visual: 'psu' });
  } else {
    layout.fans.push({ id: 'psu-fan', group: 'psu', axis: 1, dir: 1, at: 0, c: f.c, radius: f.radius, hub: f.hub, qMax: 0.03, pMax: 30, visual: 'psu', tag: 'psu' });
  }
  return layout;
}

const M = (ft, fm, fl, tf, tr, r, b) => ({ 'front-top': ft, 'front-mid': fm, 'front-low': fl, 'top-front': tf, 'top-rear': tr, rear: r, bottom: b });
export const PRESETS = {
  balanced: { label: 'Balanced', hint: '3 front intake, top + rear exhaust', modes: M('intake', 'intake', 'intake', 'exhaust', 'exhaust', 'exhaust', 'open') },
  positive: { label: 'Positive Pressure', hint: 'more intake than exhaust', modes: M('intake', 'intake', 'intake', 'blocked', 'open', 'exhaust', 'intake') },
  negative: { label: 'Negative Pressure', hint: 'exhaust-heavy', modes: M('open', 'intake', 'open', 'exhaust', 'exhaust', 'exhaust', 'open') },
  chimney: { label: 'Chimney', hint: 'bottom and low front in, top out', modes: M('blocked', 'blocked', 'intake', 'exhaust', 'exhaust', 'blocked', 'intake') },
  stock: { label: 'Stock', hint: 'rear exhaust only', modes: M('open', 'open', 'open', 'open', 'open', 'exhaust', 'open') },
  backwards: { label: 'Backwards', hint: 'fans fighting the coolers', modes: M('exhaust', 'exhaust', 'exhaust', 'intake', 'intake', 'intake', 'blocked') },
  passive: { label: 'Passive', hint: 'no case fans', modes: M('open', 'open', 'open', 'open', 'open', 'open', 'open') },
};
