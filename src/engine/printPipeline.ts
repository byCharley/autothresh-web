// AutoThresh Print Preparation Pipeline — DTG/DTF artwork engine
//
// Philosophy: Preserve solid artwork. Replace only tonal transitions with printable
// patterns. Never visibly degrade artwork that already prints well.
//
// Pipeline:
//   Original → Coverage Map → Gradient Classification → Halftone → Composite

export type HalftoneShape =
  | 'round'
  | 'diamond'
  | 'ellipse'
  | 'square'
  | 'line'
  | 'crosshatch';

export type PipelineStage =
  | 'original'
  | 'bg-mask'
  | 'coverage-map'
  | 'gradient-map'
  | 'halftone'
  | 'final';

export interface PrintSettings {
  // Background removal (user-triggered via eyedropper)
  bgEnabled:       boolean;
  bgColor:         [number, number, number] | null;
  bgTolerance:     number;   // 0–100, default 20
  bgEdgeSoftness:  number;   // blur radius 0–10, default 1

  // Ink coverage
  shadowPoint:     number;   // input black 0–200, default 10
  highlightPoint:  number;   // input white 55–255, default 235
  midtones:        number;   // gamma 0.25–4.0, default 1.0
  softness:        number;   // pre-blur on coverage 0–10, default 2

  // Gradient analysis: alpha ≥ solidThreshold → pixel is printed solid, no halftone
  solidThreshold:  number;   // 0–255, default 240

  // Print pattern
  shape:           HalftoneShape;
  lpi:             number;   // lines per inch, default 45
  angle:           number;   // screen angle 0–180, default 22.5

  // Preview stage selector
  previewStage:    PipelineStage;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  bgEnabled:      false,
  bgColor:        null,
  bgTolerance:    20,
  bgEdgeSoftness: 1,
  shadowPoint:    10,
  highlightPoint: 235,
  midtones:       1.0,
  softness:       2,
  solidThreshold: 240,
  shape:          'round',
  lpi:            45,
  angle:          22.5,
  previewStage:   'final',
};

// Pixel classification constants
export const CLASS_SOLID        = 0;
export const CLASS_TRANSITIONAL = 1;
export const CLASS_BACKGROUND   = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function applyLevels(raw: number, shadow: number, highlight: number, gamma: number): number {
  const range = Math.max(1, highlight - shadow);
  const t = clamp((raw - shadow) / range, 0, 1);
  return Math.pow(t, 1 / Math.max(0.01, gamma));
}

function boxBlurFloat(arr: Float32Array, w: number, h: number, radius: number): void {
  if (radius <= 0) return;
  const r = Math.round(radius);
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    const psum = new Float32Array(w + 1);
    for (let x = 0; x < w; x++) psum[x + 1] = psum[x] + arr[off + x];
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      tmp[off + x] = (psum[x1] - psum[x0]) / (x1 - x0);
    }
  }
  for (let x = 0; x < w; x++) {
    const psum = new Float32Array(h + 1);
    for (let y = 0; y < h; y++) psum[y + 1] = psum[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      arr[y * w + x] = (psum[y1] - psum[y0]) / (y1 - y0);
    }
  }
}

// ── Stage 2: Background Detection ────────────────────────────────────────────

