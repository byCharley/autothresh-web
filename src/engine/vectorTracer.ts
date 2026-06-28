import vtracerInit, { to_svg } from 'vtracer-wasm';
import { kMeansColors, type RGB } from './colorSeparation';

export interface VectorTraceOptions {
  numColors: number;
  detail: number;    // 1 (smooth/loose) – 10 (tight/detailed)
  smooth?: number;   // 1 (max smooth) – 10 (sharpest), default 5
  inkColor?: string; // used when numColors === 1
  pathMode?: 'spline' | 'polygon';
  minSpeckle?: number; // 0–20, extra speckle suppression on top of auto-calculated filterSpeckle
}

export interface VectorTraceResult {
  svgString: string;
  colors: string[];
}

// WASM served from /public/vtracer.wasm. Pass the fetch Response directly to
// vtracerInit so it uses WebAssembly.instantiateStreaming (async, no size limit).
// initSync is avoided because Chrome blocks synchronous compilation > 4KB.
let _vtracerReady: Promise<void> | null = null;
function ensureVTracer(): Promise<void> {
  if (!_vtracerReady) {
    _vtracerReady = fetch('/vtracer.wasm')
      .then(r => {
        if (!r.ok) throw new Error(`WASM fetch failed ${r.status}`);
        return vtracerInit({ module_or_path: r });
      })
      .then(() => console.log('[VTracer] ready'))
      .catch(err => {
        console.error('[VTracer] init failed:', err);
        _vtracerReady = null;
        throw err;
      });
  }
  return _vtracerReady;
}

// ─── Auto color-count detection ───────────────────────────────────────────────

export function detectOptimalColorCount(
  imageData: ImageData,
  bgMask: Uint8Array | null,
  maxK = 12,
): number {
  const colors = kMeansColors(imageData, maxK, 12345, bgMask);
  const { data, width, height } = imageData;
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 3000));
  const pops = new Array(maxK).fill(0);

  for (let i = 0; i < n; i += step) {
    if (data[i * 4 + 3] < 128) continue;
    if (bgMask && bgMask[i] === 255) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let minD = Infinity, best = 0;
    for (let c = 0; c < colors.length; c++) {
      const dr = r - colors[c][0], dg = g - colors[c][1], db = b - colors[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < minD) { minD = d; best = c; }
    }
    pops[best]++;
  }

  const total = pops.reduce((a, b) => a + b, 0);
  if (total === 0) return 4;

  const sorted = pops.map((p, i) => ({ i, p })).sort((a, b) => b.p - a.p);
  const kept: number[] = [];

  for (const { i, p } of sorted) {
    if (p / total < 0.008) continue;
    let isDuplicate = false;
    for (const j of kept) {
      const [r1, g1, b1] = colors[i];
      const [r2, g2, b2] = colors[j];
      const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
      if (dist < 28) { isDuplicate = true; break; }
    }
    if (!isDuplicate) kept.push(i);
  }

  return Math.max(2, Math.min(maxK, kept.length));
}

// ─── Main trace function (async — WASM init required) ─────────────────────────

export async function traceImageToSVG(
  imageData: ImageData,
  options: VectorTraceOptions,
): Promise<VectorTraceResult> {
  console.log('[VTracer] starting trace', options);
  await ensureVTracer();
  console.log('[VTracer] WASM ready');

  const { numColors, detail, smooth = 5, inkColor = '#000000', pathMode = 'spline', minSpeckle = 0 } = options;

  // smooth=1 → max smooth curves; smooth=10 → sharpest / most angular
  const cornerThreshold = Math.round(90 - (smooth - 1) * 3);        // sm=1:90, sm=10:63
  const filterSpeckle   = Math.max(4, 4 + (11 - smooth) * 2) + minSpeckle * 2; // sm=1:24, sm=10:4 + extra
  const spliceThreshold = Math.round(15 + smooth * 3);               // sm=1:18, sm=10:45
  // detail=1 → loose/smooth paths; detail=10 → tight/detailed paths
  const lengthThreshold = Math.max(1.0, 8.0 - (detail - 1) * 0.7);  // d=1:8.0, d=10:1.7
  const cleanPasses     = 1 + Math.floor((10 - smooth) * 0.4);       // sm=1:4, sm=5:3, sm=10:1

  const vtBase = {
    // Field names: 'binary' matches GitHub source, 'binarymode' matches compiled WASM strings.
    // Passing both is safe — serde ignores unknown fields (no deny_unknown_fields).
    binary: false,
    binarymode: false,
    // 'mode' is a required Config field in the source: polygon | spline | pixel
    mode: pathMode,
    hierarchical: 'cutout',
    cornerThreshold,
    lengthThreshold,
    spliceThreshold,
    filterSpeckle,
    maxIterations: 20,
    colorPrecision: 6,
    layerDifference: 16,
    pathPrecision: 3,
  };

  if (numColors === 1) {
    return traceSingleColor(imageData, inkColor, vtBase);
  }

  // Per-layer binary tracing: trace each color as a separate black-on-white
  // binary image and combine the paths. This bypasses VTracer's multi-color
  // code path (binarymode: false) which panics on complex images regardless
  // of hierarchical mode setting.
  const colors      = kMeansColors(imageData, numColors, 12345, null);
  const assignments = posterizeAndClean(imageData, colors, cleanPasses);

  const { width, height } = imageData;
  const n = width * height;
  const svgInner: string[] = [];

  for (let c = 0; c < colors.length; c++) {
    const binary = new ImageData(width, height);
    for (let i = 0; i < n; i++) {
      if (assignments[i] === c) {
        // Ink pixel → black
        binary.data[i * 4 + 3] = 255;
      } else {
        // Everything else → white background
        binary.data[i * 4]     = 255;
        binary.data[i * 4 + 1] = 255;
        binary.data[i * 4 + 2] = 255;
        binary.data[i * 4 + 3] = 255;
      }
    }

    console.log('[VTracer] tracing layer', c + 1, '/', colors.length);
    let layerSvg: string;
    try {
      layerSvg = to_svg(
        new Uint8Array(binary.data.buffer),
        width,
        height,
        { ...vtBase, binary: true, binarymode: true },
      );
    } catch (err) {
      console.error('[VTracer] layer', c, 'failed, skipping:', err);
      continue;
    }

    const hex = '#' + colors[c].map(v => v.toString(16).padStart(2, '0')).join('');
    const paths = extractSvgPaths(layerSvg, hex);
    if (paths) svgInner.push(paths);
  }

  const svgString = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...svgInner,
    `</svg>`,
  ].join('\n');

  console.log('[VTracer] SVG length:', svgString.length);

  const hexColors = colors.map(([r, g, b]) =>
    '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
  );

  return { svgString, colors: hexColors };
}

