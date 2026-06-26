// ─── Color Match — Posterize + Dither Separation ─────────────────────────────
//
// Instead of soft IDW coverage (which creates a washed-out blend), this engine:
//   1. Divides the image into N luminosity zones (posterize)
//   2. Applies a chosen dither algorithm at zone boundaries
//   3. Each pixel belongs to EXACTLY ONE zone/ink
//   4. The dither pattern creates the artistic texture at transitions
//
// The result is a crisp, patterned, screen-print / risograph aesthetic.
// Users control the ink colors independently of the zone assignment.

import type { ProcessedLayer, PatternType, ImageAdjustments } from './imageProcessor';
import { applyGlobalAdjustments, boxBlur } from './imageProcessor';

export type RGB = [number, number, number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as RGB;
}

// ─── Color Presets ────────────────────────────────────────────────────────────
// Each preset is defined with 6 stops (dark→light). sampleK() picks evenly
// spaced stops for smaller k values so they always look correct.

// Linear interpolation between stops so any k (including k > stops.length) works.
function sampleK(all: RGB[], k: number): RGB[] {
  if (all.length === 0 || k <= 0) return [];
  if (k === 1) return [[...all[0]] as RGB];
  return Array.from({ length: k }, (_, i) => {
    const t  = (i / (k - 1)) * (all.length - 1);
    const lo = Math.floor(t);
    const hi = Math.min(lo + 1, all.length - 1);
    const f  = t - lo;
    if (lo === hi || f === 0) return [...all[lo]] as RGB;
    const [r0, g0, b0] = all[lo];
    const [r1, g1, b1] = all[hi];
    return [
      Math.round(r0 + (r1 - r0) * f),
      Math.round(g0 + (g1 - g0) * f),
      Math.round(b0 + (b1 - b0) * f),
    ] as RGB;
  });
}

const PALETTE_DATA: Record<string, { label: string; stops: RGB[] }> = {
  warm: {
    label: 'Warm',
    stops: [
      [15, 6, 4],        // near-black
      [55, 18, 8],       // dark brown
      [110, 48, 18],     // sienna
      [185, 100, 28],    // rust/gold
      [225, 175, 60],    // golden yellow
      [242, 228, 192],   // cream
    ],
  },
  blueprint: {
    label: 'Blueprint',
    stops: [
      [4, 10, 24],       // near-black navy
      [8, 38, 88],       // dark navy
      [14, 76, 148],     // royal blue
      [38, 128, 198],    // cornflower
      [128, 188, 228],   // sky
      [208, 232, 248],   // ice blue
    ],
  },
  risograph: {
    label: 'Riso',
    stops: [
      [14, 10, 14],      // near-black
      [140, 14, 28],     // deep crimson
      [18, 80, 138],     // blue
      [18, 138, 98],     // teal
      [228, 178, 18],    // yellow
      [242, 216, 168],   // pale
    ],
  },
  night: {
    label: 'Night',
    stops: [
      [4, 2, 10],        // near-black purple
      [28, 8, 58],       // dark purple
      [78, 18, 118],     // violet
      [158, 38, 148],    // magenta
      [228, 98, 178],    // pink
      [250, 220, 234],   // blush
    ],
  },
  forest: {
    label: 'Forest',
    stops: [
      [8, 12, 6],        // near-black green
      [20, 48, 18],      // dark forest
      [38, 90, 30],      // deep green
      [78, 138, 50],     // moss
      [148, 188, 90],    // sage
      [218, 232, 190],   // pale sage
    ],
  },
};

export const COLOR_PRESETS = PALETTE_DATA;

export function defaultPaletteColors(k: number, preset = 'warm'): RGB[] {
  const data = PALETTE_DATA[preset] ?? PALETTE_DATA.warm;
  return sampleK(data.stops, k);
}

// ─── Color Harmony ────────────────────────────────────────────────────────────

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else                 h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Returns 7 palette variants derived from the actual image colors (k-means base).
// All variants keep the same hues/tones as the real image, just stylistically adjusted.
// This is much better than pure color-theory harmonics which ignore image content.
export function generateHarmonicPalettes(baseColors: RGB[], _k: number): string[][] {
  if (baseColors.length === 0) return [];

  const shiftHue = (colors: RGB[], delta: number): string[] =>
    colors.map(c => {
      const [h, s, l] = rgbToHsl(c);
      return rgbToHex(hslToRgb(h + delta, s, l));
    });

  const adjustSat = (colors: RGB[], factor: number): string[] =>
    colors.map(c => {
      const [h, s, l] = rgbToHsl(c);
      return rgbToHex(hslToRgb(h, Math.max(0, Math.min(1, s * factor)), l));
    });

  const adjustContrast = (colors: RGB[], factor: number): string[] => {
    const ls = colors.map(c => rgbToHsl(c)[2]);
    const mid = ls.reduce((a, b) => a + b, 0) / ls.length;
    return colors.map(c => {
      const [h, s, l] = rgbToHsl(c);
      return rgbToHex(hslToRgb(h, s, Math.max(0.05, Math.min(0.92, mid + (l - mid) * factor))));
    });
  };

  return [
    adjustSat(baseColors, 1.6),           // Vivid — same image colors, full saturation
    adjustSat(baseColors, 0.45),          // Muted / earthy
    shiftHue(baseColors, 18),             // Warm shift
    shiftHue(baseColors, -18),            // Cool shift
    adjustContrast(baseColors, 1.7),      // High contrast — wider lightness range
    adjustContrast(baseColors, 0.4),      // Low contrast — closer tonal values
    adjustSat(baseColors, 0.08),          // Near-monochrome / desaturated
  ];
}