// Sample the color at a pixel coordinate (clamped to image bounds).
export function samplePixelColor(src: ImageData, x: number, y: number): [number, number, number] {
  const px = Math.max(0, Math.min(src.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(src.height - 1, Math.round(y)));
  const i = (py * src.width + px) * 4;
  return [src.data[i], src.data[i + 1], src.data[i + 2]];
}

// Flood-fill background mask from image corners + a sampled seed color.
// Returns Uint8Array where 255 = background, 0 = foreground.
export function buildBgMask(
  src: ImageData,
  seedColor: [number, number, number],
  tolerance: number,
  edgeSoftness: number,
): Uint8Array {
  const { width: w, height: h, data } = src;
  const mask = new Uint8Array(w * h);
  const [sr, sg, sb] = seedColor;
  const tol = tolerance * 2.55;   // 0–100 → 0–255 scale
  const tol2 = tol * tol;

  const matches = (pi: number) => {
    const dr = data[pi] - sr, dg = data[pi + 1] - sg, db = data[pi + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const queue: number[] = [];
  const enq = (x: number, y: number) => {
    const i = y * w + x;
    if (mask[i] === 0 && matches(i * 4)) { mask[i] = 255; queue.push(i); }
  };

  // Seed from all four corners + top/bottom/left/right edges
  enq(0, 0); enq(w - 1, 0); enq(0, h - 1); enq(w - 1, h - 1);
  // Sample edges for open-sided backgrounds
  for (let x = 0; x < w; x += Math.max(1, w >> 5)) { enq(x, 0); enq(x, h - 1); }
  for (let y = 0; y < h; y += Math.max(1, h >> 5)) { enq(0, y); enq(w - 1, y); }

  let head = 0;
  while (head < queue.length) {
    const ci = queue[head++];
    const cy = (ci / w) | 0, cx = ci - cy * w;
    if (cy > 0)     enq(cx, cy - 1);
    if (cy < h - 1) enq(cx, cy + 1);
    if (cx > 0)     enq(cx - 1, cy);
    if (cx < w - 1) enq(cx + 1, cy);
  }

  // Also mask fully transparent pixels regardless of color
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 4) mask[i] = 255;
  }

  if (edgeSoftness > 0) {
    const f = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) f[i] = mask[i] / 255;
    boxBlurFloat(f, w, h, Math.round(edgeSoftness * 1.5));
    for (let i = 0; i < w * h; i++) mask[i] = Math.round(f[i] * 255);
  }

  return mask;
}

// ── Stage 3: Coverage Map ─────────────────────────────────────────────────────

// Per-pixel ink coverage (0–1) driven by the alpha channel.
// Opaque ink areas → coverage 1.0 (full dot). Transparent → 0 (no dot).
// Semi-transparent gradient edges get proportionally sized dots.
// Background removal (eyedropper / bgMask) is what excludes unwanted areas —
// run that first, then this function sizes dots purely from what's left.
export function buildCoverageMap(
  src: ImageData,
  shadowPoint: number,
  highlightPoint: number,
  midtones: number,
  softness: number,
): Float32Array {
  const { width: w, height: h, data } = src;
  const coverage = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) coverage[i] = data[i * 4 + 3]; // alpha channel

  // Pre-blur smooths feathered edges before levels — prevents dot stepping at gradient fringes
  if (softness > 0) boxBlurFloat(coverage, w, h, Math.round(softness * 1.5));

  for (let i = 0; i < w * h; i++) {
    coverage[i] = applyLevels(coverage[i], shadowPoint, highlightPoint, midtones);
  }
  return coverage;
}

// ── Stage 4: Gradient Analysis ────────────────────────────────────────────────

// Classify each pixel:
//   CLASS_SOLID (0)        — coverage ≥ solidThreshold/255, prints at full size
//   CLASS_TRANSITIONAL (1) — partial coverage, dot size scales with coverage
//   CLASS_BACKGROUND (2)   — transparent, bg-masked, or zero coverage (white/near-white)
export function classifyPixels(
  src: ImageData,
  coverageMap: Float32Array,
  bgMask: Uint8Array | null,
  solidThreshold: number,
): Uint8Array {
  const { data } = src;
  const cls = new Uint8Array(src.width * src.height);
  const solidCov = solidThreshold / 255;

  for (let i = 0; i < cls.length; i++) {
    const alpha = data[i * 4 + 3];
    const isBg = bgMask ? bgMask[i] > 128 : false;
    const cov = coverageMap[i];

    if (alpha < 4 || isBg || cov <= 0.005) {
      cls[i] = CLASS_BACKGROUND;
    } else if (cov >= solidCov) {
      cls[i] = CLASS_SOLID;
    } else {
      cls[i] = CLASS_TRANSITIONAL;
    }
  }
  return cls;
}

// ── Stage 5–8: Halftone + Composite ──────────────────────────────────────────