// ─── SVG path extractor ───────────────────────────────────────────────────────

function extractSvgPaths(svgString: string, fillColor: string): string {
  // Strip outer <svg> wrapper
  const inner = svgString
    .replace(/^[\s\S]*?<svg[^>]*>\s*/, '')
    .replace(/\s*<\/svg>[\s\S]*$/, '');

  // Remove white background paths/rects that VTracer emits as a backdrop
  const noWhiteBg = inner
    .replace(/<path[^>]*fill="#[Ff]{6}"[^>]*\/>/g, '')
    .replace(/<path[^>]*fill="white"[^>]*\/>/g, '')
    .replace(/<rect[^>]*\/>/g, '');

  // Recolor black → actual ink color
  return noWhiteBg
    .replace(/fill="#000000"/gi, `fill="${fillColor}"`)
    .replace(/fill="black"/gi, `fill="${fillColor}"`)
    .trim();
}

// ─── Single-color binary trace ────────────────────────────────────────────────

async function traceSingleColor(
  imageData: ImageData,
  inkColor: string,
  vtBase: object,
): Promise<VectorTraceResult> {
  const { width, height } = imageData;
  const n = width * height;
  const [ir, ig, ib] = hexToRgbArr(inkColor);
  const inkLum = (0.299 * ir + 0.587 * ig + 0.114 * ib) / 255;

  // Build black-on-white binary image: ink pixels → black, rest → white
  const binary = new ImageData(width, height);
  for (let i = 0; i < n; i++) {
    if (imageData.data[i * 4 + 3] < 32) {
      binary.data[i * 4]     = 255;
      binary.data[i * 4 + 1] = 255;
      binary.data[i * 4 + 2] = 255;
      binary.data[i * 4 + 3] = 255;
      continue;
    }
    const r = imageData.data[i * 4], g = imageData.data[i * 4 + 1], b = imageData.data[i * 4 + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    // Dark ink → trace dark pixels; light ink → trace light pixels
    const isInk = inkLum < 0.5 ? lum < 0.5 : lum > 0.5;
    binary.data[i * 4]     = isInk ? 0 : 255;
    binary.data[i * 4 + 1] = isInk ? 0 : 255;
    binary.data[i * 4 + 2] = isInk ? 0 : 255;
    binary.data[i * 4 + 3] = 255;
  }

  const rawSvg = to_svg(
    new Uint8Array(binary.data.buffer),
    width,
    height,
    { ...vtBase, binary: true, binarymode: true },
  );

  const hex = '#' + [ir, ig, ib].map(v => v.toString(16).padStart(2, '0')).join('');
  // Binary mode traces black; recolor with actual ink color
  const svgString = rawSvg
    .replace(/fill="#000000"/g, `fill="${hex}"`)
    .replace(/fill="rgb\(0,0,0\)"/g, `fill="${hex}"`);

  return { svgString, colors: [hex] };
}

// ─── Posterize + mode filter ──────────────────────────────────────────────────

function posterizeAndClean(
  imageData: ImageData,
  colors: RGB[],
  passes: number,
): Uint8Array {
  const { data, width, height } = imageData;
  const n = width * height;
  const k = colors.length;

  const assignments = new Uint8Array(n);
  assignments.fill(255); // 255 = transparent

  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 32) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    let minD = Infinity, best = 0;
    for (let c = 0; c < k; c++) {
      const dr = r - colors[c][0], dg = g - colors[c][1], db = b - colors[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < minD) { minD = d; best = c; }
    }
    assignments[i] = best;
  }

  const tmp    = new Uint8Array(n);
  const counts = new Uint16Array(k);

  for (let p = 0; p < passes; p++) {
    tmp.set(assignments);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        if (assignments[idx] === 255) continue;
        counts.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const a = assignments[(y + dy) * width + (x + dx)];
            if (a < 255) counts[a]++;
          }
        }
        let max = 0, mode = assignments[idx];
        for (let c = 0; c < k; c++) {
          if (counts[c] > max) { max = counts[c]; mode = c; }
        }
        tmp[idx] = mode;
      }
    }
    assignments.set(tmp);
  }

  // Gap-fill: transparent seams between color regions → majority neighbor color
  tmp.set(assignments);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (assignments[idx] !== 255) continue;
      counts.fill(0);
      let colored = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dy && !dx) continue;
          const a = assignments[(y + dy) * width + (x + dx)];
          if (a < 255) { counts[a]++; colored++; }
        }
      }
      if (colored >= 5) {
        let max = 0, mode = 255;
        for (let c = 0; c < k; c++) {
          if (counts[c] > max) { max = counts[c]; mode = c; }
        }
        if (mode < 255) tmp[idx] = mode;
      }
    }
  }
  assignments.set(tmp);

  return assignments;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgbArr(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

