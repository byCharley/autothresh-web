// ─── Types ────────────────────────────────────────────────────────────────────

export type SeparationMode = 'threshold' | 'cmyk' | 'palette' | 'vector' | 'color-sep';

export type PatternType =
  | 'none'
  | 'diffusion'
  | 'noise'
  | 'noise-coarse'
  | 'noise-texture'
  | 'grain'        // legacy alias → noise
  | 'grain-soft'   // legacy alias → noise
  | 'grain-coarse' // legacy alias → noise-coarse
  | 'halftone-round'
  | 'halftone-diamond'
  | 'halftone-ellipse'
  | 'halftone-line'
  | 'halftone-line-am'
  | 'halftone-line-fm'
  | 'halftone-crosshatch'
  | 'halftone-wave'
  | 'halftone-square'
  | 'halftone-cross'
  | 'reticulation'
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'bayer-16'
  | 'bayer-32'
  // Classic error diffusion variants
  | 'atkinson'
  | 'jarvis'
  | 'stucki'
  // Classic ordered
  | 'blue-noise'
  // Pattern tiles
  | 'grid'
  | 'checker'
  | 'hex'
  | 'hatch'
  // Artistic tiles
  | 'bytewave'
  | 'shader'
  | 'stipple'
  | 'engraving'
  | 'etching'
  | 'newspaper'
  | 'comic'
  // Atmospheric
  | 'scanline'
  | 'crt'
  // Experimental algorithmic
  | 'glitch'
  | 'pixel-sort'
  | 'voronoi'
  | 'ascii'
  | 'grain-micro';

import type { LevelsAdjustment, CurvePoint } from './adjustments';
import { buildLevelsLUT, buildCurvesLUT, DEFAULT_LEVELS, DEFAULT_CURVES } from './adjustments';
export type { LevelsAdjustment, CurvePoint };
export { DEFAULT_LEVELS, DEFAULT_CURVES };

export type AdjMode = 'basic' | 'levels' | 'curves';

export interface ImageAdjustments {
  // Basic sliders
  exposure:   number;    // -100 to 100
  contrast:   number;    // -100 to 100
  shadows:    number;    // -100 to 100
  highlights: number;    // -100 to 100
  blur:       number;    // 0–15  pre-separation blur radius
  // Levels / Curves
  adjMode:    AdjMode;
  levels:     LevelsAdjustment;
  curves:     CurvePoint[];
}

export interface PatternConfig {
  pattern: PatternType;
  patternScale: number;    // 1–40
  patternAngle: number;    // 0–180
  patternDensity: number;  // 0–100
}

export interface LayerConfig extends PatternConfig {
  id: string;
  name: string;
  color: string;
  extraColors?: string[];
  visible: boolean;
  thresholdMin: number;
  thresholdMax: number;
  exposure: number;    // -100 to 100
  blur: number;        // 0–20
  useGlobalPattern: boolean;
}

export interface ProcessedLayer {
  id: string;
  name?: string;
  mask: Uint8Array;
  color: [number, number, number];
  visible: boolean;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function applyExposure(lum: number, exposure: number): number {
  if (exposure === 0) return lum;
  return Math.min(255, Math.max(0, lum * Math.pow(2, (exposure / 100) * 3)));
}

type F32 = Float32Array<ArrayBuffer>;

export function boxBlur(src: F32, w: number, h: number, r: number): F32 {
  if (r <= 0) return src;
  const rad = Math.max(1, Math.round(r));
  const tmp = new Float32Array(w * h) as F32;
  const dst = new Float32Array(w * h) as F32;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < Math.min(rad, w); x++) sum += src[y * w + x];
    for (let x = 0; x < w; x++) {
      if (x + rad < w) sum += src[y * w + x + rad];
      if (x - rad - 1 >= 0) sum -= src[y * w + x - rad - 1];
      tmp[y * w + x] = sum / (Math.min(x + rad, w - 1) - Math.max(0, x - rad) + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < Math.min(rad, h); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + rad < h) sum += tmp[(y + rad) * w + x];
      if (y - rad - 1 >= 0) sum -= tmp[(y - rad - 1) * w + x];
      dst[y * w + x] = sum / (Math.min(y + rad, h - 1) - Math.max(0, y - rad) + 1);
    }
  }
  return dst;
}

// ─── Noise Primitives ─────────────────────────────────────────────────────────

function pseudoRandom(x: number, y: number, seed: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1234567)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

// Bilinear value noise — smooth interpolated random field, 0–1
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx); // smoothstep
  const uy = fy * fy * (3 - 2 * fy);
  const a = pseudoRandom(ix,     iy,     seed);
  const b = pseudoRandom(ix + 1, iy,     seed);
  const c = pseudoRandom(ix,     iy + 1, seed);
  const d = pseudoRandom(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// Voronoi F1/F2 ratio — 0 at each cell centre, 1 at the Voronoi boundary
function voronoiRatio(cx: number, cy: number, seed: number): number {
  const icx = Math.floor(cx), icy = Math.floor(cy);
  let f1 = Infinity, f2 = Infinity;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const ncx = icx + dx, ncy = icy + dy;
      const fpx = ncx + pseudoRandom(ncx,        ncy,        seed);
      const fpy = ncy + pseudoRandom(ncx + 9371, ncy + 4173, seed);
      const dist = Math.sqrt((cx - fpx) ** 2 + (cy - fpy) ** 2);
      if (dist < f1) { f2 = f1; f1 = dist; } else if (dist < f2) f2 = dist;
    }
  }
  return Math.min(1, f1 / Math.max(f2, 1e-6));
}

// ─── Reticulation Texture Cache ───────────────────────────────────────────────

const RET_SIZE = 1024;
let _retPx: Uint8ClampedArray | null = null;

export function preloadReticulationTexture(): Promise<void> {
  if (_retPx) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = RET_SIZE; c.height = RET_SIZE;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, RET_SIZE, RET_SIZE);
      _retPx = ctx.getImageData(0, 0, RET_SIZE, RET_SIZE).data;
      resolve();
    };
    img.onerror = () => resolve(); // fall back to procedural on load failure
    img.src = '/reticulation.png';
  });
}

// Kick off the preload as soon as this module is imported
if (typeof document !== 'undefined') {
  preloadReticulationTexture();
}


// ─── Pattern Value Generators
//     Each returns Float32Array with values in [0,1].
//     Used as luminance MODULATION — 0.5 = neutral, 0 = push dark, 1 = push bright.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Pattern Texture Cache (for image-based patterns like film grain) ─────────

const _patternTextures = new Map<string, { w: number; h: number; pixels: Float32Array }>();

export function registerPatternTexture(key: string, w: number, h: number, pixels: Float32Array): void {
  _patternTextures.set(key, { w, h, pixels });
}

function samplePatternTexture(key: string, ow: number, oh: number, scale: number, seed: number): F32 | null {
  const tex = _patternTextures.get(key);
  if (!tex) return null;
  const out = new Float32Array(ow * oh) as F32;
  const ox = ((pseudoRandom(seed, 0, 99) * tex.w) | 0);
  const oy = ((pseudoRandom(0, seed, 99) * tex.h) | 0);
  const ts = 1 / Math.max(0.1, scale);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const txf = ((x * ts + ox) % tex.w + tex.w) % tex.w;
      const tyf = ((y * ts + oy) % tex.h + tex.h) % tex.h;
      const tx0 = Math.floor(txf) | 0, ty0 = Math.floor(tyf) | 0;
      const tx1 = (tx0 + 1) % tex.w,  ty1 = (ty0 + 1) % tex.h;
      const fx = txf - tx0,            fy = tyf - ty0;
      out[y * ow + x] =
        tex.pixels[ty0 * tex.w + tx0] * (1 - fx) * (1 - fy) +
        tex.pixels[ty0 * tex.w + tx1] * fx       * (1 - fy) +
        tex.pixels[ty1 * tex.w + tx0] * (1 - fx) * fy       +
        tex.pixels[ty1 * tex.w + tx1] * fx       * fy;
    }
  }
  return out;
}

