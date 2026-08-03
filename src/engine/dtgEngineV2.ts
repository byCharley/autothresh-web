// DTG Engine V2 — Sine-wave screen halftone with color-distance ink coverage.
//
// How it works:
//   1. Detect background color from image corners (or use eyedropper-picked color).
//   2. Per pixel: compute Euclidean color distance from bg → ink coverage signal (0–1).
//   3. Apply levels to the signal: shadow/highlight/gamma.
//   4. Rotate pixel coordinates by the screen angle.
//   5. Compute sine-wave threshold: 0.5 * (1 + sin(freq·sx) · sin(freq·sy))
//      — this creates a smooth periodic dot grid in rotated space.
//   6. Binary alpha: coverage > threshold → print (original RGB, alpha=255)
//                   coverage ≤ threshold → transparent (alpha=0)
//
// This approach is fundamentally different from the V1 arc-cell engine:
//   V1: cell-based, alpha-driven, Canvas arc rendering.
//   V2: per-pixel, color-distance-driven, direct ImageData math.

export interface V2Settings {
  bgColor:       [number, number, number] | null; // null = auto-detect from corners
  lpi:           number;   // lines per inch → drives cellSizePx via dpi/lpi
  angle:         number;   // screen angle in degrees, default 22.5
  shadow:        number;   // distance floor 0–1 (below = no ink), default 0
  highlight:     number;   // distance ceiling 0–1 (above = full ink), default 1
  gamma:         number;   // midtone gamma 0.25–4.0, default 1.0
  alphaClip:     number;   // 0–255: pixels with alpha ≤ this are transparent (internal prefilter, default 4)
  alphaChoke:    number;   // 0–8: morphological erosion radius in pixels (pulls edge inward, helps transparent-bg PNGs)
  minBrightness: number;   // 0–1: pixels with luminance below this are skipped — removes dark fringe on solid-bg images
}

export const DEFAULT_V2_SETTINGS: V2Settings = {
  bgColor:       null,
  lpi:           45,
  angle:         22.5,
  shadow:        0,
  highlight:     1,
  gamma:         1.0,
  alphaClip:     4,
  alphaChoke:    0,
  minBrightness: 0,
};

// Sample the 4 corners to auto-detect the background color.
// Only samples opaque pixels (alpha > 128).
export function detectV2BgColor(src: ImageData): [number, number, number] {
  const { width: w, height: h, data } = src;
  const ci = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  let r = 0, g = 0, b = 0, n = 0;
  for (const c of ci) {
    if (data[c + 3] > 128) { r += data[c]; g += data[c + 1]; b += data[c + 2]; n++; }
  }
  return n > 0
    ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
    : [data[0], data[1], data[2]];
}

// Sample a single pixel — used by the eyedropper tool.
export function sampleV2Color(src: ImageData, x: number, y: number): [number, number, number] {
  const px = Math.max(0, Math.min(src.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(src.height - 1, Math.round(y)));
  const i = (py * src.width + px) * 4;
  return [src.data[i], src.data[i + 1], src.data[i + 2]];
}

function levelsMap(v: number, lo: number, hi: number, gamma: number): number {
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)));
  return Math.pow(t, 1 / Math.max(0.01, gamma));
}

export interface V2Result {
  output: ImageData;   // halftone result — transparent where bg or knocked out
  bgMask: ImageData;   // visualization: checkered = background, original color = ink area
  detectedBgColor: [number, number, number];
}

// Main halftone engine.
// cellSizePx = dpi / lpi at the current canvas resolution — caller computes this.
export function runV2Halftone(
  src: ImageData,
  settings: V2Settings,
  cellSizePx: number,
): V2Result {
  const { width: w, height: h, data } = src;
  const count = w * h;

  const detectedBgColor = settings.bgColor ?? detectV2BgColor(src);
  const [br, bg, bb] = detectedBgColor;

  const freq = (2 * Math.PI) / Math.max(1, cellSizePx);
  const rad  = (settings.angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  const alphaClipThresh = settings.alphaClip  ?? 4;
  const minBrightThresh = (settings.minBrightness ?? 0) * 255;

  // Pass 1: build a distMap — ink coverage signal (0–1) per pixel.
  // Pixels that are transparent, too dark, or indistinguishable from background get 0.
  // Semi-transparent pixels are weighted by their opacity so edge fringe fades naturally.
  const distMap = new Float32Array(count);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pidx = y * w + x;
      const i    = pidx * 4;
      const a    = data[i + 3];
      if (a <= alphaClipThresh) continue;                              // transparent
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < minBrightThresh) continue;                             // too dark
      const dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb;
      const rawDist = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 255);
      distMap[pidx] = rawDist * (a / 255);                            // alpha-weighted coverage
    }
  }

  // Edge Choke: separable min filter on the distMap.
  // Background/transparent pixels have distMap=0. The min filter propagates those zeros
  // inward by chokeRadius pixels, eating away the design edge — works for both
  // transparent-bg PNGs AND solid-bg images (bg pixels always have rawDist≈0).
  const chokeRadius = Math.round(settings.alphaChoke ?? 0);
  if (chokeRadius > 0) {
    const tmp = new Float32Array(count);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) {
        let m = 1;
        const x0 = Math.max(0, x - chokeRadius), x1 = Math.min(w - 1, x + chokeRadius);
        for (let dx = x0; dx <= x1; dx++) { const v = distMap[off + dx]; if (v < m) m = v; }
        tmp[off + x] = m;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let m = 1;
        const y0 = Math.max(0, y - chokeRadius), y1 = Math.min(h - 1, y + chokeRadius);
        for (let dy = y0; dy <= y1; dy++) { const v = tmp[dy * w + x]; if (v < m) m = v; }
        distMap[y * w + x] = m;
      }
    }
  }

  // Pass 2: render halftone using the pre-computed (and possibly choked) distMap.
  const outData  = new Uint8ClampedArray(count * 4);
  const maskData = new Uint8ClampedArray(count * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pidx = y * w + x;
      const i    = pidx * 4;

      maskData[i + 3] = 255;

      const a = data[i + 3];
      if (a <= alphaClipThresh) {
        const c = ((x >> 3) + (y >> 3)) & 1;
        maskData[i] = maskData[i + 1] = maskData[i + 2] = c ? 60 : 40;
        continue;
      }

      const dist = distMap[pidx];

      // BG mask visualization: near-zero dist = near-background = checkerboard
      if (dist < 0.10) {
        const c = ((x >> 3) + (y >> 3)) & 1;
        maskData[i] = maskData[i + 1] = maskData[i + 2] = c ? 210 : 170;
      } else {
        maskData[i] = data[i]; maskData[i + 1] = data[i + 1]; maskData[i + 2] = data[i + 2];
      }

      const u = levelsMap(dist, settings.shadow, settings.highlight, settings.gamma);
      if (u <= 0) continue;

      const sx = x * cosA + y * sinA;
      const sy = -x * sinA + y * cosA;
      const threshold = 0.5 * (1 + Math.sin(freq * sx) * Math.sin(freq * sy));

      if (u > threshold) {
        outData[i]     = data[i];
        outData[i + 1] = data[i + 1];
        outData[i + 2] = data[i + 2];
        outData[i + 3] = 255;
      }
    }
  }

  return {
    output: new ImageData(outData, w, h),
    bgMask: new ImageData(maskData, w, h),
    detectedBgColor,
  };
}
