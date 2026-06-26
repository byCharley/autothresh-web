// Color Separation Engine — OKLAB-based perceptual color clustering.
//
// Unlike threshold mode (tonal zones) this engine groups pixels by actual
// color similarity. Dark red and light red cluster together; blues stay with
// blues; skin tones separate from neutrals. The colorPriority parameter blends
// between purely tonal separation (0) and full perceptual color separation (1).

import type { RGB } from './colorSeparation';
import type { PatternType, ProcessedLayer, LayerConfig } from './imageProcessor';
import { buildPatternValues } from './imageProcessor';

type OKLab = [number, number, number]; // L∈[0,1]  a,b≈[-0.4,0.4]

// ─── OKLAB Conversion ─────────────────────────────────────────────────────────

export function rgbToOklab(r: number, g: number, b: number): OKLab {
  const lin = (c: number) => {
    const n = c / 255;
    return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToRgb(L: number, a: number, b: number): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, ss = s_ * s_ * s_;
  const srgb = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  };
  return [
    srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * ss),
    srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * ss),
    srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * ss),
  ];
}

// Squared OKLAB distance, with chromaBoost scaling the a/b axes.
// chromaBoost=0 → tonal distance only; chromaBoost=2 → chroma 2× more important.
function oklabDist2(a: OKLab, b: OKLab, chromaBoost: number): number {
  const dL = a[0] - b[0];
  const da = (a[1] - b[1]) * chromaBoost;
  const db = (a[2] - b[2]) * chromaBoost;
  return dL * dL + da * da + db * db;
}

// ─── Cluster Quality ──────────────────────────────────────────────────────────

// Clusters covering < this fraction of pixels are dropped after initial clustering.
const MIN_FRACTION = 0.020;

// ─── K-means Core ─────────────────────────────────────────────────────────────

function runKMeansCore(
  samples: OKLab[],
  k: number,
  chromaBoost: number,
  seed: number,
  weights?: number[],
): { centers: OKLab[]; counts: number[] } {
  let rng = seed >>> 0;
  const rand = () => { rng = (Math.imul(1664525, rng) + 1013904223) >>> 0; return rng / 4294967296; };

  // k-means++ init for well-spread initial centers
  const centers: OKLab[] = [[...samples[Math.floor(rand() * samples.length)]] as OKLab];
  for (let c = 1; c < k; c++) {
    const dists = samples.map(s => {
      let min = Infinity;
      for (const ct of centers) { const d = oklabDist2(s, ct, chromaBoost); if (d < min) min = d; }
      return min;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (!total) { centers.push([...samples[c % samples.length]] as OKLab); continue; }
    let rv = rand() * total, idx = 0;
    for (; idx < dists.length - 1 && rv > 0; idx++) rv -= dists[idx];
    centers.push([...samples[idx]] as OKLab);
  }

  let counts = new Array<number>(k).fill(0);
  for (let iter = 0; iter < 40; iter++) {
    const sums: [number, number, number, number][] = Array.from({ length: centers.length }, () => [0, 0, 0, 0]);
    counts = new Array<number>(centers.length).fill(0);
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si];
      const w = weights ? weights[si] : 1;
      let minD = Infinity, nearest = 0;
      for (let c = 0; c < centers.length; c++) {
        const d = oklabDist2(s, centers[c], chromaBoost);
        if (d < minD) { minD = d; nearest = c; }
      }
      sums[nearest][0] += s[0] * w; sums[nearest][1] += s[1] * w; sums[nearest][2] += s[2] * w;
      sums[nearest][3] += w; counts[nearest]++;
    }
    let changed = false;
    for (let c = 0; c < centers.length; c++) {
      if (!counts[c]) continue;
      const wt = sums[c][3];
      const nL = sums[c][0] / wt, na = sums[c][1] / wt, nb = sums[c][2] / wt;
      if (Math.abs(nL - centers[c][0]) + Math.abs(na - centers[c][1]) + Math.abs(nb - centers[c][2]) > 1e-6) {
        centers[c] = [nL, na, nb]; changed = true;
      }
    }
    if (!changed) break;
  }

  return { centers, counts };
}