// ─── Noise Patterns ───────────────────────────────────────────────────────────

function noiseValues(w: number, h: number, scale: number, seed: number): F32 {
  // Block noise: each scale×scale region gets one seeded random value.
  // 85% block + 15% per-pixel jitter gives organic edges without grid artifacts.
  const vals = new Float32Array(w * h) as F32;
  const s = Math.max(1, Math.round(scale));
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / s);
    for (let x = 0; x < w; x++) {
      const block = pseudoRandom(Math.floor(x / s), gy, seed);
      const pixel = pseudoRandom(x, y, seed ^ 0xDEAD);
      vals[y * w + x] = block * 0.85 + pixel * 0.15;
    }
  }
  return vals;
}

function noiseCoarseValues(w: number, h: number, scale: number, seed: number): F32 {
  const noise = new Float32Array(w * h) as F32;
  const s = Math.max(1, scale);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      noise[y * w + x] = pseudoRandom(Math.floor(x / s), Math.floor(y / s), seed);
  return noise;
}

function grainMicroValues(w: number, h: number, seed: number): F32 {
  // Per-pixel Gaussian-approximated noise (average of 3 independent uniform samples).
  // The Gaussian distribution (bell-curve at 0.5) produces organic, photographic-
  // looking grain: mid-tones get the most activity, shadows/highlights stay clean.
  // This pattern intentionally ignores patternScale — the export code also skips
  // the scale multiplier so grain stays at 1px at any output resolution.
  const vals = new Float32Array(w * h) as F32;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = pseudoRandom(x,          y,          seed);
      const b = pseudoRandom(x ^ 0x1357, y ^ 0x2468, seed);
      const c = pseudoRandom(x ^ 0xFEDC, y ^ 0xBA98, seed);
      vals[y * w + x] = (a + b + c) / 3;
    }
  }
  return vals;
}

function halftoneValues(
  w: number, h: number, scale: number, angle: number, density: number,
  shape: 'round' | 'diamond' | 'ellipse' | 'line' | 'line-am' | 'line-fm' | 'crosshatch' | 'wave' | 'square' | 'cross'
): F32 {
  const vals = new Float32Array(w * h) as F32;
  const ar = (angle * Math.PI) / 180;
  const cosA = Math.cos(ar), sinA = Math.sin(ar);
  const freq = Math.max(2, scale);
  const r = (freq / 2) * (density / 100);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const rx = x * cosA + y * sinA;
      const ry = -x * sinA + y * cosA;
      const cx = ((rx % freq) + freq) % freq - freq / 2;
      const cy = ((ry % freq) + freq) % freq - freq / 2;
      let val = 0;
      switch (shape) {
        case 'round':    val = cx * cx + cy * cy <= r * r ? 1 : 0; break;
        case 'diamond':  val = Math.abs(cx) + Math.abs(cy) <= r ? 1 : 0; break;
        case 'ellipse':  val = (cx / (r * 1.5)) ** 2 + (cy / (r * 0.6)) ** 2 <= 1 ? 1 : 0; break;
        case 'square':   val = Math.max(Math.abs(cx), Math.abs(cy)) <= r ? 1 : 0; break;
        case 'cross':    val = Math.abs(cx) <= r * 0.38 || Math.abs(cy) <= r * 0.38 ? 1 : 0; break;

        // AM lines: binary line but density controls spacing — standard line screen
        case 'line':     val = Math.abs(cx) <= r * 0.45 ? 1 : 0; break;

        // AM lines (smooth): gradient within cell → luminance decides thickness continuously
        // Higher lum = thinner line, lower lum = thicker line via modulation
        case 'line-am': {
          const t = Math.abs(cx) / (freq / 2);
          val = Math.max(0, 1 - t);
          break;
        }

        // FM lines (stochastic): fixed-width stripes with phase jitter per line index
        // Creates irregular spacing that mimics FM screening
        case 'line-fm': {
          const lineIdx = Math.floor(rx / freq);
          const jitter = (pseudoRandom(lineIdx, 0, 31337) - 0.5) * freq * 0.38;
          const cxFM = ((( rx - jitter) % freq) + freq) % freq - freq / 2;
          val = Math.abs(cxFM) <= r * 0.28 ? 1 : 0;
          break;
        }

        // Crosshatch: two perpendicular line sets — AM angle and AM angle+90°
        case 'crosshatch':
          val = Math.abs(cx) <= r * 0.32 || Math.abs(cy) <= r * 0.32 ? 1 : 0;
          break;

        // Wave (sinusoidal lines): lines undulate along their length
        case 'wave': {
          const amplitude = freq * 0.28;
          const period = freq * 4.5;
          const waveOffset = amplitude * Math.sin((ry * 2 * Math.PI) / period);
          const shiftedRx = rx - waveOffset;
          const cxWave = ((shiftedRx % freq) + freq) % freq - freq / 2;
          val = Math.abs(cxWave) <= r * 0.38 ? 1 : 0;
          break;
        }
      }
      vals[y * w + x] = val;
    }
  }
  return vals;
}

// Film reticulation: layered noise pipeline mimicking damaged film emulsion.
//
// Three passes are blended:
//   1. Domain-warped Voronoi — large organic clumps (controlled by scale)
//   2. Fine grain value noise — film grain texture on top of clumps
//   3. Vertical streak noise  — subtle vertical burn/scratch marks
//
// Returns smooth 0–1 gradients so the threshold engine creates organic edges
// that grow/shrink with image luminance (dark → filled blobs, light → dots).
function reticulationValues(w: number, h: number, scale: number, density: number, seed: number): F32 {
  const vals  = new Float32Array(w * h) as F32;
  const cs    = Math.max(2, scale);                  // clump cell size in px

  // At fine scale grain dominates (feels like film grain); at large scale
  // Voronoi clumps dominate (organic blobs). Blend shifts continuously.
  const grainW  = Math.max(0.22, 0.48 - cs * 0.018) + (density / 100) * 0.10;
  // scale=2  → ~0.48   scale=4  → ~0.41   scale=12 → ~0.27   scale=20 → ~0.22

  const streakW = 0.06;
  const warp    = cs * 0.30;                         // tighter warp at fine scale
  const grainSz = Math.max(1.0, cs * 0.20);          // grain always finer than clumps

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // ── 1. Domain warp: shift clump lookup by smooth low-freq noise ──────────
      const wx = (valueNoise(x / cs * 0.8,        y / cs * 0.8,        seed + 771) - 0.5) * warp;
      const wy = (valueNoise(x / cs * 0.8 + 43.7, y / cs * 0.8 + 91.3, seed + 881) - 0.5) * warp;

      // ── 2. Voronoi clumps at warped position ─────────────────────────────────
      const clump = voronoiRatio((x + wx) / cs, (y + wy) / cs, seed);

      // ── 3. Fine grain: two-octave value noise ────────────────────────────────
      const g1 = valueNoise(x / grainSz,         y / grainSz,         seed + 1234);
      const g2 = valueNoise(x / grainSz * 2.1,   y / grainSz * 2.1,   seed + 5678) * 0.5;
      const grain = (g1 * 0.67 + g2 * 0.33);

      // ── 4. Vertical streak: coarse in X, fine in Y ───────────────────────────
      const streak = valueNoise(x / (cs * 0.6), y / (cs * 3.5), seed + 3333);

      // ── 5. Blend all layers ───────────────────────────────────────────────────
      const clumpW = 1 - grainW - streakW;
      const mixed  = clump * clumpW + grain * grainW + streak * streakW;
      vals[y * w + x] = Math.min(1, Math.max(0, mixed));
    }
  }
  return vals;
}

