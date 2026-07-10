export type DtgMethod =
  | 'none'
  | 'halftone-round'
  | 'halftone-diamond'
  | 'halftone-ellipse'
  | 'halftone-square'
  | 'halftone-line'
  | 'halftone-crosshatch'
  | 'bayer-4'
  | 'grain';

export interface DtgSettings {
  method:          DtgMethod;
  frequency:       number;   // lines per inch (e.g. 35)
  angle:           number;   // screen angle in degrees (e.g. 22.5)
  levelsBlack:     number;   // input black point 0–200
  levelsWhite:     number;   // input white point 55–255 (drag left to brighten)
  levelsGamma:     number;   // midtone gamma 0.25–4.0
  softness:        number;   // pre-blur radius on luminance map (0 = none, 1–20)
  despeckle:       boolean;
  despeckleRadius: number;   // neighborhood radius in pixels (1–5)
}

function samplePatch(data: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, size: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = Math.min(w - 1, x0 + dx);
      const y = Math.min(h - 1, y0 + dy);
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return [r / n, g / n, b / n];
}

export function detectDtgBgColor(img: ImageData): [number, number, number] {
  const { data, width: w, height: h } = img;
  const patch = Math.max(3, Math.min(12, Math.floor(Math.min(w, h) * 0.04)));
  const corners: [number, number, number][] = [
    samplePatch(data, w, h, 0,         0,         patch),
    samplePatch(data, w, h, w - patch, 0,         patch),
    samplePatch(data, w, h, 0,         h - patch, patch),
    samplePatch(data, w, h, w - patch, h - patch, patch),
  ];
  const avg = corners.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0] as [number, number, number]);
  return [Math.round(avg[0] / 4), Math.round(avg[1] / 4), Math.round(avg[2] / 4)];
}

// Composite transparent pixels over a solid background color.
// Halftone must operate on a flat (opaque) image so gradient edges at transparent
// boundaries blend naturally into the chosen background tone.
export function flattenWithBg(src: ImageData, bgColor: [number, number, number]): ImageData {
  const { width: w, height: h, data: srcD } = src;
  const [br, bg, bb] = bgColor;
  const flat = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = srcD[i * 4 + 3] / 255;
    flat[i * 4]     = Math.round(srcD[i * 4]     * a + br * (1 - a));
    flat[i * 4 + 1] = Math.round(srcD[i * 4 + 1] * a + bg * (1 - a));
    flat[i * 4 + 2] = Math.round(srcD[i * 4 + 2] * a + bb * (1 - a));
    flat[i * 4 + 3] = 255;
  }
  return new ImageData(flat, w, h);
}

// Photoshop-style levels: maps lum from [black,white] → [0,1] with gamma
export function applyLevels(lum: number, black: number, white: number, gamma: number): number {
  const range = Math.max(1, white - black);
  const t = Math.max(0, Math.min(1, (lum - black) / range));
  return Math.pow(t, 1 / Math.max(0.01, gamma));
}

// Build a per-pixel alpha map (0–255) with optional box-blur softness pass.
// Used as the primary coverage driver: opacity gradients → halftone dots.
export function buildDtgAlphaMap(src: ImageData, softness: number): Float32Array {
  const { width: w, height: h, data: srcD } = src;
  const alphaMap = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alphaMap[i] = srcD[i * 4 + 3];
  if (softness > 0) {
    const radius = Math.round(softness);
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      const prefix = new Float32Array(w + 1);
      for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + alphaMap[off + x];
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
        tmp[off + x] = (prefix[x1] - prefix[x0]) / (x1 - x0);
      }
    }
    for (let x = 0; x < w; x++) {
      const prefix = new Float32Array(h + 1);
      for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
        alphaMap[y * w + x] = (prefix[y1] - prefix[y0]) / (y1 - y0);
      }
    }
  }
  return alphaMap;
}

// Returns a greyscale preview of the halftone coverage: bright = solid ink, dark = transparent.
// Coverage is driven by the alpha channel — opacity gradients are what get halftoned.
export function renderDtgGreyscalePreview(
  src: ImageData,
  levelsBlack: number,
  levelsWhite: number,
  levelsGamma: number,
  softness: number,
  _bgColor?: [number, number, number],
): ImageData {
  const { width: w, height: h } = src;
  const alphaMap = buildDtgAlphaMap(src, softness);
  const outD = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(applyLevels(alphaMap[i], levelsBlack, levelsWhite, levelsGamma) * 255);
    outD[i * 4] = v; outD[i * 4 + 1] = v; outD[i * 4 + 2] = v; outD[i * 4 + 3] = 255;
  }
  return new ImageData(outD, w, h);
}

