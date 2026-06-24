// Levels + Curves LUT builders.
// Both produce a 256→256 uint8 lookup table that maps input luminance to output luminance.
// Applied once per pixel before separation, so they affect all modes uniformly.

export interface LevelsAdjustment {
  inBlack:  number;  // 0–255  pixels at/below this → output 0
  inGamma:  number;  // 0.10–5.00  midtone brightness (1.00 = linear)
  inWhite:  number;  // 0–255  pixels at/above this → output 255
  outBlack: number;  // 0–255  output shadow floor
  outWhite: number;  // 0–255  output highlight ceiling
}

export type CurvePoint = [number, number]; // [input 0–255, output 0–255]

export const DEFAULT_LEVELS: LevelsAdjustment = {
  inBlack: 0, inGamma: 1.00, inWhite: 255, outBlack: 0, outWhite: 255,
};

export const DEFAULT_CURVES: CurvePoint[] = [[0, 0], [255, 255]];

// Levels LUT: normalize → gamma → remap to output range
export function buildLevelsLUT(lv: LevelsAdjustment): Uint8Array {
  const lut      = new Uint8Array(256);
  const inRange  = Math.max(1, lv.inWhite - lv.inBlack);
  const outRange = lv.outWhite - lv.outBlack;
  const gamma    = Math.max(0.01, lv.inGamma);
  for (let i = 0; i < 256; i++) {
    const norm    = Math.max(0, Math.min(1, (i - lv.inBlack) / inRange));
    const gammaed = Math.pow(norm, 1 / gamma);
    lut[i]        = Math.max(0, Math.min(255, Math.round(lv.outBlack + gammaed * outRange)));
  }
  return lut;
}

// Curves LUT: monotone cubic spline (Fritsch–Carlson algorithm).
// Guaranteed monotone — no overshoot or wavy artefacts between points.
export function buildCurvesLUT(rawPts: CurvePoint[]): Uint8Array {
  const pts = [...rawPts].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return Uint8Array.from({ length: 256 }, (_, i) => i);

  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const n  = xs.length;

  // Secant slopes
  const dx = new Float64Array(n - 1);
  const ms = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    ms[i] = (ys[i + 1] - ys[i]) / dx[i];
  }

  // Tangents (Hermite)
  const ts = new Float64Array(n);
  ts[0] = ms[0];
  for (let i = 1; i < n - 1; i++) ts[i] = (ms[i - 1] + ms[i]) / 2;
  ts[n - 1] = ms[n - 2];

  // Fritsch–Carlson monotonicity correction
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(ms[i]) < 1e-9) { ts[i] = ts[i + 1] = 0; continue; }
    const alpha = ts[i] / ms[i], beta = ts[i + 1] / ms[i];
    const h = Math.hypot(alpha, beta);
    if (h > 3) { const s = 3 / h; ts[i] *= s; ts[i + 1] *= s; }
  }

  // Evaluate the spline at every integer input 0–255
  const lut = new Uint8Array(256);
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= xs[0])     { lut[x] = Math.max(0, Math.min(255, Math.round(ys[0]))); continue; }
    if (x >= xs[n - 1]) { lut[x] = Math.max(0, Math.min(255, Math.round(ys[n - 1]))); continue; }
    while (seg < n - 2 && xs[seg + 1] <= x) seg++;
    const h  = dx[seg];
    const t  = (x - xs[seg]) / h;
    const t2 = t * t, t3 = t2 * t;
    const y  = (2*t3 - 3*t2 + 1)*ys[seg]
             + (t3 - 2*t2 + t)*h*ts[seg]
             + (-2*t3 + 3*t2)*ys[seg + 1]
             + (t3 - t2)*h*ts[seg + 1];
    lut[x] = Math.max(0, Math.min(255, Math.round(y)));
  }
  return lut;
}