// ─── Bayer Ordered Dithering ──────────────────────────────────────────────────

const BAYER_2 = [0,2,3,1].map(v => v / 4);
const BAYER_4 = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v => v / 16);
const BAYER_8 = [
   0,32, 8,40, 2,34,10,42,
  48,16,56,24,50,18,58,26,
  12,44, 4,36,14,46, 6,38,
  60,28,52,20,62,30,54,22,
   3,35,11,43, 1,33, 9,41,
  51,19,59,27,49,17,57,25,
  15,47, 7,39,13,45, 5,37,
  63,31,55,23,61,29,53,21,
].map(v => v / 64);

function bayerValues(w: number, h: number, scale: number, order: 2 | 4 | 8): F32 {
  const mats: Record<number, number[]> = { 2: BAYER_2, 4: BAYER_4, 8: BAYER_8 };
  const mat = mats[order];
  const s = Math.max(1, Math.round(scale));
  const vals = new Float32Array(w * h) as F32;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      vals[y * w + x] = mat[(Math.floor(y / s) % order) * order + (Math.floor(x / s) % order)];
  return vals;
}

// ─── Floyd-Steinberg Error Diffusion ─────────────────────────────────────────

// ─── Global Image Adjustments ─────────────────────────────────────────────────

// LUT cache — rebuilt only when adj reference changes (once per reprocess, not per pixel).
let _adjRef: ImageAdjustments | null = null;
let _adjLUT: Uint8Array | null = null;

function getAdjLUT(adj: ImageAdjustments): Uint8Array | null {
  if (adj.adjMode === 'basic') return null;
  if (adj === _adjRef) return _adjLUT;
  _adjRef = adj;
  _adjLUT = adj.adjMode === 'levels'
    ? buildLevelsLUT(adj.levels ?? DEFAULT_LEVELS)
    : buildCurvesLUT(adj.curves ?? DEFAULT_CURVES);
  return _adjLUT;
}

export function applyGlobalAdjustments(lum: number, adj: ImageAdjustments): number {
  const lut = getAdjLUT(adj);
  if (lut) return lut[Math.max(0, Math.min(255, lum | 0))];
  // Basic sliders
  let l = lum;
  if (adj.exposure !== 0)    l = l * Math.pow(2, (adj.exposure / 100) * 3);
  if (adj.contrast !== 0)    l = (l - 128) * (1 + (adj.contrast / 100) * 1.5) + 128;
  if (adj.shadows !== 0) {
    const t = Math.max(0, 1 - l / 128);
    l += adj.shadows * t * 50;
  }
  if (adj.highlights !== 0) {
    const t = Math.max(0, (l - 128) / 128);
    l += adj.highlights * t * 50;
  }
  return Math.max(0, Math.min(255, l));
}

// Analyzes the luminance histogram of non-background pixels and returns
// optimal exposure + contrast to stretch the tonal range to [0, 255].
// Prevents highlight pile-up (white pixel artifacts) in dither mode without
// requiring manual slider tweaking per image.
export function autoImageAdjustments(
  imageData: ImageData,
  bgMask: Uint8Array | null,
): ImageAdjustments {
  const { data, width, height } = imageData;
  const n = width * height;

  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (bgMask && bgMask[i] === 255) continue;
    const lum = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
    hist[Math.max(0, Math.min(255, lum))]++;
    count++;
  }

  if (count < 100) return { exposure: 0, contrast: 0, shadows: 0, highlights: 0, blur: 0, adjMode: 'basic', levels: DEFAULT_LEVELS, curves: DEFAULT_CURVES };

  const p2target  = count * 0.02;
  const p98target = count * 0.98;
  let p2 = 0, p98 = 255, cumulative = 0;
  for (let v = 0; v < 256; v++) {
    cumulative += hist[v];
    if (cumulative <= p2target)  p2  = v;
    if (cumulative <= p98target) p98 = v;
  }

  // Image already has good tonal range — no adjustment needed
  if (p98 - p2 >= 220) return { exposure: 0, contrast: 0, shadows: 0, highlights: 0, blur: 0, adjMode: 'basic', levels: DEFAULT_LEVELS, curves: DEFAULT_CURVES };

  const mid = (p2 + p98) / 2;

  // Exposure: scale so the midpoint lands at 128
  const factor   = mid > 0 ? Math.max(0.5, Math.min(2, 128 / mid)) : 1;
  const exposure = Math.max(-50, Math.min(50, (Math.log2(factor) / 3) * 100));

  // Contrast: after exposure centering, stretch [p2', p98'] → [0, 255]
  const p2Adj        = p2  * factor;
  const p98Adj       = p98 * factor;
  const adjustedRange = Math.max(1, p98Adj - p2Adj);
  const S             = 255 / adjustedRange;
  const contrast      = Math.max(-50, Math.min(60, ((S - 1) / 1.5) * 100));

  return { exposure, contrast, shadows: 0, highlights: 0, blur: 0, adjMode: 'basic', levels: DEFAULT_LEVELS, curves: DEFAULT_CURVES };
}

export function buildPatternValues(w: number, h: number, layer: LayerConfig, idx: number): F32 | null {
  const { pattern, patternScale, patternAngle, patternDensity } = layer;
  const seed = idx + 1;
  switch (pattern) {
    case 'noise':
    case 'grain':
    case 'grain-soft':       return noiseValues(w, h, patternScale, seed);
    case 'noise-coarse':
    case 'grain-coarse':     return noiseCoarseValues(w, h, patternScale, seed);
    case 'noise-texture':    return samplePatternTexture('noise-texture', w, h, patternScale, seed) ?? noiseValues(w, h, patternScale, seed);
    case 'grain-micro':      return grainMicroValues(w, h, seed);
    case 'halftone-round':   return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'round');
    case 'halftone-diamond': return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'diamond');
    case 'halftone-ellipse': return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'ellipse');
    case 'halftone-line':      return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'line');
    case 'halftone-line-am':   return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'line-am');
    case 'halftone-line-fm':   return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'line-fm');
    case 'halftone-crosshatch':return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'crosshatch');
    case 'halftone-wave':      return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'wave');
    case 'halftone-square':  return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'square');
    case 'halftone-cross':   return halftoneValues(w, h, patternScale, patternAngle, patternDensity, 'cross');
    case 'reticulation':     return reticulationValues(w, h, patternScale, patternDensity, seed);
    case 'bayer-2':          return bayerValues(w, h, patternScale, 2);
    case 'bayer-4':          return bayerValues(w, h, patternScale, 4);
    case 'bayer-8':          return bayerValues(w, h, patternScale, 8);
    default:                 return null; // 'none' and 'dither-floyd' handled separately
  }
}

// ─── Auto-detect Pattern Settings ─────────────────────────────────────────────

// Pass originalImage so scale is accurate — preview is often 3× smaller than the file.
export function autoDetectPatternSettings(
  previewImage: ImageData,
  originalImage?: ImageData | null
): Partial<PatternConfig> {
  const scaleFactor = originalImage
    ? originalImage.width / previewImage.width
    : 1;
  // Target 1–2px grain clusters at original resolution; convert to preview pixels.
  const scale = Math.max(1, Math.min(6, Math.round(2 / scaleFactor)));
  return { pattern: 'grain' as PatternType, patternScale: scale, patternDensity: 50, patternAngle: 45 };
}