// ─── K-means++ (kept for potential future use) ────────────────────────────────
export function kMeansColors(
  imageData: ImageData,
  k: number,
  seed = 12345,
  bgMask: Uint8Array | null = null,
): RGB[] {
  const { data, width, height } = imageData;
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 5000));

  const samples: RGB[] = [];
  for (let i = 0; i < n; i += step) {
    if (bgMask && bgMask[i] === 255) continue;
    if (data[i * 4 + 3] < 128) continue;
    samples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  }
  if (samples.length === 0) return defaultPaletteColors(k);

  let rng = seed >>> 0;
  const rand = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng / 4294967296; };

  const centers: RGB[] = [samples[Math.floor(rand() * samples.length)]];
  for (let c = 1; c < k; c++) {
    let total = 0;
    const dists = samples.map(([r, g, b]) => {
      let minD = Infinity;
      for (const [cr, cg, cb] of centers) {
        const d = (r-cr)**2 + (g-cg)**2 + (b-cb)**2;
        if (d < minD) minD = d;
      }
      total += minD;
      return minD;
    });
    let rv = rand() * total;
    let idx = 0;
    for (; idx < dists.length - 1 && rv > 0; idx++) rv -= dists[idx];
    centers.push(samples[Math.max(0, idx)]);
  }

  for (let iter = 0; iter < 30; iter++) {
    const sums: [number, number, number, number][] = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const [r, g, b] of samples) {
      let minD = Infinity, nearest = 0;
      for (let c = 0; c < k; c++) {
        const [cr,cg,cb]=centers[c]; const d=(r-cr)**2+(g-cg)**2+(b-cb)**2;
        if (d < minD) { minD = d; nearest = c; }
      }
      sums[nearest][0]+=r; sums[nearest][1]+=g; sums[nearest][2]+=b; sums[nearest][3]++;
    }
    let changed = false;
    for (let c = 0; c < k; c++) {
      const [sr,sg,sb,cnt] = sums[c];
      if (!cnt) continue;
      const nr=Math.round(sr/cnt), ng=Math.round(sg/cnt), nb=Math.round(sb/cnt);
      if (nr!==centers[c][0]||ng!==centers[c][1]||nb!==centers[c][2]) { centers[c]=[nr,ng,nb]; changed=true; }
    }
    if (!changed) break;
  }

  return centers.sort((a, b) =>
    (0.299*a[0]+0.587*a[1]+0.114*a[2]) - (0.299*b[0]+0.587*b[1]+0.114*b[2])
  );
}

// ─── Dither Tile Builders ─────────────────────────────────────────────────────
// Each function returns a Float32Array of size S×S with values in [-0.5, 0.5].
// When added to a pixel's luminosity and quantized, the result is the zone index.

function makeBayer(order: number): Float32Array {
  const S = order;
  // Generate Bayer matrix via recursive construction
  let m = new Float32Array(1);
  m[0] = 0;
  for (let step = 1; step < S; step *= 2) {
    const next = new Float32Array(step * step * 4);
    for (let y = 0; y < step; y++) {
      for (let x = 0; x < step; x++) {
        const v = m[y * step + x] * 4;
        next[y * step * 2 + x]                     = v;
        next[y * step * 2 + x + step]               = v + 2;
        next[(y + step) * step * 2 + x]             = v + 3;
        next[(y + step) * step * 2 + x + step]      = v + 1;
      }
    }
    m = next;
  }
  const total = S * S;
  for (let i = 0; i < total; i++) m[i] = m[i] / total - 0.5;
  return m;
}

const BAYER: Record<number, Float32Array> = {};
export function getBayer(order: number): Float32Array {
  if (!BAYER[order]) BAYER[order] = makeBayer(order);
  return BAYER[order];
}