// Remove isolated opaque pixels via two passes of density check + connected-component island removal.
function applyDespeckle(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const stride = w + 1;
  const MIN_FRACTION = 0.3;

  function densityPass() {
    const prefix = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const opaque = data[(y * w + x) * 4 + 3] > 0 ? 1 : 0;
        prefix[(y + 1) * stride + (x + 1)] =
          opaque +
          prefix[y * stride + (x + 1)] +
          prefix[(y + 1) * stride + x] -
          prefix[y * stride + x];
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (data[i * 4 + 3] === 0) continue;
        const x0 = Math.max(0, x - radius), y0 = Math.max(0, y - radius);
        const x1 = Math.min(w - 1, x + radius), y1 = Math.min(h - 1, y + radius);
        const sum =
          prefix[(y1 + 1) * stride + (x1 + 1)] -
          prefix[y0 * stride + (x1 + 1)] -
          prefix[(y1 + 1) * stride + x0] +
          prefix[y0 * stride + x0];
        if (sum / ((x1 - x0 + 1) * (y1 - y0 + 1)) < MIN_FRACTION) data[i * 4 + 3] = 0;
      }
    }
  }

  densityPass();
  densityPass();

  const minIslandSize = Math.max(4, (radius + 1) * (radius + 1));
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  for (let startI = 0; startI < w * h; startI++) {
    if (visited[startI] || data[startI * 4 + 3] === 0) continue;
    queue.length = 0;
    let head = 0;
    queue.push(startI);
    visited[startI] = 1;
    while (head < queue.length) {
      const ci = queue[head++];
      const cy = (ci / w) | 0, cx = ci - cy * w;
      if (cy > 0)     { const ni = ci - w; if (!visited[ni] && data[ni * 4 + 3] > 0) { visited[ni] = 1; queue.push(ni); } }
      if (cy < h - 1) { const ni = ci + w; if (!visited[ni] && data[ni * 4 + 3] > 0) { visited[ni] = 1; queue.push(ni); } }
      if (cx > 0)     { const ni = ci - 1; if (!visited[ni] && data[ni * 4 + 3] > 0) { visited[ni] = 1; queue.push(ni); } }
      if (cx < w - 1) { const ni = ci + 1; if (!visited[ni] && data[ni * 4 + 3] > 0) { visited[ni] = 1; queue.push(ni); } }
    }
    if (queue.length < minIslandSize) {
      for (let qi = 0; qi < queue.length; qi++) data[queue[qi] * 4 + 3] = 0;
    }
  }
}

// Row-major 4×4 bayer thresholds, normalized to [0,1)
const BAYER4_NORM = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5].map(v => v / 16);

function dtgShapeTest(
  method: DtgMethod,
  x: number, y: number,
  coverage: number,
  cosA: number, sinA: number,
  cellSize: number, halfCell: number,
  frequency: number,
): boolean {
  if (coverage <= 0.0) return false;
  // Raised from 0.92 → 0.97 so dots grow organically into solid rather than
  // hard-clipping. Keeps a natural halftone texture up to near-full coverage.
  if (coverage >= 0.97) return true;

  if (method === 'bayer-4') {
    const scale = Math.max(1, Math.round(frequency / 15));
    const bx = (Math.floor(x / scale)) & 3;
    const by = (Math.floor(y / scale)) & 3;
    return coverage > BAYER4_NORM[by * 4 + bx];
  }
  if (method === 'grain') {
    const grainCell = Math.max(1, Math.round(frequency / 15));
    const gx = Math.floor(x / grainCell);
    const gy = Math.floor(y / grainCell);
    let h = (gx * 2053 ^ gy * 4001) >>> 0;
    h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return coverage > h / 0xFFFFFFFF;
  }

  // Rotated halftone grid
  const xr = x * cosA + y * sinA;
  const yr = -x * sinA + y * cosA;
  const dxr = xr - Math.round(xr / cellSize) * cellSize;
  const dyr = yr - Math.round(yr / cellSize) * cellSize;
  const r = halfCell * Math.sqrt(coverage);

  switch (method) {
    case 'halftone-round':
      return dxr * dxr + dyr * dyr <= r * r;
    case 'halftone-diamond':
      return Math.abs(dxr) + Math.abs(dyr) <= r * 1.414;
    case 'halftone-ellipse':
      return (dxr / (r * 1.6)) ** 2 + (dyr / (r * 0.8)) ** 2 <= 1;
    case 'halftone-square':
      return Math.max(Math.abs(dxr), Math.abs(dyr)) <= r;
    case 'halftone-line':
      return Math.abs(dxr) <= halfCell * coverage;
    case 'halftone-crosshatch':
      return Math.abs(dxr) <= halfCell * coverage * 0.5 || Math.abs(dyr) <= halfCell * coverage * 0.5;
    default:
      return dxr * dxr + dyr * dyr <= r * r;
  }
}