// ─── Palette Extraction (k-means++) ───────────────────────────────────────────

export function extractPalette(imageData: ImageData, numColors = 4): string[] {
  const { data, width, height } = imageData;
  // Downsample for speed (~1500 samples max)
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 1500)));
  const samples: [number, number, number][] = [];

  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const pi = (y * width + x) * 4;
      if (data[pi + 3] < 128) continue;
      samples.push([data[pi], data[pi + 1], data[pi + 2]]);
    }

  if (samples.length < numColors)
    return ['#0a0a0a', '#8b1a1a', '#ff6b1a', '#f5f0e8'].slice(0, numColors);

  // k-means++ initialization
  const centroids: [number, number, number][] = [];
  centroids.push([...samples[Math.floor(Math.random() * samples.length)]] as [number, number, number]);

  while (centroids.length < numColors) {
    const dists = samples.map(s => {
      let minD = Infinity;
      for (const c of centroids) {
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
        if (d < minD) minD = d;
      }
      return minD;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) { centroids.push([...samples[centroids.length]] as [number, number, number]); continue; }
    let r = Math.random() * total;
    let chosen = samples.length - 1;
    for (let i = 0; i < dists.length; i++) { r -= dists[i]; if (r <= 0) { chosen = i; break; } }
    centroids.push([...samples[chosen]] as [number, number, number]);
  }

  // k-means iterations
  for (let iter = 0; iter < 25; iter++) {
    const sums = centroids.map(() => [0, 0, 0]);
    const counts = new Array(numColors).fill(0);
    for (const s of samples) {
      let minD = Infinity, minCI = 0;
      for (let ci = 0; ci < centroids.length; ci++) {
        const c = centroids[ci];
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
        if (d < minD) { minD = d; minCI = ci; }
      }
      sums[minCI][0] += s[0]; sums[minCI][1] += s[1]; sums[minCI][2] += s[2];
      counts[minCI]++;
    }
    let moved = false;
    for (let ci = 0; ci < numColors; ci++) {
      if (counts[ci] === 0) continue;
      const nr = Math.round(sums[ci][0] / counts[ci]);
      const ng = Math.round(sums[ci][1] / counts[ci]);
      const nb = Math.round(sums[ci][2] / counts[ci]);
      if (nr !== centroids[ci][0] || ng !== centroids[ci][1] || nb !== centroids[ci][2]) {
        centroids[ci] = [nr, ng, nb]; moved = true;
      }
    }
    if (!moved) break;
  }

  centroids.sort((a, b) => getLuminance(...a) - getLuminance(...b));
  return centroids.map(([r, g, b]) =>
    '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  );
}

// ─── Background Removal ───────────────────────────────────────────────────────

export function computeBackgroundMask(imageData: ImageData, tolerance: number): Uint8Array {
  const { data, width, height } = imageData;
  const n = width * height;
  const mask = new Uint8Array(n);

  // If the image already has meaningful alpha transparency, flood-fill from
  // the edges through transparent pixels only. This removes the main background
  // (which is connected to the image border) while preserving isolated interior
  // transparent specks from anti-aliasing or texture — those are never reached
  // by the fill and stay as foreground.
  let transparentPixels = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 32) transparentPixels++;
  }
  if (transparentPixels > n * 0.005) {
    // Only flood-fill through pixels with alpha < 32 (nearly fully transparent).
    // Using < 128 was too aggressive — it followed semi-transparent chains of
    // anti-aliased or textured design pixels through narrow passages into the art.
    // The real outer background has alpha ~0 in properly-exported PNGs.
    const alphaVisited = new Uint8Array(n);
    const alphaQueue: number[] = [];
    const addAlpha = (idx: number) => {
      if (alphaVisited[idx]) return;
      alphaVisited[idx] = 1;
      if (data[idx * 4 + 3] < 32) { mask[idx] = 255; alphaQueue.push(idx); }
    };
    for (let x = 0; x < width; x++) { addAlpha(x); addAlpha((height - 1) * width + x); }
    for (let y = 1; y < height - 1; y++) { addAlpha(y * width); addAlpha(y * width + width - 1); }
    let alphaHead = 0;
    while (alphaHead < alphaQueue.length) {
      const idx = alphaQueue[alphaHead++];
      const x = idx % width, y = Math.floor(idx / width);
      if (x > 0)          addAlpha(idx - 1);
      if (x < width - 1)  addAlpha(idx + 1);
      if (y > 0)          addAlpha(idx - width);
      if (y < height - 1) addAlpha(idx + width);
    }
    return mask;
  }

  // Fallback: color-similarity flood-fill for fully opaque images (JPGs, etc.)
  const visited = new Uint8Array(n);
  const thresh = tolerance * 1.5;

  const patchSize = Math.min(3, width, height);
  const corners = [
    [0, 0], [width - patchSize, 0],
    [0, height - patchSize], [width - patchSize, height - patchSize],
  ];
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (const [ox, oy] of corners) {
    for (let py = oy; py < oy + patchSize; py++) {
      for (let px = ox; px < ox + patchSize; px++) {
        const pi = (py * width + px) * 4;
        sumR += data[pi]; sumG += data[pi + 1]; sumB += data[pi + 2]; count++;
      }
    }
  }
  const bgR = sumR / count, bgG = sumG / count, bgB = sumB / count;

  const colorDist = (pi: number) => {
    const dr = data[pi] - bgR, dg = data[pi + 1] - bgG, db = data[pi + 2] - bgB;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const queue: number[] = [];
  const add = (idx: number) => {
    if (visited[idx]) return;
    visited[idx] = 1;
    if (colorDist(idx * 4) <= thresh) { mask[idx] = 255; queue.push(idx); }
  };

  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { add(y * width); add(y * width + width - 1); }

  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % width, y = Math.floor(idx / width);
    if (x > 0)          add(idx - 1);
    if (x < width - 1)  add(idx + 1);
    if (y > 0)          add(idx - width);
    if (y < height - 1) add(idx + width);
  }
  return mask;
}

