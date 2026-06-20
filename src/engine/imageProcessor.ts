// ─── Types ────────────────────────────────────────────────────────────────────

export type PatternType =
  | 'none'
  | 'grain'
  | 'grain-soft'
  | 'grain-coarse'
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
  | 'bayer-8';

export interface ImageAdjustments {
  exposure: number;    // -100 to 100  overall brightness (EV)
  contrast: number;    // -100 to 100  midtone contrast
  shadows: number;     // -100 to 100  +lifts shadows, -crushes
  highlights: number;  // -100 to 100  +brightens, -recovers
  blur: number;        // 0–15         pre-separation blur radius
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
  visible: boolean;
  thresholdMin: number;
  thresholdMax: number;
  exposure: number;    // -100 to 100
  blur: number;        // 0–20
  opacity: number;     // 0–100
  useGlobalPattern: boolean;
}

export interface ProcessedLayer {
  id: string;
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

function boxBlur(src: F32, w: number, h: number, r: number): F32 {
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

function normalizeF32(arr: F32): F32 {
  let lo = arr[0], hi = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < lo) lo = arr[i]; else if (arr[i] > hi) hi = arr[i];
  }
  const span = hi - lo || 1;
  const out = new Float32Array(arr.length) as F32;
  for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - lo) / span;
  return out;
}

// ─── Pattern Value Generators
//     Each returns Float32Array with values in [0,1].
//     Used as luminance MODULATION — 0.5 = neutral, 0 = push dark, 1 = push bright.
// ─────────────────────────────────────────────────────────────────────────────

function grainValues(w: number, h: number, scale: number, seed: number): F32 {
  // Deterministic per-block noise — NO blur, NO smoothing.
  // grain[x,y] = hash(floor(x/scale), floor(y/scale), seed)
  // This matches Photoshop "Add Noise": each location gets a seeded random value,
  // and scale controls how many pixels share one value (block size).
  // scale=1 → per-pixel speckle; scale=4 → 4-px ink-dot blocks.
  // Blend 85% block + 15% per-pixel variation so blocks have organic edges.
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

function grainSoftValues(w: number, h: number, scale: number, seed: number): F32 {
  // Block noise + one blur pass for slightly rounded dot edges.
  // Visually: coarser, softer speckle — like "Add Noise + slight Gaussian" in Photoshop.
  let vals = new Float32Array(w * h) as F32;
  const s = Math.max(1, Math.round(scale));
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / s);
    for (let x = 0; x < w; x++)
      vals[y * w + x] = pseudoRandom(Math.floor(x / s), gy, seed);
  }
  vals = boxBlur(vals, w, h, Math.max(1, scale * 0.6));
  return normalizeF32(vals);
}

function grainCoarseValues(w: number, h: number, scale: number, seed: number): F32 {
  const noise = new Float32Array(w * h) as F32;
  const s = Math.max(1, scale);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      noise[y * w + x] = pseudoRandom(Math.floor(x / s), Math.floor(y / s), seed);
  return noise;
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

function reticulationValues(w: number, h: number, scale: number, density: number, seed: number): F32 {
  const vals = new Float32Array(w * h) as F32;
  const cellSize = Math.max(2, scale);
  const thresh = (1 - density / 100) * 0.55;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x / cellSize, cy = y / cellSize;
      const icx = Math.floor(cx), icy = Math.floor(cy);
      let d1 = Infinity, d2 = Infinity;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ncx = icx + dx, ncy = icy + dy;
          const fpx = ncx + pseudoRandom(ncx, ncy, seed);
          const fpy = ncy + pseudoRandom(ncx + 9371, ncy + 4173, seed);
          const dist = Math.sqrt((cx - fpx) ** 2 + (cy - fpy) ** 2);
          if (dist < d1) { d2 = d1; d1 = dist; } else if (dist < d2) { d2 = dist; }
        }
      }
      vals[y * w + x] = (d2 - d1) > thresh ? 1.0 : 0.0;
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

function applyGlobalAdjustments(lum: number, adj: ImageAdjustments): number {
  let l = lum;
  if (adj.exposure !== 0)    l = l * Math.pow(2, (adj.exposure / 100) * 3);
  if (adj.contrast !== 0)    l = (l - 128) * (1 + (adj.contrast / 100) * 1.5) + 128;
  if (adj.shadows !== 0) {
    const t = Math.max(0, 1 - l / 128); // peaks at black, zero at mid
    l += adj.shadows * t * 50;
  }
  if (adj.highlights !== 0) {
    const t = Math.max(0, (l - 128) / 128); // zero at mid, peaks at white
    l += adj.highlights * t * 50;
  }
  return Math.max(0, Math.min(255, l));
}

function buildPatternValues(w: number, h: number, layer: LayerConfig, idx: number): F32 | null {
  const { pattern, patternScale, patternAngle, patternDensity } = layer;
  const seed = idx + 1;
  switch (pattern) {
    case 'grain':            return grainValues(w, h, patternScale, seed);
    case 'grain-soft':       return grainSoftValues(w, h, patternScale, seed);
    case 'grain-coarse':     return grainCoarseValues(w, h, patternScale, seed);
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
  imageAdj?: ImageAdjustments | null
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

  // ── 2. One shared pattern for all global-pattern layers (continuous film overlay)
  const firstGlobal = layers.find(
    l => l.useGlobalPattern && l.visible && l.pattern !== 'none'
  );
  const sharedGlobalPat: F32 | null = firstGlobal
    ? buildPatternValues(width, height, firstGlobal, 0)
    : null;

  // ── 3. Per-layer processing ───────────────────────────────────────────────────
  const results: ProcessedLayer[] = layers.map((layer, idx) => {
    if (!layer.visible)
      return { id: layer.id, mask: new Uint8Array(n), color: hexToRgb(layer.color), visible: false };

    // Per-layer exposure + blur on top of global adjustments
    let lums = new Float32Array(n) as F32;
    for (let i = 0; i < n; i++) lums[i] = applyExposure(globalLums[i], layer.exposure);
    if (layer.blur > 0) lums = boxBlur(lums, width, height, layer.blur * 2);

    const patVals = layer.useGlobalPattern
      ? sharedGlobalPat
      : buildPatternValues(width, height, layer, idx + 1);
    const strength = (layer.patternDensity / 100) * PATTERN_STRENGTH_MAX;

    const finalMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (bgMask && bgMask[i] === 255) continue;
      const mod  = patVals ? (patVals[i] - 0.5) * 2 * strength : 0;
      const adjL = Math.max(0, Math.min(255, lums[i] + mod));
      finalMask[i] = adjL >= layer.thresholdMin && adjL <= layer.thresholdMax ? 255 : 0;
    }

    return { id: layer.id, mask: finalMask, color: hexToRgb(layer.color), visible: true };
  });

  if (knockoutEnabled) {
    for (let i = 0; i < results.length - 1; i++)
      for (let j = i + 1; j < results.length; j++)
        for (let k = 0; k < n; k++)
          if (results[j].mask[k] === 255) results[i].mask[k] = 0;
  }

  return results;
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
