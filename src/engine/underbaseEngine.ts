import type { CmykProPlates } from './cmykProEngine';

export interface UnderbaseOptions {
  density: number;        // 0–100
  includeShadows: boolean;
}

export function generateCmykProUnderbase(
  plates: CmykProPlates,
  opts: UnderbaseOptions,
): Uint8Array {
  const { C, M, Y, K, width: w, height: h } = plates;
  const result = new Uint8Array(w * h);
  const scale = opts.density / 100;

  for (let i = 0; i < w * h; i++) {
    const c = C[i]/255, m = M[i]/255, y = Y[i]/255, k = K[i]/255;
    const r = 1 - Math.min(1, c + k);
    const g = 1 - Math.min(1, m + k);
    const b = 1 - Math.min(1, y + k);
    const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const maxRGB = Math.max(r, g, b);
    const minRGB = Math.min(r, g, b);
    const sat = maxRGB > 0.01 ? (maxRGB - minRGB) / maxRGB : 0;
    if (lum > 0.96) { result[i] = 0; continue; }
    let wVal = lum * 0.60 + sat * 0.40;
    if (k > 0.65 && sat < 0.12) wVal *= Math.max(0, 1 - (k - 0.65) / 0.35);
    if (!opts.includeShadows && lum < 0.22 && sat < 0.18) wVal *= 0.08;
    result[i] = Math.round(Math.max(0, Math.min(1, wVal * scale)) * 255);
  }
  return result;
}

// Morphological erosion — shrink white edges inward to avoid registration halos
export function chokeWhitePlate(
  mask: Uint8Array, w: number, h: number, radius: number,
): Uint8Array {
  if (radius <= 0) return mask;
  const result = new Uint8Array(w * h);
  const ri = Math.ceil(radius);
  const r2 = radius * radius;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const cur = mask[py * w + px];
      if (cur === 0) continue;
      let min = cur;
      outer: for (let dy = -ri; dy <= ri; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) { min = 0; break; }
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = px + dx;
          if (nx < 0 || nx >= w) { min = 0; break outer; }
          const v = mask[ny * w + nx];
          if (v < min) { min = v; if (min === 0) break outer; }
        }
      }
      result[py * w + px] = min;
    }
  }
  return result;
}