// Samples the four corners of an image to detect the dominant background color.
// Returns a hex string (e.g. "#f5f0e8").
export function detectBackgroundColor(imageData: ImageData): string {
  const { data, width, height } = imageData;
  const patchSize = Math.min(4, width, height);
  const corners = [
    [0, 0], [width - patchSize, 0],
    [0, height - patchSize], [width - patchSize, height - patchSize],
  ];
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (const [ox, oy] of corners) {
    for (let py = oy; py < oy + patchSize; py++) {
      for (let px = ox; px < ox + patchSize; px++) {
        const pi = (py * width + px) * 4;
        sumR += data[pi]; sumG += data[pi + 1]; sumB += data[pi + 2];
        count++;
      }
    }
  }
  const r = Math.round(sumR / count);
  const g = Math.round(sumG / count);
  const b = Math.round(sumB / count);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ─── Main Pipeline ─────────────────────────────────────────────────────────────

export function processImage(
  imageData: ImageData,
  layers: LayerConfig[],
  knockoutEnabled: boolean,
  bgMask?: Uint8Array | null,
  imageAdj?: ImageAdjustments | null,
  patternScaleFactor = 1,
): ProcessedLayer[] {
  const { data, width, height } = imageData;
  const n = width * height;

  // ── 1. Build globally-adjusted luminance (shared base for all layers) ────────
  let globalLums = new Float32Array(n) as F32;
  for (let i = 0; i < n; i++) {
    const pi = i * 4;
    const raw = getLuminance(data[pi], data[pi + 1], data[pi + 2]);
    globalLums[i] = imageAdj ? applyGlobalAdjustments(raw, imageAdj) : raw;
  }
  if (imageAdj && imageAdj.blur > 0) {
    globalLums = boxBlur(globalLums, width, height, imageAdj.blur * 2);
    globalLums = boxBlur(globalLums, width, height, imageAdj.blur);
  }

  const PATTERN_STRENGTH_MAX = 55;

  // Scale pattern parameters to keep visual dot/grain size consistent across
  // different canvas resolutions (e.g. zoom changes artPrevW but dots should
  // stay the same physical size).
  const scaleLayer = (l: LayerConfig): LayerConfig => {
    // grain-micro always renders at 1px regardless of output resolution —
    // skip the export scale multiplier so it stays genuinely fine at print DPI.
    if (patternScaleFactor === 1 || l.pattern === 'grain-micro') return l;
    return { ...l, patternScale: l.patternScale * patternScaleFactor };
  };

  // ── 2. One shared pattern for all global-pattern layers (continuous film overlay)
  const firstGlobal = layers.find(
    l => l.useGlobalPattern && l.visible && l.pattern !== 'none'
  );
  const sharedGlobalPat: F32 | null = firstGlobal
    ? buildPatternValues(width, height, scaleLayer(firstGlobal), 0)
    : null;

  // ── 3. Per-layer processing ───────────────────────────────────────────────────
  // Hidden layers still get their real mask so knockout boundaries are preserved
  // when a layer is toggled off. renderComposite checks layer.visible and will
  // skip hidden layers for display; only the knockout math needs the real mask.
  const results: ProcessedLayer[] = layers.map((layer, idx) => {
    // Per-layer exposure + blur on top of global adjustments
    let lums = new Float32Array(n) as F32;
    for (let i = 0; i < n; i++) lums[i] = applyExposure(globalLums[i], layer.exposure);
    if (layer.blur > 0) lums = boxBlur(lums, width, height, layer.blur * 2);

    const patVals = layer.useGlobalPattern
      ? sharedGlobalPat
      : buildPatternValues(width, height, scaleLayer(layer), idx + 1);
    const strength = (layer.patternDensity / 100) * PATTERN_STRENGTH_MAX;

    const finalMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (bgMask && bgMask[i] === 255) continue;
      const mod  = patVals ? (patVals[i] - 0.5) * 2 * strength : 0;
      const adjL = Math.max(0, Math.min(255, lums[i] + mod));
      finalMask[i] = adjL >= layer.thresholdMin && adjL <= layer.thresholdMax ? 255 : 0;
    }

    return { id: layer.id, name: layer.name, mask: finalMask, color: hexToRgb(layer.color), visible: layer.visible };
  });

  if (knockoutEnabled) {
    for (let i = 0; i < results.length - 1; i++)
      for (let j = i + 1; j < results.length; j++)
        for (let k = 0; k < n; k++)
          if (results[j].mask[k] === 255) results[i].mask[k] = 0;
  }

  return results;
}