// Agglomeratively merge the two nearest clusters until we reach targetK.
// This guarantees exactly targetK maximally-spread colors.
function agglomerativeMerge(
  centers: OKLab[],
  counts: number[],
  targetK: number,
  chromaBoost: number,
): { centers: OKLab[]; counts: number[] } {
  while (centers.length > targetK) {
    let minDist = Infinity, mergeI = 0, mergeJ = 1;
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const d = oklabDist2(centers[i], centers[j], chromaBoost);
        if (d < minDist) { minDist = d; mergeI = i; mergeJ = j; }
      }
    }
    const wi = counts[mergeI], wj = counts[mergeJ], wt = wi + wj;
    centers[mergeI] = [
      (centers[mergeI][0] * wi + centers[mergeJ][0] * wj) / wt,
      (centers[mergeI][1] * wi + centers[mergeJ][1] * wj) / wt,
      (centers[mergeI][2] * wi + centers[mergeJ][2] * wj) / wt,
    ];
    counts[mergeI] = wt;
    centers.splice(mergeJ, 1);
    counts.splice(mergeJ, 1);
  }
  return { centers, counts };
}

// ─── K-means in OKLAB ─────────────────────────────────────────────────────────

// Returns cluster centres in RGB (may be fewer than k for low-sat images).
// Strategy: oversample to 4× candidates, drop tiny clusters, then agglomeratively
// merge nearest pairs to hit exactly k — guarantees maximally-spread colors.
export function kMeansOklab(
  imageData: ImageData,
  k: number,
  colorPriority: number,
  bgMask: Uint8Array | null,
  seed = 12345,
  importanceMap?: Float32Array | null,
): RGB[] {
  const { data, width, height } = imageData;
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 6000));

  const effectiveK  = k;
  const chromaBoost = colorPriority * 2;

  const samples: OKLab[] = [];
  const weights: number[] = [];
  for (let i = 0; i < n; i += step) {
    if (bgMask?.[i] === 255 || data[i * 4 + 3] < 128) continue;
    samples.push(rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]));
    weights.push(importanceMap ? 0.5 + importanceMap[i] * 1.5 : 1);
  }
  if (samples.length === 0) return [[20, 20, 20], [120, 120, 120], [220, 220, 220]].slice(0, effectiveK) as RGB[];

  // Oversample: find more candidates than needed so we have room to consolidate.
  const oversampleK = Math.min(Math.max(samples.length, 1), Math.min(90, effectiveK * 3));
  let { centers, counts } = runKMeansCore(samples, oversampleK, chromaBoost, seed, importanceMap ? weights : undefined);

  // Drop clusters that are too small to matter.
  const minCount = samples.length * MIN_FRACTION;
  for (let i = centers.length - 1; i >= 0; i--) {
    if (counts[i] < minCount && centers.length > effectiveK) {
      centers.splice(i, 1); counts.splice(i, 1);
    }
  }

  // Agglomeratively merge nearest pairs until we hit the target color count.
  if (centers.length > effectiveK) {
    ({ centers, counts } = agglomerativeMerge(centers, counts, effectiveK, chromaBoost));
  }

  centers.sort((a, b) => a[0] - b[0]); // lightest → darkest
  return centers.map(([L, a, b]) => oklabToRgb(L, a, b));
}

// ─── Main Separation Pipeline ─────────────────────────────────────────────────

export interface ColorSepSettings {
  numColors:      number;    // 2–30
  colorPriority:  number;    // 0–1: 0=tonal, 1=full color
  pattern:        PatternType;
  patternScale:   number;
  patternDensity: number;    // 0–100: 100=hard edges, lower=wider organic blend at boundaries
  patternAngle:   number;
}

// Max L-axis shift (OKLAB units) when pattern blends color zone boundaries.
// L spans 0–1; typical inter-cluster spacing is 0.15–0.25.
// At MAX_PERTURB=0.50, density=50 → perturbStrength=0.25 → a pixel a quarter of
// the way into any zone can be flipped by the pattern, creating strong organic transitions.
const MAX_PERTURB = 0.50;

function makeLayerStub(pattern: PatternType, scale: number, angle: number, density: number): LayerConfig {
  return {
    id: '_csp', name: '', color: '#000000', extraColors: undefined,
    visible: true, thresholdMin: 0, thresholdMax: 255,
    exposure: 0, blur: 0, useGlobalPattern: false,
    pattern, patternScale: scale, patternAngle: angle, patternDensity: density,
  };
}

// Run K-means on an image without the full separation pipeline.
// Used to pre-detect colors on the unadjusted image so adjustments can shift
// the cluster centers without rerunning K-means.
export function detectColorSepColors(
  imageData: ImageData,
  numColors: number,
  colorPriority: number,
  bgMask: Uint8Array | null,
  importanceMap?: Float32Array | null,
): RGB[] {
  return kMeansOklab(imageData, numColors, colorPriority, bgMask, 12345, importanceMap);
}

