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
  bgColor: [number, number, number] | null; // null = auto-detect from corners
  lpi: number;       // lines per inch → drives cellSizePx via dpi/lpi
  angle: number;     // screen angle in degrees, default 22.5
  shadow: number;    // distance floor 0–1 (below = no ink), default 0
  highlight: number; // distance ceiling 0–1 (above = full ink), default 1
  gamma: number;     // midtone gamma 0.25–4.0, default 1.0
}

export const DEFAULT_V2_SETTINGS: V2Settings = {
  bgColor: null,
  lpi: 45,
  angle: 22.5,
  shadow: 0,
  highlight: 1,
  gamma: 1.0,
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

  const outData  = new Uint8ClampedArray(count * 4);
  const maskData = new Uint8ClampedArray(count * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      // BG mask visualization is always fully opaque so it previews correctly.
      maskData[i + 3] = 255;

      if (data[i + 3] < 4) {
        // Already transparent: show as dark checkerboard in the mask view.
        const c = ((x >> 3) + (y >> 3)) & 1;
        maskData[i] = maskData[i + 1] = maskData[i + 2] = c ? 60 : 40;
        continue;
      }

      // Color distance from background, normalized 0–1.
      // Uses the same normalization as the reference (/ 255, clamped to 1),
      // which means highly saturated colors can have distance up to ~1.73
      // but are clamped to 1.0 — this ensures bright artwork is always fully printed.
      const dr = data[i] - br;
      const dg = data[i + 1] - bg;
      const db = data[i + 2] - bb;
      const rawDist = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 255);

      // BG mask: near-bg pixels show as checkerboard, ink-area pixels show original color.
      const isNearBg = rawDist < 0.10;
      if (isNearBg) {
        const c = ((x >> 3) + (y >> 3)) & 1;
        maskData[i] = maskData[i + 1] = maskData[i + 2] = c ? 210 : 170;
      } else {
        maskData[i] = data[i]; maskData[i + 1] = data[i + 1]; maskData[i + 2] = data[i + 2];
      }

      // Apply levels to the distance signal.
      const u = levelsMap(rawDist, settings.shadow, settings.highlight, settings.gamma);
      if (u <= 0) continue; // pure bg pixel — leave transparent

      // Rotate pixel coordinates to screen space.
      const sx = x * cosA + y * sinA;
      const sy = -x * sinA + y * cosA;

      // Sine-wave halftone threshold oscillates 0→1 at the screen frequency.
      // The product of two shifted sines creates a smooth dot-grid pattern.
      const threshold = 0.5 * (1 + Math.sin(freq * sx) * Math.sin(freq * sy));

      // Binary halftone: original color or transparent.
      if (u > threshold) {
        outData[i]     = data[i];
        outData[i + 1] = data[i + 1];
        outData[i + 2] = data[i + 2];
        outData[i + 3] = 255;
      }
      // else: stays 0 (transparent)
    }
  }

  return {
    output: new ImageData(outData, w, h),
    bgMask: new ImageData(maskData, w, h),
    detectedBgColor,
  };
}