// Upper layers knock out pixels from lower layers to prevent ink stacking.
// Call this AFTER applying paint masks so user overrides participate correctly.
export function applyKnockout(layers: ProcessedLayer[]): void {
  if (layers.length < 2) return;
  const n = layers[0].mask.length;
  // Visibility is intentionally ignored: knockout boundaries are a property of the
  // layer stack, not the preview toggle. renderComposite skips hidden layers for
  // display; their masks still participate in removing overlapping ink from layers below.
  for (let i = 0; i < layers.length - 1; i++) {
    for (let j = i + 1; j < layers.length; j++) {
      for (let k = 0; k < n; k++) {
        if (layers[j].mask[k] === 255) layers[i].mask[k] = 0;
      }
    }
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function renderComposite(
  processedLayers: ProcessedLayer[],
  width: number,
  height: number,
  transparent = false,
  bgColor = '#ffffff',
  reverseOrder = false
): ImageData {
  const out = new ImageData(width, height);
  const n = width * height;

  if (!transparent) {
    const [bgR, bgG, bgB] = hexToRgb(bgColor);
    for (let i = 0; i < n; i++) {
      const pi = i * 4;
      out.data[pi] = bgR; out.data[pi + 1] = bgG; out.data[pi + 2] = bgB; out.data[pi + 3] = 255;
    }
  }

  const paintOrder = reverseOrder ? [...processedLayers].reverse() : processedLayers;
  for (const layer of paintOrder) {
    if (!layer.visible) continue;
    const [lr, lg, lb] = layer.color;
    for (let i = 0; i < n; i++) {
      if (layer.mask[i] === 255) {
        const pi = i * 4;
        out.data[pi] = lr; out.data[pi + 1] = lg; out.data[pi + 2] = lb; out.data[pi + 3] = 255;
      }
    }
  }
  return out;
}

// ─── Registration Marks ───────────────────────────────────────────────────────

// Returns black or white depending on which contrasts better against the given hex background.
export function contrastColor(bgHex: string): '#000000' | '#ffffff' {
  const [r, g, b] = hexToRgb(bgHex);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 128 ? '#000000' : '#ffffff';
}

export function drawRegistrationMarks(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  padding: number,  // pixels from each document edge to mark center
  color = '#000000'
) {
  // Marks placed inside each corner and at top/bottom center of the document
  const markSize = Math.max(16, Math.min(60, padding * 0.65));
  const positions = [
    [padding, padding],
    [canvasW - padding, padding],
    [padding, canvasH - padding],
    [canvasW - padding, canvasH - padding],
    [canvasW / 2, padding],
    [canvasW / 2, canvasH - padding],
  ];
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, markSize / 22);
  for (const [mx, my] of positions) {
    const r = markSize / 2;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - r * 1.7, my); ctx.lineTo(mx + r * 1.7, my); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, my - r * 1.7); ctx.lineTo(mx, my + r * 1.7); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, my, r * 0.13, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ─── Scale helper ─────────────────────────────────────────────────────────────

export function scaleImageData(imageData: ImageData, maxDim: number): ImageData {
  const { width, height } = imageData;
  if (width <= maxDim && height <= maxDim) return imageData;
  const scale = maxDim / Math.max(width, height);
  const sw = Math.round(width * scale), sh = Math.round(height * scale);
  const src = document.createElement('canvas');
  src.width = width; src.height = height;
  src.getContext('2d')!.putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = sw; dst.height = sh;
  dst.getContext('2d')!.drawImage(src, 0, 0, sw, sh);
  return dst.getContext('2d')!.getImageData(0, 0, sw, sh);
}

/** Scale to exact pixel dimensions. Uses high-quality downsampling so the
 *  result matches a single-pass resize from the source (no double-blur). */
export function scaleImageDataExact(imageData: ImageData, targetW: number, targetH: number): ImageData {
  if (imageData.width === targetW && imageData.height === targetH) return imageData;
  const src = document.createElement('canvas');
  src.width = imageData.width; src.height = imageData.height;
  src.getContext('2d')!.putImageData(imageData, 0, 0);
  const dst = document.createElement('canvas');
  dst.width = targetW; dst.height = targetH;
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
}

// ─── CMYK Separation ──────────────────────────────────────────────────────────

// Standard CMYK process colors and screen angles
export const CMYK_CHANNELS = [
  { id: 'cmyk-k', name: 'K · Black',   color: [10, 10, 10]   as [number,number,number], angleDeg: 45 },
  { id: 'cmyk-c', name: 'C · Cyan',    color: [0, 174, 239]  as [number,number,number], angleDeg: 15 },
  { id: 'cmyk-m', name: 'M · Magenta', color: [236, 0, 140]  as [number,number,number], angleDeg: 75 },
  { id: 'cmyk-y', name: 'Y · Yellow',  color: [255, 242, 0]  as [number,number,number], angleDeg: 0  },
] as const;

// Industry-standard defaults: K=45°, C=15°, M=75°, Y=0°
// Y at 0° is critical — Y at 90° (only 15° from M) causes moiré that
// makes the composite appear pink/magenta-dominant.
export const DEFAULT_CMYK_ANGLES: Record<string, number> = {
  'cmyk-k': 45, 'cmyk-c': 15, 'cmyk-m': 75, 'cmyk-y': 0,
};

// ─── CMYK Quality Parameters ──────────────────────────────────────────────────

export interface CmykParams {
  // ── Auto CMYK (beginner — shown by default) ───────────────────────────────
  detail:         number; // 0–100  edge detail preservation (70)
  contrast:       number; // 0–100  tonal contrast S-curve (55)
  colorStrength:  number; // 0–100  CMY plate saturation — 0=B&W, 100=vivid (75)
  blackStrength:  number; // 0–100  K plate density / shadow weight (82)
  printStyle:     number; // 0=Soft · 50=Standard · 100=Sharp
  garmentColor:   number; // 0=White · 50=Light · 100=Dark

  // ── Advanced (hidden by default) ──────────────────────────────────────────
  gcrAmount:       number; // 0–100  gray component → K (70)
  ucrAmount:       number; // 0–100  under color removal in shadows (55)
  cyanWarmProtect: number; // 0–100  suppress C in warm/red areas (75)
  highlightProtect:number; // 0–60   ink suppression near white (25)
  yellowClean:     number; // 0–100  reduce Y in near-neutral areas (45)
  totalInkLimit:   number; // 200–400 max C+M+Y+K % (280)
  dotGain:         number; // 0–40   dot gain compensation (15)
  smoothFlat:      number; // 0–100  blur sigma scale — leave 0 to derive from printStyle
}

export const DEFAULT_CMYK_PARAMS: CmykParams = {
  detail:          70,
  contrast:        55,
  colorStrength:   75,
  blackStrength:   82,
  printStyle:      50,
  garmentColor:    0,

  gcrAmount:       70,
  ucrAmount:       55,
  cyanWarmProtect: 75,
  highlightProtect:25,
  yellowClean:     45,
  totalInkLimit:   280,
  dotGain:         15,
  smoothFlat:      0,   // 0 = derive from printStyle automatically
};

// ─── Screen-print pixel conversion ───────────────────────────────────────────
// Goal: visual reconstruction of original artwork, not mathematical CMYK accuracy.
// K carries structure (luminosity-based). CMY carry only chromatic content.
// Warm colors are protected from cyan contamination.
function convertPixelCmyk(
  r: number, g: number, b: number, p: Partial<CmykParams>,
): [c: number, m: number, y: number, k: number] {
  // ── Read params (with defaults) ──────────────────────────────────────────
  const blackStr  = (p.blackStrength   ?? 82) / 100;
  const colorStr  = (p.colorStrength   ?? 75) / 100;
  const contrast  = (p.contrast        ?? 55) / 100;
  const gcrAmt    = (p.gcrAmount       ?? 70) / 100;
  const ucrAmt    = (p.ucrAmount       ?? 55) / 100;
  const hlProt    = (p.highlightProtect?? 25) / 100;
  const yclean    = (p.yellowClean     ?? 45) / 100;
  const cyanWarm  = (p.cyanWarmProtect ?? 75) / 100;
  const tac       = (p.totalInkLimit   ?? 280) / 100;
  const style     = (p.printStyle      ?? 50) / 100;  // 0=soft … 1=sharp
  const garment   = (p.garmentColor    ?? 0)  / 100;  // 0=white … 1=dark

  // ── K plate: luminosity-based (not max-channel) ──────────────────────────
  // Luminosity follows human perception → K carries the artwork's visual weight.
  // blackStrength controls the gamma (shadow density).
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const kGamma = Math.max(0.3, 1.6 - blackStr * 1.2); // 82%→0.62, 50%→1.0, 100%→0.4
  let k = Math.pow(1 - lum, kGamma);

  // ── Ideal CMY (full pigment, before any black substitution) ─────────────
  const ci = 1 - r, mi = 1 - g, yi = 1 - b;

  // ── GCR: pull gray component into K so CMY carry only chromatic content ─
  const grayComp = Math.min(ci, mi, yi);
  const gcrShift = grayComp * gcrAmt;
  let c = Math.max(0, ci - gcrShift);
  let m = Math.max(0, mi - gcrShift);
  let y = Math.max(0, yi - gcrShift);

  // ── UCR: reduce CMY further in shadows to prevent muddy overprinting ────
  if (ucrAmt > 0 && lum < 0.4) {
    const shadowF = 1 - ucrAmt * Math.pow(Math.max(0, (0.4 - lum) / 0.4), 0.8);
    c *= shadowF; m *= shadowF; y *= shadowF;
  }

  // ── Scale CMY by color strength ──────────────────────────────────────────
  c *= colorStr; m *= colorStr; y *= colorStr;

  // ── Warm color protection: suppress C in red/gold/skin areas ────────────
  if (cyanWarm > 0) {
    const warmScore = Math.max(0, Math.min(1, (r - b) * 3));
    c *= 1 - warmScore * cyanWarm;
  }

  // ── Yellow cleanup: suppress Y in near-neutral areas ────────────────────
  if (yclean > 0) {
    const chromaSat = Math.max(ci, mi, yi) - Math.min(ci, mi, yi);
    y *= Math.min(1, chromaSat / 0.18 + (1 - yclean));
  }

  // ── Contrast: power-function S-curve on all plates ─────────────────────
  // contrast=55 (default) → slight gamma boost for punch.
  // style adds +contrast for Sharp, -contrast for Soft.
  const effectiveContrast = contrast + (style - 0.5) * 0.25;
  const cGamma = Math.max(0.3, 1.6 - effectiveContrast * 1.2);
  if (Math.abs(cGamma - 1) > 0.02) {
    k = Math.pow(Math.max(0, k), cGamma);
    c = Math.pow(Math.max(0, c), cGamma);
    m = Math.pow(Math.max(0, m), cGamma);
    y = Math.pow(Math.max(0, y), cGamma);
  }

  // ── Garment adjustment ──────────────────────────────────────────────────
  // Light garments: tighten ink budget. Dark: boost K, trim CMY.
  if (garment > 0) {
    const gf = garment; // 0=white … 1=dark
    k  = Math.min(1, k * (1 + gf * 0.3));
    c *= (1 - gf * 0.2); m *= (1 - gf * 0.2); y *= (1 - gf * 0.2);
  }

  // ── Highlight protection: ramp all channels to 0 near white ────────────
  if (hlProt > 0) {
    const thr = 1 - hlProt * 0.7;
    if (lum > thr) {
      const f = Math.max(0, 1 - (lum - thr) / Math.max(0.001, 1 - thr));
      c *= f; m *= f; y *= f; k *= f;
    }
  }

  // ── Total ink limit ──────────────────────────────────────────────────────
  const total = c + m + y + k;
  if (total > tac) { const s = tac / total; c *= s; m *= s; y *= s; k *= s; }

  return [Math.max(0, c), Math.max(0, m), Math.max(0, y), Math.max(0, k)];
}

// ─── Plate smoothing (edge-aware Gaussian) ────────────────────────────────────

function boxPassH(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const fv = src[row], lv = src[row + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[row + j];
    let ti = row, li = row, ri = row + r;
    for (let x = 0; x <= r; x++)        { val += src[ri++] - fv;        dst[ti++] = val * inv; }
    for (let x = r + 1; x < w - r; x++) { val += src[ri++] - src[li++]; dst[ti++] = val * inv; }
    for (let x = w - r; x < w; x++)     { val += lv - src[li++];        dst[ti++] = val * inv; }
  }
  return dst;
}

function boxPassV(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    const fv = src[x], lv = src[(h - 1) * w + x];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += src[j * w + x];
    let ti = x, li = x, ri = r * w + x;
    for (let y = 0; y <= r; y++)        { val += src[ri] - fv;      ri += w; dst[ti] = val * inv; ti += w; }
    for (let y = r + 1; y < h - r; y++) { val += src[ri] - src[li]; ri += w; li += w; dst[ti] = val * inv; ti += w; }
    for (let y = h - r; y < h; y++)     { val += lv - src[li];      li += w; dst[ti] = val * inv; ti += w; }
  }
  return dst;
}