export function colorSeparate(
  imageData: ImageData,
  settings: ColorSepSettings,
  bgMask: Uint8Array | null,
  lockedColors?: RGB[],
  importanceMap?: Float32Array | null,
): { layers: ProcessedLayer[]; colors: RGB[] } {
  const { data, width: w, height: h } = imageData;
  const n = w * h;
  const { numColors, colorPriority, pattern, patternScale, patternDensity, patternAngle } = settings;
  const chromaBoost = colorPriority * 2;
  const usePattern = patternDensity < 100 && pattern !== 'none';

  // 1. Cluster image colors in OKLAB (or use locked palette if provided)
  const colors = (lockedColors && lockedColors.length > 0) ? lockedColors : kMeansOklab(imageData, numColors, colorPriority, bgMask, 12345, importanceMap);
  const nc = colors.length;
  const centersLab: OKLab[] = colors.map(([r, g, b]) => rgbToOklab(r, g, b));

  // 2. Build pattern values before pixel assignment so perturbation is applied during it.
  const stub = makeLayerStub(pattern, patternScale, patternAngle, patternDensity);
  const patVals = usePattern ? (buildPatternValues(w, h, stub, 0) as Float32Array | null) : null;

  // How far to nudge a pixel's effective L position before nearest-cluster lookup.
  // At density=100 or pattern=none: 0 (hard edges).
  // As density decreases: grows, widening the organic blend zone at boundaries.
  const perturbStrength = usePattern ? (1 - patternDensity / 100) * MAX_PERTURB : 0;

  // 3. Assign every pixel to nearest cluster, with pattern-driven L perturbation.
  //
  // Pixels deep inside a color zone are unaffected — the nudge can't bridge the
  // full distance to the next cluster. Only pixels near a boundary "tip" one way
  // or the other based on the pattern value, producing organic, dithered transitions
  // that blend gradients naturally instead of creating holes in solid regions.
  const assignment = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (bgMask?.[i] === 255) continue;
    if (data[i * 4 + 3] < 128) continue;
    const ri = data[i * 4], gi = data[i * 4 + 1], bi = data[i * 4 + 2];
    const lab = rgbToOklab(ri, gi, bi);
    // Perturb the L axis by the pattern value before nearest-cluster lookup.
    // Pixels deep inside a zone are unaffected; boundary pixels tip one way or
    // the other based on the pattern, creating organic shaped edges.
    const dL = patVals ? (patVals[i] - 0.5) * 2 * perturbStrength : 0;
    const labQ: OKLab = [lab[0] + dL, lab[1], lab[2]];
    let minD = Infinity, nearest = 0;
    for (let c = 0; c < nc; c++) {
      const d = oklabDist2(labQ, centersLab[c], chromaBoost);
      if (d < minD) { minD = d; nearest = c; }
    }
    assignment[i] = nearest;
  }

  // 4. Build one mask per cluster — every assigned pixel is solid ink.
  // No secondary threshold, no holes. The pattern's influence is entirely in
  // where the boundaries fall, not in whether a pixel prints at all.
  const layers: ProcessedLayer[] = colors.map(([cr, cg, cb], ci) => {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (assignment[i] === ci) mask[i] = 255;
    }
    return {
      id: `colorsep-${ci}`,
      name: `Color ${ci + 1}`,
      mask,
      color: [cr, cg, cb] as [number, number, number],
      visible: true,
    } satisfies ProcessedLayer;
  });

  return { layers, colors };
}

// ─── Composite Preview ────────────────────────────────────────────────────────

export function renderColorSepComposite(
  imageData: ImageData,
  colors: RGB[],
  visibility: Record<string, boolean>,
  settings: ColorSepSettings,
  bgMask: Uint8Array | null,
  importanceMap?: Float32Array | null,
): ImageData {
  // Pass colors as lockedColors so assignment is consistent with the displayed palette
  const { layers } = colorSeparate(imageData, { ...settings, numColors: colors.length }, bgMask, colors, importanceMap);
  return renderColorSepCompositeFromLayers(layers, colors, visibility, imageData.width, imageData.height);
}

// Fast composite from pre-computed layer masks — avoids a second colorSeparate call.
export function renderColorSepCompositeFromLayers(
  layers: ProcessedLayer[],
  colors: RGB[],
  visibility: Record<string, boolean>,
  width: number,
  height: number,
): ImageData {
  const n = width * height;
  const out = new ImageData(width, height);
  for (let ci = 0; ci < layers.length; ci++) {
    if (visibility[`colorsep-${ci}`] === false) continue;
    const [cr, cg, cb] = colors[ci];
    const { mask } = layers[ci];
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 255) continue;
      const pi = i * 4;
      out.data[pi] = cr; out.data[pi + 1] = cg; out.data[pi + 2] = cb; out.data[pi + 3] = 255;
    }
  }
  return out;
}
