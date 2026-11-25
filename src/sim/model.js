// Physical layout of the simulated PC case. Everything is in meters.
//
// Coordinate system (case interior):
//   x: 0 = glass side panel,  W = motherboard tray side
//   y: 0 = floor,             H = roof
//   z: 0 = rear panel,        D = front panel

export const CASE = { W: 0.21, H: 0.46, D: 0.44 };

export const CFM_PER_M3S = 2118.88;

// Fan slots in the case walls. `face` names the wall, `c` is the slot center
// in case coordinates, `size` is the fan frame size.
export const SLOTS = [
  { id: 'front-top', label: 'Front 1 (top)', face: 'front', c: [0.105, 0.34, CASE.D], size: 0.12 },
  { id: 'front-mid', label: 'Front 2 (middle)', face: 'front', c: [0.105, 0.215, CASE.D], size: 0.12 },
  { id: 'front-low', label: 'Front 3 (bottom)', face: 'front', c: [0.105, 0.09, CASE.D], size: 0.12 },
  { id: 'top-front', label: 'Top 1 (front)', face: 'top', c: [0.09, CASE.H, 0.34], size: 0.12 },
  { id: 'top-mid', label: 'Top 2 (middle)', face: 'top', c: [0.09, CASE.H, 0.22], size: 0.12 },
  { id: 'top-rear', label: 'Top 3 (rear)', face: 'top', c: [0.09, CASE.H, 0.10], size: 0.12 },
  { id: 'rear', label: 'Rear', face: 'rear', c: [0.105, 0.345, 0], size: 0.12 },
  { id: 'bottom', label: 'Bottom', face: 'bottom', c: [0.105, 0, 0.37], size: 0.12 },
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

// A typical 120 mm case fan at 100 % duty.
export const CASE_FAN = { qMax: 0.033, pMax: 24, radius: 0.058, hub: 0.019 };

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

// Internal parts. `kind`:
//   solid  - blocks flow completely
//   porous - heatsink fins: flow passes with anisotropic drag (1/s per axis)
// `heat` names the heat group that a porous block exchanges heat with.
export const PARTS = [
  { id: 'psu-shroud', kind: 'solid', min: [0, 0, 0], max: [W, 0.085, 0.3] },
  { id: 'motherboard', kind: 'solid', min: [W - 0.01, 0.11, 0.015], max: [W, 0.415, 0.26] },
  { id: 'io-shield', kind: 'solid', min: [W - 0.035, 0.3, 0], max: [W, 0.415, 0.015] },
  { id: 'cpu-block', kind: 'solid', min: [W - 0.035, 0.325, 0.15], max: [W - 0.01, 0.365, 0.19] },
  {
    id: 'cpu-fins', kind: 'porous', heat: 'cpu',
    min: [0.045, 0.285, 0.145], max: [W - 0.035, 0.405, 0.195],
    // Tower fins are horizontal plates: vertical flow is strongly resisted.
    drag: [14, 220, 6],
  },
  { id: 'ram', kind: 'solid', min: [W - 0.042, 0.28, 0.222], max: [W - 0.01, 0.413, 0.25] },
  { id: 'gpu-pcb', kind: 'solid', min: [0.06, 0.245, 0.005], max: [W - 0.01, 0.253, 0.31] },
  {
    id: 'gpu-fins', kind: 'porous', heat: 'gpu',
    min: [0.065, 0.205, 0.02], max: [W - 0.012, 0.245, 0.3],
    // GPU fin plates are perpendicular to the card length: air leaves sideways.
    drag: [6, 10, 220],
  },
];

// Thin plates that block faces without filling cells (fan shrouds).
// Faces on the plane are blocked inside the rectangle except where a fan sits.
export const PLATES = [
  { id: 'gpu-shroud', axis: 1, at: 0.205, min: [0.06, 0.015], max: [W - 0.01, 0.305] }, // [x,z]
  { id: 'cpu-fan-frame', axis: 2, at: 0.195, min: [0.05, 0.285], max: [0.17, 0.405] }, // [x,y]
];

// Fans that live inside the case (coolers). `dir` is the push direction.
export const INTERNAL_FANS = [
  { id: 'cpu-fan', group: 'cpu', axis: 2, dir: -1, at: 0.195, c: [0.11, 0.345], radius: 0.057, hub: 0.019, qMax: 0.036, pMax: 30 },
  { id: 'gpu-fan-1', group: 'gpu', axis: 1, dir: 1, at: 0.205, c: [0.128, 0.065], radius: 0.044, hub: 0.014, qMax: 0.02, pMax: 26 },
  { id: 'gpu-fan-2', group: 'gpu', axis: 1, dir: 1, at: 0.205, c: [0.128, 0.16], radius: 0.044, hub: 0.014, qMax: 0.02, pMax: 26 },
  { id: 'gpu-fan-3', group: 'gpu', axis: 1, dir: 1, at: 0.205, c: [0.128, 0.255], radius: 0.044, hub: 0.014, qMax: 0.02, pMax: 26 },
];

// Heat-producing components.
//   G0 + G1 * v^0.8  is the heatsink-to-air conductance (W/K) at mean fin air speed v (m/s)
//   rjc              is the die-to-heatsink resistance (K/W)
//   cap              is the heatsink heat capacity (J/K), kept small so the demo settles quickly
export const HEAT_GROUPS = {
  cpu: { label: 'CPU', G0: 0.7, G1: 5.2, rjc: 0.1, cap: 5, tjMax: 100, defaultPower: 150 },
  gpu: { label: 'GPU', G0: 1.2, G1: 10.5, rjc: 0.05, cap: 9, tjMax: 90, defaultPower: 300 },
};

export const PRESETS = {
  balanced: {
    label: 'Balanced',
    hint: '3 front intake, top + rear exhaust',
    modes: { 'front-top': 'intake', 'front-mid': 'intake', 'front-low': 'intake', 'top-front': 'open', 'top-mid': 'exhaust', 'top-rear': 'exhaust', rear: 'exhaust', bottom: 'open' },
  },
  positive: {
    label: 'Positive pressure',
    hint: 'more intake than exhaust; filtered, less dust',
    modes: { 'front-top': 'intake', 'front-mid': 'intake', 'front-low': 'intake', 'top-front': 'blocked', 'top-mid': 'blocked', 'top-rear': 'open', rear: 'exhaust', bottom: 'intake' },
  },
  negative: {
    label: 'Negative pressure',
    hint: 'exhaust-heavy; air sneaks in through gaps',
    modes: { 'front-top': 'open', 'front-mid': 'intake', 'front-low': 'open', 'top-front': 'exhaust', 'top-mid': 'exhaust', 'top-rear': 'exhaust', rear: 'exhaust', bottom: 'open' },
  },
  chimney: {
    label: 'Chimney',
    hint: 'bottom/front in, all top out',
    modes: { 'front-top': 'blocked', 'front-mid': 'blocked', 'front-low': 'intake', 'top-front': 'exhaust', 'top-mid': 'exhaust', 'top-rear': 'exhaust', rear: 'blocked', bottom: 'intake' },
  },
  stock: {
    label: 'Stock (rear only)',
    hint: 'one rear exhaust, solid front',
    modes: { 'front-top': 'blocked', 'front-mid': 'blocked', 'front-low': 'blocked', 'top-front': 'open', 'top-mid': 'open', 'top-rear': 'open', rear: 'exhaust', bottom: 'blocked' },
  },
  backwards: {
    label: 'Backwards',
    hint: 'fans fighting the coolers',
    modes: { 'front-top': 'exhaust', 'front-mid': 'exhaust', 'front-low': 'exhaust', 'top-front': 'intake', 'top-mid': 'intake', 'top-rear': 'intake', rear: 'intake', bottom: 'blocked' },
  },
  passive: {
    label: 'Passive',
    hint: 'no case fans, open mesh',
    modes: { 'front-top': 'open', 'front-mid': 'open', 'front-low': 'open', 'top-front': 'open', 'top-mid': 'open', 'top-rear': 'open', rear: 'open', bottom: 'open' },
  },
};
