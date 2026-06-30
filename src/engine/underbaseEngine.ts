import type { CmykProPlates } from './cmykProEngine';

export interface UnderbaseOptions {
  density: number;        // 0–100
  includeShadows: boolean; // kept for non-CMYK underbase path; ignored here
}

// White underbase from total CMYK ink coverage.
// White only exists where CMYK inks print; transparent areas stay 0.
export function generateCmykProUnderbase(
  plates: CmykProPlates,
  opts: UnderbaseOptions,
): Uint8Array {
  const { C, M, Y, K, width: w, height: h } = plates;
  const scale = opts.density / 100;
  const result = new Uint8Array(w * h);

  for (let i = 0; i < w * h; i++) {
    // Sum all ink channels (0–1020), cap at 255 to get 0–1 coverage
    const totalInk = Math.min(255, C[i] + M[i] + Y[i] + K[i]);
    result[i] = Math.round((totalInk / 255) * scale * 255);
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