// Three-pass box blur approximates Gaussian. sigma ≈ r / sqrt(3).
function blurPlate(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.round(sigma * Math.SQRT2));
  let p = src;
  for (let i = 0; i < 3; i++) { p = boxPassH(p, w, h, r); p = boxPassV(p, w, h, r); }
  return p;
}

// Sobel edge map [0,1], soft-dilated so edges protect a neighborhood of ~spreadSigma radius.
function buildEdgeMask(data: Uint8ClampedArray, w: number, h: number, spreadSigma: number): Float32Array {
  const e = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const L = (dx: number, dy: number): number => {
        const idx = ((y + dy) * w + (x + dx)) * 4;
        return (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) / 255;
      };
      const gx = L(1,-1) - L(-1,-1) + 2*(L(1,0) - L(-1,0)) + L(1,1) - L(-1,1);
      const gy = L(-1,1) - L(-1,-1) + 2*(L(0,1) - L(0,-1)) + L(1,1) - L(1,-1);
      e[y * w + x] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 3);
    }
  }
  // Spread edge signal outward, then re-saturate so the mask stays high near edges
  if (spreadSigma > 0.5) {
    const spread = blurPlate(e, w, h, spreadSigma);
    for (let i = 0; i < e.length; i++) e[i] = Math.min(1, spread[i] * 5);
  }
  return e;
}

export function cmykSeparate(
  imageData: ImageData,
  cellSize: number,
  bgMask: Uint8Array | null,
  angleOverrides?: Record<string, number>,
  scaleFactor = 1,
  params: Partial<CmykParams> = {},
): ProcessedLayer[] {
  const { width: w, height: h, data } = imageData;
  const cs = Math.max(1, cellSize * scaleFactor);

  // ── Step 1: RGB → CMYK continuous-tone plates via GCR + corrections ──────────
  const chanC = new Float32Array(w * h);
  const chanM = new Float32Array(w * h);
  const chanY = new Float32Array(w * h);
  const chanK = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const [c, m, y, k] = convertPixelCmyk(
      data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255, params,
    );
    chanC[i] = c; chanM[i] = m; chanY[i] = y; chanK[i] = k;
  }

  // ── Step 2: Edge-aware plate smoothing ───────────────────────────────────────
  // Gaussian blur removes per-pixel noise in flat tonal areas so halftone cells
  // receive stable ink densities → large regular dots, not random speckle.
  // The edge mask restores original values near high-frequency detail.
  // smoothFlat=0 means auto-derive from printStyle: Soft→3×cs, Standard→2×cs, Sharp→0.8×cs
  const styleFactor  = (params.printStyle ?? 50) / 100;
  const autoSigma    = cs * (3 - styleFactor * 2.2);  // 50→~1.9cs, 0→3cs, 100→0.8cs
  const rawSmooth    = params.smoothFlat ?? 0;
  const smoothSigma  = rawSmooth > 0 ? cs * Math.max(0.2, rawSmooth / 50) : autoSigma;
  const edgeWeight   = Math.max(0, (params.detail ?? 70) / 100);
  const em = buildEdgeMask(data, w, h, cs * 0.6);
  for (const ch of [chanK, chanC, chanM, chanY]) {
    const blurred = blurPlate(ch, w, h, smoothSigma);
    for (let i = 0; i < w * h; i++) {
      const e = em[i] * edgeWeight;
      ch[i] = e * ch[i] + (1 - e) * blurred[i];
    }
  }

  const channelData = [chanK, chanC, chanM, chanY];

  return CMYK_CHANNELS.map(({ id, name, color, angleDeg }, ci) => {
    const deg = angleOverrides?.[id] ?? angleDeg;
    const angle = deg * Math.PI / 180;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const chan = channelData[ci];
    const mask = new Uint8Array(w * h);

    for (let py = 0; py < h; py++) {
      const pyS = py * sinA, pyC = py * cosA;
      for (let px = 0; px < w; px++) {
        if (bgMask && bgMask[py * w + px] === 255) continue;

        const su = px * cosA + pyS;
        const sv = -px * sinA + pyC;

        const cellX = Math.floor(su / cs);
        const cellY = Math.floor(sv / cs);
        const cu = (cellX + 0.5) * cs;
        const cv = (cellY + 0.5) * cs;

        // Sample ink value at cell center (back-rotate to image space)
        const ix = Math.max(0, Math.min(w - 1, Math.round(cu * cosA - cv * sinA)));
        const iy = Math.max(0, Math.min(h - 1, Math.round(cu * sinA + cv * cosA)));
        const rawInk = chan[iy * w + ix];

        // Dot gain compensation: shrink nominal dot slightly so physical ink spread
        // doesn't increase coverage beyond intent. Murray-Davies approximation.
        const dg = (params.dotGain ?? 15) / 100;
        const ink = Math.max(0, rawInk - dg * rawInk * (1 - rawInk) * 4);

        // AM halftone: area coverage = ink density.
        // Below π/4 (~78.5%): growing round dot. Above: shrinking hole in solid.
        const du = su - cu, dv = sv - cv;
        const distSq = du * du + dv * dv;
        let inDot: boolean;
        if (ink <= Math.PI / 4) {
          const dotR = cs * Math.sqrt(ink / Math.PI);
          inDot = distSq <= dotR * dotR;
        } else {
          const holeR = cs * Math.sqrt((1 - ink) / Math.PI);
          inDot = distSq > holeR * holeR;
        }
        if (inDot) mask[py * w + px] = 255;
      }
    }

    return { id, name, color, visible: true, mask } as ProcessedLayer;
  });
}

export function renderCmykComposite(
  layers: ProcessedLayer[],
  w: number,
  h: number,
  bgMask?: Uint8Array | null,
): ImageData {
  const out = new ImageData(w, h);
  // Fill white paper (alpha=0 for bg-removed pixels so fabric shows through)
  for (let i = 0; i < w * h; i++) {
    out.data[i * 4] = 255; out.data[i * 4 + 1] = 255;
    out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = (bgMask && bgMask[i] === 255) ? 0 : 255;
  }
  // Subtractive ink absorption — each channel removes its complementary light
  const absorb: Record<string, [number, number, number]> = {
    'cmyk-k': [0, 0, 0],   // absorbs R+G+B
    'cmyk-c': [0, 1, 1],   // absorbs R
    'cmyk-m': [1, 0, 1],   // absorbs G
    'cmyk-y': [1, 1, 0],   // absorbs B
  };
  for (const id of ['cmyk-k', 'cmyk-c', 'cmyk-m', 'cmyk-y']) {
    const layer = layers.find(l => l.id === id);
    if (!layer || !layer.visible) continue;
    const [ar, ag, ab] = absorb[id];
    for (let i = 0; i < w * h; i++) {
      if (layer.mask[i] !== 255) continue;
      out.data[i * 4]     = Math.round(out.data[i * 4]     * ar);
      out.data[i * 4 + 1] = Math.round(out.data[i * 4 + 1] * ag);
      out.data[i * 4 + 2] = Math.round(out.data[i * 4 + 2] * ab);
    }
  }
  return out;
}