// Build a per-pixel luminance map with optional box-blur softness pass.
// Pure TypedArray math — usable in workers and the main thread alike.
export function buildDtgLumMap(src: ImageData, softness: number): Float32Array {
  const { width: w, height: h, data: srcD } = src;
  const lumMap = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lumMap[i] = 0.299 * srcD[i * 4] + 0.587 * srcD[i * 4 + 1] + 0.114 * srcD[i * 4 + 2];
  }
  if (softness > 0) {
    const radius = Math.round(softness);
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const off = y * w;
      const prefix = new Float32Array(w + 1);
      for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + lumMap[off + x];
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
        tmp[off + x] = (prefix[x1] - prefix[x0]) / (x1 - x0);
      }
    }
    for (let x = 0; x < w; x++) {
      const prefix = new Float32Array(h + 1);
      for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
        lumMap[y * w + x] = (prefix[y1] - prefix[y0]) / (y1 - y0);
      }
    }
  }
  return lumMap;
}

// Downsample an upscaled halftone back to display resolution while preserving
// crisp binary dot edges. Area-averages over each source block, then snaps
// alpha to 0 or 255 — prevents the grey halos that area-only averaging produces.
export function halftoneDownsample(src: ImageData, targetW: number, targetH: number): ImageData {
  const dst = new ImageData(targetW, targetH);
  const scaleX = src.width / targetW;
  const scaleY = src.height / targetH;
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(src.width, Math.ceil((x + 1) * scaleX));
      const y0 = Math.floor(y * scaleY);
      const y1 = Math.min(src.height, Math.ceil((y + 1) * scaleY));
      let inked = 0, total = 0, sumR = 0, sumG = 0, sumB = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * src.width + sx) * 4;
          total++;
          if (src.data[si + 3] > 0) {
            inked++;
            sumR += src.data[si];
            sumG += src.data[si + 1];
            sumB += src.data[si + 2];
          }
        }
      }
      if (inked > 0 && inked * 10 >= total * 3) {
        const di = (y * targetW + x) * 4;
        dst.data[di]     = Math.round(sumR / inked);
        dst.data[di + 1] = Math.round(sumG / inked);
        dst.data[di + 2] = Math.round(sumB / inked);
        dst.data[di + 3] = 255;
      }
    }
  }
  return dst;
}

export function applyDtgHalftone(
  src:           ImageData,
  settings:      DtgSettings,
  _bgMask:       Uint8Array | null,
  pixelsPerInch: number,
  _bgColor?:     [number, number, number],
): ImageData {
  const { width: w, height: h } = src;
  const srcD = src.data;

  const { method, frequency, angle, levelsBlack, levelsWhite, levelsGamma, softness, despeckle, despeckleRadius } = settings;

  // Coverage is driven by the alpha channel, not luminance.
  // Solid opaque pixels (alpha=255) print solid. Opacity gradients become halftone dots.
  // This replaces semi-transparent areas with printable dot patterns without touching solid art.
  const alphaMap = buildDtgAlphaMap(src, softness);

  // No-pattern mode: levels dropout only — keep original colors where coverage > 0.
  if (method === 'none') {
    const outD = new Uint8ClampedArray(srcD);
    for (let i = 0; i < w * h; i++) {
      if (applyLevels(alphaMap[i], levelsBlack, levelsWhite, levelsGamma) === 0) outD[i * 4 + 3] = 0;
    }
    if (despeckle) applyDespeckle(outD, w, h, despeckleRadius);
    return new ImageData(outD, w, h);
  }

  // Backward compat: old 'halftone' value → 'halftone-round'
  const normalizedMethod: DtgMethod = (method as string) === 'halftone' ? 'halftone-round' : method;

  const cellSize = Math.max(3, pixelsPerInch / Math.max(1, frequency));
  const halfCell = cellSize * 0.5;
  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // Alpha-driven halftone: solid opaque areas print solid; opacity gradients become dot patterns.
  // Transparent pixels (srcAlpha=0) are always skipped — background knockout via alpha.
  const htD = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (srcD[i * 4 + 3] === 0) continue;
      const coverage = applyLevels(alphaMap[i], levelsBlack, levelsWhite, levelsGamma);

      if (dtgShapeTest(normalizedMethod, x, y, coverage, cosA, sinA, cellSize, halfCell, frequency)) {
        htD[i * 4]     = srcD[i * 4];
        htD[i * 4 + 1] = srcD[i * 4 + 1];
        htD[i * 4 + 2] = srcD[i * 4 + 2];
        htD[i * 4 + 3] = 255; // binary ink: halftone converts opacity gradient to solid dots
      }
    }
  }

  if (despeckle) applyDespeckle(htD, w, h, despeckleRadius);
  return new ImageData(htD, w, h);
}
