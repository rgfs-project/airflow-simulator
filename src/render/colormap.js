// Small colormap helpers. All return [r, g, b] in 0..1 written into `out`.

// Polynomial approximation of Google's Turbo colormap.
export function turbo(t, out) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const t2 = t * t, t3 = t2 * t, t4 = t3 * t, t5 = t4 * t;
  out[0] = 0.13572138 + 4.6153926 * t - 42.66032258 * t2 + 132.13108234 * t3 - 152.94239396 * t4 + 59.28637943 * t5;
  out[1] = 0.09140261 + 2.19418839 * t + 4.84296658 * t2 - 14.18503333 * t3 + 4.27729857 * t4 + 2.82956604 * t5;
  out[2] = 0.1066733 + 12.64194608 * t - 60.58204836 * t2 + 110.36276771 * t3 - 89.90310912 * t4 + 27.34824973 * t5;
  for (let i = 0; i < 3; i++) out[i] = out[i] < 0 ? 0 : out[i] > 1 ? 1 : out[i];
  return out;
}

// Cool-to-hot ramp tuned for air temperature: deep blue -> cyan -> yellow -> red.
const HEAT = [
  [0.0, 0.16, 0.35, 0.95],
  [0.25, 0.1, 0.75, 1.0],
  [0.5, 0.35, 0.95, 0.45],
  [0.72, 1.0, 0.85, 0.15],
  [0.88, 1.0, 0.45, 0.08],
  [1.0, 0.95, 0.12, 0.1],
];

export function heat(t, out) {
  return ramp(HEAT, t, out);
}

// Diverging blue - white - red for signed values; t in -1..1.
const DIVERGE = [
  [0.0, 0.15, 0.35, 0.95],
  [0.5, 0.92, 0.92, 0.95],
  [1.0, 0.95, 0.25, 0.15],
];

export function diverging(t, out) {
  return ramp(DIVERGE, (t + 1) / 2, out);
}

function ramp(stops, t, out) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      out[0] = a[1] + (b[1] - a[1]) * f;
      out[1] = a[2] + (b[2] - a[2]) * f;
      out[2] = a[3] + (b[3] - a[3]) * f;
      return out;
    }
  }
  const l = stops[stops.length - 1];
  out[0] = l[1]; out[1] = l[2]; out[2] = l[3];
  return out;
}

/** CSS linear-gradient string for a colormap function, for legends. */
export function cssGradient(fn, signed = false) {
  const c = [0, 0, 0];
  const parts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    fn(signed ? t * 2 - 1 : t, c);
    parts.push(`rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0}) ${t * 100}%`);
  }
  return `linear-gradient(90deg, ${parts.join(',')})`;
}

export const SOURCE_COLORS = [
  [0.3, 0.75, 1.0],
  [0.45, 1.0, 0.65],
  [1.0, 0.85, 0.3],
  [0.95, 0.45, 1.0],
  [1.0, 0.55, 0.35],
  [0.5, 0.6, 1.0],
  [0.4, 1.0, 1.0],
  [1.0, 0.35, 0.5],
];
export const VENT_COLOR = [0.7, 0.72, 0.78];