// CMYK halftone proof: dot STRUCTURE from the binary halftone masks, correct CMYK color
// per pixel. For each pixel, any channel dot present → show the CMYK-converted color at
// that pixel (= original color for in-gamut images = correct print appearance from distance).
// No dot → white paper. Produces the right colors AND visible halftone dot pattern.
export function renderCmykHalftoneProof(
  imageData: ImageData,
  layers: ProcessedLayer[],
  bgMask?: Uint8Array | null,
): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = new ImageData(w, h);
  const masks = layers.map(l => l.mask);

  for (let i = 0; i < w * h; i++) {
    if (bgMask && bgMask[i] === 255) {
      out.data[i * 4 + 3] = 0;
      continue;
    }

    let hasDot = false;
    for (const mask of masks) { if (mask[i] === 255) { hasDot = true; break; } }

    if (hasDot) {
      const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
      const k = 1 - Math.max(r, g, b);
      if (k >= 1) {
        out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 0;
      } else {
        const d = 1 - k;
        const c = (1 - r - k) / d, m = (1 - g - k) / d, y = (1 - b - k) / d;
        out.data[i * 4]     = Math.round((1 - c) * (1 - k) * 255);
        out.data[i * 4 + 1] = Math.round((1 - m) * (1 - k) * 255);
        out.data[i * 4 + 2] = Math.round((1 - y) * (1 - k) * 255);
      }
    } else {
      out.data[i * 4] = 255; out.data[i * 4 + 1] = 255; out.data[i * 4 + 2] = 255;
    }
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

// Smooth continuous-tone CMYK preview — no halftone screen, just pixel-accurate color.
// Uses the same GCR pipeline as cmykSeparate so the composite proof matches the plates.
// ─── Garment color helper ─────────────────────────────────────────────────────
// Converts the 0-100 garmentColor param to an RGB triple.
// 0=white (#ffffff), 50=light fabric (~#d0c8b4), 100=dark (#1a1a1a)
export function garmentRgbFromParam(g: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, g / 100));
  const mid: [number, number, number] = [210, 202, 180]; // warm light-fabric tone
  if (t <= 0.5) {
    const s = t * 2;
    return [
      Math.round(255 + s * (mid[0] - 255)),
      Math.round(255 + s * (mid[1] - 255)),
      Math.round(255 + s * (mid[2] - 255)),
    ];
  }
  const s = (t - 0.5) * 2;
  return [
    Math.round(mid[0] + s * (26 - mid[0])),
    Math.round(mid[1] + s * (26 - mid[1])),
    Math.round(mid[2] + s * (26 - mid[2])),
  ];
}

// ─── CMYK composite renderer ──────────────────────────────────────────────────
// Renders a continuous-tone color proof of the CMYK separation on a substrate.
// Supports white paper, light fabric, and dark garment (with underbase simulation).
// This is the authoritative composite renderer — export and preview both use it.
// Pixels where bgMask=255 are set to alpha=0 so callers can composite over substrate.
export function renderCmykSmooth(
  imageData: ImageData,
  bgMask: Uint8Array | null,
  visibility: Record<string, boolean>,
  params: Partial<CmykParams> = {},
): ImageData {
  const [gR, gG, gB] = garmentRgbFromParam(params.garmentColor ?? 0);
  const isDark = (params.garmentColor ?? 0) > 30; // needs underbase simulation

  const { width: w, height: h, data } = imageData;
  const out = new ImageData(w, h);

  for (let i = 0; i < w * h; i++) {
    if (bgMask && bgMask[i] === 255) {
      out.data[i * 4 + 3] = 0;
      continue;
    }

    const [cRaw, mRaw, yRaw, kRaw] = convertPixelCmyk(
      data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255, params,
    );

    const c = visibility['cmyk-c'] ? cRaw : 0;
    const m = visibility['cmyk-m'] ? mRaw : 0;
    const y = visibility['cmyk-y'] ? yRaw : 0;
    const k = visibility['cmyk-k'] ? kRaw : 0;

    // Base = garment color (normalized 0-1)
    let baseR = gR / 255, baseG = gG / 255, baseB = gB / 255;

    if (isDark) {
      // White underbase simulation: where ink exists, bleach the substrate toward white
      // so CMY colors have a reflective base to work against (same as plastisol printing).
      const totalInk = Math.min(1, (c + m + y + k) * 0.8);
      baseR += totalInk * (1 - baseR);
      baseG += totalInk * (1 - baseG);
      baseB += totalInk * (1 - baseB);
    }

    // Subtractive CMYK on the substrate
    out.data[i * 4]     = Math.round(baseR * (1 - c) * (1 - k) * 255);
    out.data[i * 4 + 1] = Math.round(baseG * (1 - m) * (1 - k) * 255);
    out.data[i * 4 + 2] = Math.round(baseB * (1 - y) * (1 - k) * 255);
    out.data[i * 4 + 3] = 255;
  }

  return out;
}

// ─── Visual quality score (0–100) ─────────────────────────────────────────────
// Compares the CMYK smooth proof against the original pixel-by-pixel.
// Returns a score weighted toward visual similarity (60%) + printability (40%).
export function computeCmykQuality(
  original: ImageData,
  params: Partial<CmykParams> = {},
): number {
  const { width: w, height: h, data } = original;

  let mseR = 0, mseG = 0, mseB = 0;
  let inkOverCount = 0;
  const tac = (params.totalInkLimit ?? 280) / 100;
  const n = w * h;

  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;

    const [c, m, y, k] = convertPixelCmyk(r, g, b, params);

    // Reconstruct on garment substrate (same logic as renderCmykSmooth)
    const [gR, gG, gB] = garmentRgbFromParam(params.garmentColor ?? 0);
    let baseR = gR / 255, baseG = gG / 255, baseB = gB / 255;
    if ((params.garmentColor ?? 0) > 30) {
      const ti = Math.min(1, (c + m + y + k) * 0.8);
      baseR += ti * (1 - baseR); baseG += ti * (1 - baseG); baseB += ti * (1 - baseB);
    }
    const rOut = baseR * (1 - c) * (1 - k);
    const gOut = baseG * (1 - m) * (1 - k);
    const bOut = baseB * (1 - y) * (1 - k);

    const dr = r - rOut, dg = g - gOut, dbv = b - bOut;
    mseR += dr * dr; mseG += dg * dg; mseB += dbv * dbv;

    if (c + m + y + k > tac + 0.05) inkOverCount++;
  }

  const mse = (mseR + mseG + mseB) / (3 * n);
  const psnr = mse < 1e-10 ? 50 : Math.min(50, 10 * Math.log10(1 / mse));
  const similarityScore = Math.round((psnr / 50) * 60);

  const printabilityScore = Math.round((1 - inkOverCount / Math.max(1, n)) * 40);

  return Math.max(0, Math.min(100, similarityScore + printabilityScore));
}