// Draw a single halftone dot shape into an existing canvas path.
// sx/sy are in rotated screen coordinates.
function addDotToPath(
  ctx: CanvasRenderingContext2D,
  shape: HalftoneShape,
  sx: number, sy: number,
  r: number,
  halfCell: number,
  cellSize: number,
  coverage: number,
): void {
  switch (shape) {
    case 'round':
      ctx.moveTo(sx + r, sy);
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      break;
    case 'diamond': {
      const d = r * Math.SQRT2;
      ctx.moveTo(sx, sy - d);
      ctx.lineTo(sx + d, sy);
      ctx.lineTo(sx, sy + d);
      ctx.lineTo(sx - d, sy);
      ctx.closePath();
      break;
    }
    case 'ellipse':
      ctx.moveTo(sx + r * 1.5, sy);
      ctx.ellipse(sx, sy, r * 1.5, r * 0.72, 0, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(sx - r, sy - r, r * 2, r * 2);
      break;
    case 'line': {
      const bw = halfCell * coverage * 2;
      ctx.rect(sx - bw * 0.5, sy - halfCell, bw, cellSize);
      break;
    }
    case 'crosshatch': {
      const bw = halfCell * coverage;
      ctx.rect(sx - bw * 0.5, sy - halfCell, bw, cellSize);
      ctx.rect(sx - halfCell, sy - bw * 0.5, cellSize, bw);
      break;
    }
  }
}

// Full print preparation render:
//   1. Build coverage map from alpha + levels
//   2. Classify pixels (solid / transitional / background)
//   3. Render halftone dots (Canvas 2D, GPU antialiased) for transitional areas
//   4. Composite: solid pixels pass through, transitional get halftone, background removed
export function runPrintPipeline(
  src: ImageData,
  settings: PrintSettings,
  dpi: number,
): { bgMask: Uint8Array | null; coverageMap: Float32Array; classification: Uint8Array; output: ImageData } {
  const { width: w, height: h } = src;

  // Stage 2: Background mask
  const bgMask = (settings.bgEnabled && settings.bgColor)
    ? buildBgMask(src, settings.bgColor, settings.bgTolerance, settings.bgEdgeSoftness)
    : null;

  // Stage 3: Coverage map
  const coverageMap = buildCoverageMap(
    src, settings.shadowPoint, settings.highlightPoint, settings.midtones, settings.softness,
  );

  // Stage 4: Classification
  const classification = classifyPixels(src, coverageMap, bgMask, settings.solidThreshold);

  // Stage 5: Halftone (Canvas 2D, GPU-accelerated, antialiased)
  // Minimum 6px so dots are always visible at any preview resolution
  const cellSize = Math.max(6, dpi / Math.max(1, settings.lpi));
  const halfCell = cellSize * 0.5;
  const angleRad = (settings.angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true })!;

  const cx = w / 2, cy = h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(angleRad);

  const diag = Math.sqrt(w * w + h * h);
  const span = Math.ceil(diag / 2 / cellSize) + 2;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();

  for (let row = -span; row <= span; row++) {
    for (let col = -span; col <= span; col++) {
      const sx = col * cellSize;
      const sy = row * cellSize;

      // Map cell center back to image space
      const ix = cx + sx * cosA - sy * sinA;
      const iy = cy + sx * sinA + sy * cosA;
      if (ix < -halfCell || ix > w + halfCell || iy < -halfCell || iy > h + halfCell) continue;

      // Sample coverage + check if any transitional pixels are in this cell
      const pR = Math.max(1, Math.floor(halfCell * 0.6));
      const px0 = Math.max(0, Math.round(ix) - pR);
      const px1 = Math.min(w - 1, Math.round(ix) + pR);
      const py0 = Math.max(0, Math.round(iy) - pR);
      const py1 = Math.min(h - 1, Math.round(iy) + pR);

      let sumCov = 0, n = 0, hasInk = false;
      for (let iy2 = py0; iy2 <= py1; iy2++) {
        for (let ix2 = px0; ix2 <= px1; ix2++) {
          const pi = iy2 * w + ix2;
          sumCov += coverageMap[pi];
          n++;
          if (classification[pi] !== CLASS_BACKGROUND) hasInk = true;
        }
      }
      if (!hasInk) continue;

      const coverage = n > 0 ? sumCov / n : 0;
      if (coverage <= 0) continue;

      // Always draw the actual dot shape — even at high coverage, the gaps between
      // dots define the halftone pattern visible to the user.
      const r = halfCell * Math.sqrt(coverage);
      addDotToPath(ctx, settings.shape, sx, sy, r, halfCell, cellSize, coverage);
    }
  }
  ctx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const dotMask = ctx.getImageData(0, 0, w, h);

  // Stage 6–8: Composite — all non-background pixels route through the dot mask.
  // SOLID cells already drew full rects (coverage ≥ 0.97), so dotMask alpha ≈ 255 there.
  // TRANSITIONAL cells drew sized dots, so dotMask alpha encodes partial coverage.
  // BACKGROUND pixels stay transparent.
  const outD = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (classification[i] === CLASS_BACKGROUND) continue;
    const dotAlpha = dotMask.data[i * 4 + 3];
    if (dotAlpha > 0) {
      outD[i * 4]     = src.data[i * 4];
      outD[i * 4 + 1] = src.data[i * 4 + 1];
      outD[i * 4 + 2] = src.data[i * 4 + 2];
      outD[i * 4 + 3] = dotAlpha;
    }
  }

  return {
    bgMask,
    coverageMap,
    classification,
    output: new ImageData(outD, w, h),
  };
}