// Precompute a pseudo-random blue-noise-ish tile using LCG shuffle
function makeNoiseTile(S: number, seed: number): Float32Array {
  const n = S * S;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = i / n - 0.5;
  // Fisher-Yates shuffle with seeded LCG
  let rng = seed >>> 0;
  const rand = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng >>> 0; };
  for (let i = n - 1; i > 0; i--) {
    const j = rand() % (i + 1);
    const tmp = m[i]; m[i] = m[j]; m[j] = tmp;
  }
  return m;
}

// Returns the Bayer matrix order for Bayer patterns, 0 for everything else.
// Bayer-N tiles must be at least N×N to use the full matrix; the tile size
// passed to buildDitherTile and computeZones must reflect this.
export function bayerOrder(pattern: PatternType): number {
  if (pattern === 'bayer-2')  return 2;
  if (pattern === 'bayer-4')  return 4;
  if (pattern === 'bayer-8')  return 8;
  if (pattern === 'bayer-16') return 16;
  if (pattern === 'bayer-32') return 32;
  return 0;
}

// Build a repeating dither tile for ordered dithering.
// tileSize controls the visual scale (pixels per tile cell).
function buildDitherTile(pattern: PatternType, tileSize: number): Float32Array | null {
  const S = Math.max(2, Math.round(tileSize));

  // All Bayer patterns: caller passes S = N * cellSize, so each Bayer cell
  // spans c = S/N pixels in both axes, giving the correct visual cell size.
  const bN = bayerOrder(pattern);
  if (bN > 0) {
    const b = getBayer(bN);
    const c = Math.max(1, Math.round(S / bN)); // pixels per Bayer cell
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
      m[y*S+x] = b[(Math.floor(y / c) % bN) * bN + (Math.floor(x / c) % bN)];
    return m;
  }
  if (pattern === 'blue-noise') {
    // Bayer-4 mixed with Bayer-8 via coordinate hash — breaks up the matrix
    // regularity while keeping uniform distribution (pseudo-blue-noise)
    const b4 = getBayer(4), b8 = getBayer(8);
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = (x * 13 + y * 7) % 4, hy = (x * 3 + y * 11) % 4;
      const v4 = b4[hy * 4 + hx];
      const v8 = b8[(y % 8) * 8 + (x % 8)];
      m[y*S+x] = (v4 * 0.4 + v8 * 0.6);
    }
    return m;
  }
  if (pattern === 'halftone-round' || pattern === 'halftone-ellipse' || pattern === 'halftone-square') {
    const m = new Float32Array(S * S);
    const cx = (S - 1) / 2, cy = (S - 1) / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy) || 1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - cx, dy = y - cy;
      const d = pattern === 'halftone-square'
        ? Math.max(Math.abs(dx), Math.abs(dy)) / (S / 2)
        : Math.sqrt(dx*dx + dy*dy) / maxD;
      m[y*S+x] = Math.min(1, d) - 0.5;
    }
    return m;
  }
  if (pattern === 'halftone-diamond') {
    const m = new Float32Array(S * S);
    const cx = (S - 1) / 2, cy = (S - 1) / 2;
    const maxD = cx + cy || 1;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
      m[y*S+x] = (Math.abs(x-cx) + Math.abs(y-cy)) / maxD - 0.5;
    return m;
  }
  if (pattern === 'halftone-line' || pattern === 'halftone-line-am') {
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      const v = y / (S - 1 || 1) - 0.5;
      for (let x = 0; x < S; x++) m[y*S+x] = v;
    }
    return m;
  }
  if (pattern === 'halftone-crosshatch') {
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const vy = Math.abs(y / (S - 1 || 1) - 0.5) * 2;
      const vx = Math.abs(x / (S - 1 || 1) - 0.5) * 2;
      m[y*S+x] = Math.max(vy, vx) - 0.5;
    }
    return m;
  }
  if (pattern === 'halftone-wave') {
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wave = Math.sin((x / S) * Math.PI * 2) * 0.25;
      m[y*S+x] = (y / (S - 1 || 1) - 0.5) + wave;
    }
    return m;
  }
  if (pattern === 'halftone-cross') {
    const m = new Float32Array(S * S);
    const cx = (S - 1) / 2, cy = (S - 1) / 2;
    const arm = S / 4;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const inCross = Math.abs(x - cx) < arm || Math.abs(y - cy) < arm;
      const d = inCross
        ? Math.min(Math.abs(x - cx), Math.abs(y - cy)) / arm
        : 1;
      m[y*S+x] = d - 0.5;
    }
    return m;
  }
  if (pattern === 'reticulation') {
    return makeNoiseTile(S, 99999);
  }
  if (pattern === 'noise' || pattern === 'noise-coarse' || pattern === 'noise-texture' ||
      pattern === 'grain' || pattern === 'grain-soft' || pattern === 'grain-coarse') {
    return makeNoiseTile(S, 42);
  }
  // ── New pattern tiles ────────────────────────────────────────────────────────
  if (pattern === 'grid') {
    // Square grid — lines at cell borders
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = Math.abs(x / (S - 1) - 0.5) * 2;
      const dy = Math.abs(y / (S - 1) - 0.5) * 2;
      m[y*S+x] = Math.min(dx, dy) - 0.5;
    }
    return m;
  }
  if (pattern === 'checker') {
    // Alternating filled/empty squares
    const m = new Float32Array(S * S);
    const half = Math.max(1, Math.floor(S / 2));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      m[y*S+x] = ((Math.floor(x / half) + Math.floor(y / half)) % 2 === 0) ? -0.48 : 0.48;
    }
    return m;
  }
  if (pattern === 'hex') {
    // Hexagonal grid cells
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // Flat-top hex: stagger every other column
      const col = Math.floor(x / (S / 3));
      const rowOff = col % 2 === 0 ? 0 : S / 6;
      const fx = ((x % (S / 3)) / (S / 3)) - 0.5;
      const fy = (((y + rowOff) % (S / 2)) / (S / 2)) - 0.5;
      const hexDist = Math.max(Math.abs(fx), Math.abs(fy) + Math.abs(fx) * 0.577);
      m[y*S+x] = hexDist - 0.3;
    }
    // Normalize to [-0.5, 0.5]
    let mn = Infinity, mx2 = -Infinity;
    for (let i = 0; i < S*S; i++) { mn = Math.min(mn, m[i]); mx2 = Math.max(mx2, m[i]); }
    const rng2 = mx2 - mn || 1;
    for (let i = 0; i < S*S; i++) m[i] = (m[i] - mn) / rng2 - 0.5;
    return m;
  }
  if (pattern === 'hatch') {
    // 45-degree diagonal hatching
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
      m[y*S+x] = ((x + y) % S) / (S - 1) - 0.5;
    return m;
  }
  if (pattern === 'bytewave') {
    // Sinusoidal wave bands
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wave = Math.sin((x / S) * Math.PI * 4 + (y / S) * Math.PI * 2) * 0.25;
      m[y*S+x] = Math.max(-0.5, Math.min(0.5, (y / (S - 1) - 0.5) * 0.75 + wave));
    }
    return m;
  }
  if (pattern === 'stipple') {
    return makeNoiseTile(S, 77777);
  }
  if (pattern === 'engraving') {
    // Dense parallel horizontal lines with varying weight
    const m = new Float32Array(S * S);
    const lineH = Math.max(2, Math.floor(S / 4));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
      m[y*S+x] = (y % lineH) / (lineH - 1 || 1) - 0.5;
    return m;
  }
  if (pattern === 'etching') {
    // Fine crosshatch — thin lines both axes
    const m = new Float32Array(S * S);
    const freq = Math.max(2, Math.floor(S / 4));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const h = (y % freq) / (freq - 1 || 1);
      const v = (x % freq) / (freq - 1 || 1);
      m[y*S+x] = Math.min(h, v) - 0.5;
    }
    return m;
  }
  if (pattern === 'newspaper') {
    // Rotated 45° halftone dots (classic newspaper screen)
    const m = new Float32Array(S * S);
    const cx = (S - 1) / 2, cy = (S - 1) / 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // Rotate 45° and use round dot distance
      const rx = (x - cx + y - cy) / Math.SQRT2;
      const ry = (-(x - cx) + y - cy) / Math.SQRT2;
      const half = S * 0.4;
      const fx = rx - Math.round(rx / half) * half;
      const fy = ry - Math.round(ry / half) * half;
      m[y*S+x] = Math.sqrt(fx*fx + fy*fy) / (half * 0.85) - 0.5;
    }
    return m;
  }
  if (pattern === 'comic') {
    // Large Ben-Day dots — like newspaper but bigger, flatter
    const m = new Float32Array(S * S);
    const cx = (S - 1) / 2, cy = (S - 1) / 2;
    const r = (S / 2) * 0.72;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r;
      m[y*S+x] = Math.min(1, d) - 0.5;
    }
    return m;
  }
  if (pattern === 'shader') {
    // Multi-frequency smooth gradient noise
    const m = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const nx = x / S, ny = y / S;
      const v = Math.sin(nx * 6.28 + ny * 3.14) * 0.28
              + Math.sin(nx * 3.14 * 1.7 - ny * 6.28 * 0.8) * 0.18
              + (nx * 0.35 + ny * 0.65 - 0.5) * 0.54;
      m[y*S+x] = Math.max(-0.5, Math.min(0.5, v));
    }
    return m;
  }
  if (pattern === 'scanline') {
    // Alternating bright scan rows and dark inter-line gaps (interlaced display look)
    const m = new Float32Array(S * S);
    const rowH = Math.max(2, Math.round(S / 2));
    const scanH = Math.max(1, Math.round(rowH * 0.65));
    for (let y = 0; y < S; y++) {
      const ry = y % rowH;
      const val = ry < scanH ? -0.3 : 0.45;
      for (let x = 0; x < S; x++) m[y*S+x] = val;
    }
    return m;
  }
  if (pattern === 'crt') {
    // CRT phosphor grid: oval phosphors in raster rows, separated by clear dark scanline gaps.
    // ~40% of each row height is a hard gap; 60% holds an oval phosphor per sub-pixel column.
    const m = new Float32Array(S * S);
    const rowH  = Math.max(3, Math.round(S / 2));   // pixels per raster row
    const gapH  = Math.max(1, Math.ceil(rowH * 0.4)); // dark gap at bottom of each row
    const phH   = rowH - gapH;                        // phosphor active height
    const subW  = Math.max(2, Math.round(S / 3));     // sub-pixel column width
    for (let y = 0; y < S; y++) {
      const ry = y % rowH;
      if (ry >= phH) {
        // Hard horizontal gap — almost never prints
        for (let x = 0; x < S; x++) m[y*S+x] = 0.48;
        continue;
      }
      for (let x = 0; x < S; x++) {
        const rx = x % subW;
        const nx = subW > 1 ? (rx / (subW - 1)) * 2 - 1 : 0;  // -1..1 across sub-pixel
        const ny = phH  > 1 ? (ry / (phH - 1))  * 2 - 1 : 0;  // -1..1 down scan row
        // Oval phosphor (flatter in y)
        const dist = Math.sqrt(nx * nx * 0.5 + ny * ny);
        m[y*S+x] = Math.min(0.5, dist * 0.9 - 0.42);
      }
    }
    return m;
  }
  if (pattern === 'ascii') {
    // Render '@' character as tile
    if (typeof document !== 'undefined') {
      try {
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = 'white'; ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = 'black';
        ctx.font = `bold ${Math.max(6, S - 2)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('@', S / 2, S / 2);
        const d = ctx.getImageData(0, 0, S, S).data;
        const m = new Float32Array(S * S);
        for (let i = 0; i < S * S; i++) m[i] = (255 - d[i * 4]) / 255 - 0.5;
        return m;
      } catch (_) { /* fallback below */ }
    }
    return makeNoiseTile(S, 11111);
  }
  // Error diffusion and algorithmic patterns — handled in computeZones, not via tile
  // 'none' | 'diffusion' | 'atkinson' | 'jarvis' | 'stucki' | 'voronoi' | 'glitch' | 'pixel-sort'
  return null;
}

// ─── Zone Computation ─────────────────────────────────────────────────────────
//
// Assigns each artwork pixel to a zone index (0 = darkest, k-1 = lightest).
// Background pixels (bgMask=255) get zone = -1.
//
// Zone boundaries are at luminosity = i * (255/k).
// Dithering at boundaries: ordered dither adds a threshold offset so half the
// boundary pixels go to the lower zone and half to the upper zone.

export function computeZones(
  imageData: ImageData,
  k: number,
  bgMask: Uint8Array | null,
  pattern: PatternType,
  tileSize: number,
  imageAdj?: ImageAdjustments | null,
  density?: number,
  angle?: number,
  softness?: number,
  importanceMap?: Float32Array | null,
): Int32Array {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const zones = new Int32Array(n).fill(-1);
  const step = 255 / k;
  const dn = density != null ? density / 100 : 1;

  // Build adjusted luminosity array (shared for all dither methods)
  const buildLums = (): Float32Array => {
    let lums = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (bgMask && bgMask[i] === 255) { lums[i] = -1; continue; }
      const raw = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
      lums[i] = imageAdj ? applyGlobalAdjustments(raw, imageAdj) : raw;
    }
    if (imageAdj && imageAdj.blur > 0) {
      const bgFlags = new Uint8Array(n);
      for (let i = 0; i < n; i++) { if (lums[i] < 0) { bgFlags[i] = 1; lums[i] = 128; } }
      lums = boxBlur(lums as Float32Array<ArrayBuffer>, w, h, imageAdj.blur * 2);
      lums = boxBlur(lums as Float32Array<ArrayBuffer>, w, h, imageAdj.blur);
      for (let i = 0; i < n; i++) { if (bgFlags[i]) lums[i] = -1; }
    }
    return lums;
  };

  const isErrDiff = pattern === 'diffusion' || pattern === 'atkinson' ||
                    pattern === 'jarvis'    || pattern === 'stucki';

  if (isErrDiff) {
    const lum = buildLums();

    if (tileSize > 1) {
      // Block diffusion — coarsen to tileSize×tileSize blocks then run FS
      const S = Math.max(2, Math.round(tileSize));
      const bw = Math.ceil(w / S), bh = Math.ceil(h / S);
      const bn = bw * bh;
      const blockLum   = new Float32Array(bn).fill(-1);
      const blockCount = new Int32Array(bn);
      for (let i = 0; i < n; i++) {
        if (lum[i] < 0) continue;
        const bx2 = Math.floor((i % w) / S), by2 = Math.floor(Math.floor(i / w) / S);
        const bi = by2 * bw + bx2;
        if (blockLum[bi] < 0) blockLum[bi] = 0;
        blockLum[bi] += lum[i]; blockCount[bi]++;
      }
      for (let bi = 0; bi < bn; bi++)
        if (blockCount[bi] > 0) blockLum[bi] /= blockCount[bi];
      const blockZones = new Int32Array(bn).fill(-1);
      for (let by2 = 0; by2 < bh; by2++) {
        for (let bx2 = 0; bx2 < bw; bx2++) {
          const bi = by2 * bw + bx2;
          if (blockLum[bi] < 0) continue;
          const old = Math.max(0, Math.min(255, blockLum[bi]));
          const z   = Math.min(k - 1, Math.floor(old / step));
          const err = old - (z + 0.5) * step;
          blockZones[bi] = z;
          const spread = (nbi: number, wt: number) => {
            if (nbi >= 0 && nbi < bn && blockLum[nbi] >= 0) blockLum[nbi] += err * dn * wt;
          };
          spread(bi + 1, 7/16); spread(bi + bw - 1, 3/16);
          spread(bi + bw, 5/16); spread(bi + bw + 1, 1/16);
        }
      }
      for (let i = 0; i < n; i++) {
        if (lum[i] < 0) continue;
        const bi = Math.floor(Math.floor(i / w) / S) * bw + Math.floor((i % w) / S);
        zones[i] = blockZones[bi];
      }
    } else {
      // Full-resolution error diffusion with variant kernels
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (lum[i] < 0) continue;
          const old = Math.max(0, Math.min(255, lum[i]));
          const z   = Math.min(k - 1, Math.floor(old / step));
          const err = (old - (z + 0.5) * step) * dn;
          zones[i] = z;
          const sp = (ni: number, wt: number) => {
            if (ni >= 0 && ni < n && lum[ni] >= 0) lum[ni] += err * wt;
          };
          if (pattern === 'atkinson') {
            // Atkinson: spreads only 6/8 of error — creates crisp highlights
            sp(i + 1, 1/8); sp(i + 2, 1/8);
            if (y + 1 < h) {
              if (x > 0) sp(i + w - 1, 1/8);
              sp(i + w, 1/8);
              if (x + 1 < w) sp(i + w + 1, 1/8);
            }
            if (y + 2 < h) sp(i + 2 * w, 1/8);
          } else if (pattern === 'jarvis') {
            // Jarvis-Judice-Ninke: 3-row spread
            sp(i + 1, 7/48); sp(i + 2, 5/48);
            if (y + 1 < h) {
              if (x >= 2) sp(i + w - 2, 3/48); if (x >= 1) sp(i + w - 1, 5/48);
              sp(i + w, 7/48);
              if (x + 1 < w) sp(i + w + 1, 5/48); if (x + 2 < w) sp(i + w + 2, 3/48);
            }
            if (y + 2 < h) {
              if (x >= 2) sp(i + 2*w - 2, 1/48); if (x >= 1) sp(i + 2*w - 1, 3/48);
              sp(i + 2*w, 5/48);
              if (x + 1 < w) sp(i + 2*w + 1, 3/48); if (x + 2 < w) sp(i + 2*w + 2, 1/48);
            }
          } else if (pattern === 'stucki') {
            // Stucki: similar to Jarvis with sharper weights
            sp(i + 1, 8/42); sp(i + 2, 4/42);
            if (y + 1 < h) {
              if (x >= 2) sp(i + w - 2, 2/42); if (x >= 1) sp(i + w - 1, 4/42);
              sp(i + w, 8/42);
              if (x + 1 < w) sp(i + w + 1, 4/42); if (x + 2 < w) sp(i + w + 2, 2/42);
            }
            if (y + 2 < h) {
              if (x >= 2) sp(i + 2*w - 2, 1/42); if (x >= 1) sp(i + 2*w - 1, 2/42);
              sp(i + 2*w, 4/42);
              if (x + 1 < w) sp(i + 2*w + 1, 2/42); if (x + 2 < w) sp(i + 2*w + 2, 1/42);
            }
          } else {
            // Floyd-Steinberg
            sp(i + 1, 7/16); sp(i + w - 1, 3/16);
            sp(i + w, 5/16); sp(i + w + 1, 1/16);
          }
        }
      }
    }
  } else if (pattern === 'none') {
    const lum = buildLums();
    for (let i = 0; i < n; i++) {
      if (lum[i] < 0) continue;
      zones[i] = Math.min(k - 1, Math.floor(Math.max(0, Math.min(255, lum[i])) / step));
    }
  } else if (pattern === 'voronoi') {
    // Grid-seeded Voronoi — each cell gets the average luminance of all pixels
    // nearest to its seed, then maps that average to a zone
    const lum = buildLums();
    const S = Math.max(4, Math.round(tileSize));
    const gw = Math.ceil(w / S), gh = Math.ceil(h / S);
    let rng = 54321;
    const rand = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return (rng >>> 0) / 4294967296; };
    const seedX = new Float32Array(gw * gh);
    const seedY = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const bi = gy * gw + gx;
        seedX[bi] = (gx + 0.15 + rand() * 0.7) * S;
        seedY[bi] = (gy + 0.15 + rand() * 0.7) * S;
      }
    }
    const cellOf = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (lum[i] < 0) continue;
      const x = i % w, y = Math.floor(i / w);
      const cgx = Math.floor(x / S), cgy = Math.floor(y / S);
      let minD = Infinity, nearest = 0;
      for (let dy2 = -1; dy2 <= 1; dy2++) {
        for (let dx2 = -1; dx2 <= 1; dx2++) {
          const nx2 = Math.max(0, Math.min(gw - 1, cgx + dx2));
          const ny2 = Math.max(0, Math.min(gh - 1, cgy + dy2));
          const bi = ny2 * gw + nx2;
          const dxx = x - seedX[bi], dyy = y - seedY[bi];
          const d = dxx*dxx + dyy*dyy;
          if (d < minD) { minD = d; nearest = bi; }
        }
      }
      cellOf[i] = nearest;
    }
    const cellSum = new Float64Array(gw * gh);
    const cellCnt = new Int32Array(gw * gh);
    for (let i = 0; i < n; i++) {
      if (lum[i] < 0 || cellOf[i] < 0) continue;
      cellSum[cellOf[i]] += lum[i]; cellCnt[cellOf[i]]++;
    }
    for (let i = 0; i < n; i++) {
      if (lum[i] < 0) continue;
      const c = cellOf[i];
      if (c < 0 || cellCnt[c] === 0) continue;
      zones[i] = Math.min(k - 1, Math.floor(Math.max(0, Math.min(255, cellSum[c] / cellCnt[c])) / step));
    }
  } else if (pattern === 'glitch') {
    // Hard posterize then randomly offset some rows horizontally
    const lum = buildLums();
    for (let i = 0; i < n; i++) {
      if (lum[i] < 0) continue;
      zones[i] = Math.min(k - 1, Math.floor(Math.max(0, Math.min(255, lum[i])) / step));
    }
    const origZones = new Int32Array(zones);
    let rng2 = 0xDEADBEEF;
    const rand2 = () => { rng2 = (Math.imul(1664525, rng2) + 1013904223) >>> 0; return (rng2 >>> 0) / 4294967296; };
    for (let y = 0; y < h; y++) {
      if (rand2() > 0.3 * dn) continue;
      const shift = Math.round((rand2() * 2 - 1) * Math.max(4, tileSize) * 3);
      for (let x = 0; x < w; x++) {
        const srcX = Math.max(0, Math.min(w - 1, x - shift));
        const i = y * w + x, srcI = y * w + srcX;
        if (lum[i] >= 0 && origZones[srcI] >= 0) zones[i] = origZones[srcI];
      }
    }
  } else if (pattern === 'pixel-sort') {
    // Sort pixels by luminance within each row, then assign zones by sorted rank
    // Creates horizontal streaky sorting effect
    const lum = buildLums();
    for (let y = 0; y < h; y++) {
      const rowStart = y * w;
      const pairs: [number, number][] = [];
      for (let x = 0; x < w; x++) {
        const i = rowStart + x;
        if (lum[i] >= 0) pairs.push([lum[i], i]);
      }
      if (pairs.length === 0) continue;
      pairs.sort((a, b) => a[0] - b[0]);
      const total = pairs.length;
      pairs.forEach(([lumVal, i], rank) => {
        const sortedZ = Math.min(k - 1, Math.floor(rank * k / total));
        const normalZ = Math.min(k - 1, Math.floor(Math.max(0, Math.min(255, lumVal)) / step));
        zones[i] = dn >= 1 ? sortedZ : Math.round(sortedZ * dn + normalZ * (1 - dn));
      });
    }
  } else {
    // ── Ordered dither using pattern tile (with density + angle) ─────────────
    // Bayer-N needs a tile of at least N×N to cover the full matrix period.
    // If tileSize < N only a corner of the matrix would be accessed, making
    // all sizes above 4×4 look identical.
    const bN = bayerOrder(pattern);
    const S = bN > 0
      ? Math.max(bN, Math.max(2, Math.round(tileSize)))
      : Math.max(2, Math.round(tileSize));
    const tile = buildDitherTile(pattern, S);
    let lum = buildLums();
    // Softness: blur luminance proportional to Bayer cell size before comparison,
    // giving soft dot edges (low-pass filter + threshold effect).
    if (softness && softness > 0) {
      const cellPx = bN > 0 ? Math.max(1, Math.round(S / bN)) : Math.max(1, Math.round(S / 4));
      const blurR = Math.max(1, Math.round(cellPx * softness / 50));
      const bgFlags2 = new Uint8Array(n);
      for (let ii = 0; ii < n; ii++) { if (lum[ii] < 0) { bgFlags2[ii] = 1; lum[ii] = 128; } }
      lum = boxBlur(lum as Float32Array<ArrayBuffer>, w, h, blurR);
      for (let ii = 0; ii < n; ii++) { if (bgFlags2[ii]) lum[ii] = -1; }
    }
    if (!tile) {
      for (let i = 0; i < n; i++) {
        if (lum[i] < 0) continue;
        zones[i] = Math.min(k - 1, Math.floor(Math.max(0, Math.min(255, lum[i])) / step));
      }
      return zones;
    }
    const useAngle = angle != null && Math.abs(angle % 360) > 0.5;
    const cosA = useAngle ? Math.cos((angle! * Math.PI) / 180) : 1;
    const sinA = useAngle ? Math.sin((angle! * Math.PI) / 180) : 0;
    for (let i = 0; i < n; i++) {
      if (lum[i] < 0) continue;
      const x = i % w, y = Math.floor(i / w);
      let tx: number, ty: number;
      if (useAngle) {
        tx = Math.round(x * cosA - y * sinA);
        ty = Math.round(x * sinA + y * cosA);
      } else { tx = x; ty = y; }
      const L = Math.max(0, Math.min(255, lum[i]));
      const tileVal = tile[(((ty % S) + S) % S) * S + (((tx % S) + S) % S)];
      // Offset spans ±step (full zone width) so the pattern is visible throughout
      // ink areas, not just at zone boundaries. Previously was ±step/2 which made
      // dithering invisible in solid areas — looked like an overlay rather than
      // being baked into the separation.
      const impScale = importanceMap ? 1 - importanceMap[i] * 0.55 : 1;
      const offset = tileVal * step * 2 * dn * impScale;
      zones[i] = Math.max(0, Math.min(k - 1, Math.floor((L + offset) / step)));
    }
  }

  return zones;
}

// ─── Palette Separation ───────────────────────────────────────────────────────

export function paletteSeparate(
  imageData: ImageData,
  colors: RGB[],
  bgMask: Uint8Array | null,
  pattern: PatternType,
  patternScale: number,
  imageAdj?: ImageAdjustments | null,
  density?: number,
  angle?: number,
  softness?: number,
  importanceMap?: Float32Array | null,
): ProcessedLayer[] {
  const { width: w, height: h } = imageData;
  const k = colors.length;
  const n = w * h;

  const zones = computeZones(imageData, k, bgMask, pattern, Math.round(patternScale), imageAdj, density, angle, softness, importanceMap);

  return colors.map(([cr, cg, cb], ci) => {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = zones[i] === ci ? 255 : 0;
    return {
      id: `palette-${ci}`,
      name: `Ink ${ci + 1}`,
      mask,
      color: [cr, cg, cb] as [number, number, number],
      visible: true,
    } satisfies ProcessedLayer;
  });
}

// ─── Composite Preview ────────────────────────────────────────────────────────
// Colors each pixel with the ink color of its assigned zone.
// Hidden zones are transparent (canvas/substrate shows through). Background pixels are transparent.

export function renderPaletteComposite(
  imageData: ImageData,
  colors: RGB[],
  bgMask: Uint8Array | null,
  visibility: Record<string, boolean>,
  pattern: PatternType,
  patternScale: number,
  imageAdj?: ImageAdjustments | null,
  density?: number,
  angle?: number,
  softness?: number,
  importanceMap?: Float32Array | null,
): ImageData {
  const { width: w, height: h } = imageData;
  const k = colors.length;
  const n = w * h;

  const zones = computeZones(imageData, k, bgMask, pattern, Math.round(patternScale), imageAdj, density, angle, softness, importanceMap);

  const out = new ImageData(w, h);
  const od = out.data;

  for (let i = 0; i < n; i++) {
    const z = zones[i];
    if (z < 0) { od[i*4+3] = 0; continue; } // background = transparent

    if (visibility[`palette-${z}`] === false) {
      od[i*4+3] = 0; // hidden ink → transparent (canvas color shows through)
    } else {
      const [cr, cg, cb] = colors[z];
      od[i*4]=cr; od[i*4+1]=cg; od[i*4+2]=cb; od[i*4+3]=255;
    }
  }

  return out;
}