// ── Stage Preview Generators ──────────────────────────────────────────────────

export function previewBgMask(src: ImageData, bgMask: Uint8Array): ImageData {
  const { width: w, height: h, data } = src;
  const outD = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = bgMask[i] / 255;
    if (t > 0.01) {
      // Checkerboard pattern for removed background
      const x = i % w, y = (i / w) | 0;
      const checker = ((x >> 3) + (y >> 3)) & 1;
      outD[i * 4]     = checker ? 200 : 160;
      outD[i * 4 + 1] = checker ? 200 : 160;
      outD[i * 4 + 2] = checker ? 200 : 160;
      outD[i * 4 + 3] = 255;
    } else {
      outD[i * 4]     = data[i * 4];
      outD[i * 4 + 1] = data[i * 4 + 1];
      outD[i * 4 + 2] = data[i * 4 + 2];
      outD[i * 4 + 3] = data[i * 4 + 3];
    }
  }
  return new ImageData(outD, w, h);
}

export function previewCoverageMap(coverageMap: Float32Array, w: number, h: number): ImageData {
  const outD = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(coverageMap[i] * 255);
    outD[i * 4] = v; outD[i * 4 + 1] = v; outD[i * 4 + 2] = v; outD[i * 4 + 3] = 255;
  }
  return new ImageData(outD, w, h);
}

export function previewGradientMap(src: ImageData, classification: Uint8Array): ImageData {
  const { width: w, height: h, data } = src;
  const outD = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    switch (classification[i]) {
      case CLASS_SOLID:
        // Green tint: solid ink area, preserverd as-is
        outD[i * 4]     = Math.round(data[i * 4] * 0.4);
        outD[i * 4 + 1] = Math.min(255, Math.round(data[i * 4 + 1] * 0.4 + 110));
        outD[i * 4 + 2] = Math.round(data[i * 4 + 2] * 0.4);
        outD[i * 4 + 3] = 255;
        break;
      case CLASS_TRANSITIONAL:
        // Amber tint: gradient area, will be halftoned
        outD[i * 4]     = Math.min(255, Math.round(data[i * 4] * 0.4 + 190));
        outD[i * 4 + 1] = Math.min(255, Math.round(data[i * 4 + 1] * 0.4 + 100));
        outD[i * 4 + 2] = Math.round(data[i * 4 + 2] * 0.3);
        outD[i * 4 + 3] = 255;
        break;
      case CLASS_BACKGROUND:
      default: break;  // transparent
    }
  }
  return new ImageData(outD, w, h);
}

// Get the preview for a given pipeline stage (original must be provided separately)
export function getStagePreview(
  src: ImageData,
  result: { bgMask: Uint8Array | null; coverageMap: Float32Array; classification: Uint8Array; output: ImageData },
  stage: PipelineStage,
): ImageData {
  switch (stage) {
    case 'original':
      return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    case 'bg-mask':
      return result.bgMask
        ? previewBgMask(src, result.bgMask)
        : new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    case 'coverage-map':
      return previewCoverageMap(result.coverageMap, src.width, src.height);
    case 'gradient-map':
      return previewGradientMap(src, result.classification);
    case 'halftone':
    case 'final':
    default:
      return result.output;
  }
}
