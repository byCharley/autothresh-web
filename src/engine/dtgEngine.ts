export type DtgMethod = 'halftone' | 'none';

export interface DtgSettings {
  method:          DtgMethod;
  frequency:       number;   // lines per inch (e.g. 35)
  angle:           number;   // screen angle in degrees (e.g. 22.5)
  edgesOnly:       boolean;  // false = whole-image luminance screen, true = edge-blend only
  bgColor:         [number, number, number] | null;  // used by edges-only mode
  bgTolerance:     number;   // perceptual color distance threshold (0–200), edges-only mode
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

function boxBlur2D(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    const prefix = new Float32Array(w + 1);
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + src[off + x];
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
      dst[y * w + x] = (prefix[y1] - prefix[y0]) / (y1 - y0);
    }
  }
  return dst;
}

// Remove isolated opaque pixels via two passes of density check + connected-component island removal.
// Pass 1: prefix-sum density check removes obvious strays.
// Pass 2: re-checks after pass 1 so newly isolated neighbors are caught.
// Island removal: BFS to find connected opaque regions, remove any smaller than radius².
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

  // BFS island removal: connected opaque regions smaller than minIslandSize get erased.
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

export function applyDtgHalftone(
  src:           ImageData,
  settings:      DtgSettings,
  bgMask:        Uint8Array | null,   // flood-fill bg mask from left panel; used by whole-image mode
  pixelsPerInch: number,
): ImageData {
  const { width: w, height: h } = src;
  const srcD = src.data;
  const outD = new Uint8ClampedArray(srcD);

  const { method, frequency, angle, edgesOnly, bgColor, bgTolerance, despeckle, despeckleRadius } = settings;

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Color-distance coverage: 0 = matches bgColor (transparent), 1 = far from bg (opaque).
  // Used only in edges-only mode where color-based boundary detection drives the screen.
  const [bgR, bgG, bgB] = bgColor ?? [0, 0, 0];
  const tolSq = Math.max(1, bgTolerance) ** 2;
  function colorCoverage(r: number, g: number, b: number): number {
    if (!bgColor) return 1;
    const dr = r - bgR, dg = g - bgG, db = b - bgB;
    return Math.min(1, (0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db) / tolSq);
  }

  // ── No-Pattern mode: hard knockout, no halftone dots ───────────────────────
  if (method === 'none') {
    if (bgMask) {
      for (let i = 0; i < w * h; i++) if (bgMask[i] === 255) outD[i * 4 + 3] = 0;
    } else {
      for (let i = 0; i < w * h; i++) {
        const r = srcD[i * 4], g = srcD[i * 4 + 1], b = srcD[i * 4 + 2];
        if (colorCoverage(r, g, b) < 0.5) outD[i * 4 + 3] = 0;
      }
    }
    if (despeckle) applyDespeckle(outD, w, h, despeckleRadius);
    return new ImageData(outD, w, h);
  }

  // ── Halftone setup ─────────────────────────────────────────────────────────
  const cellSize = Math.max(1, pixelsPerInch / Math.max(1, frequency));
  const halfCell = cellSize * 0.5;
  const angleRad = (angle * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // ── Edges-only proximity map ────────────────────────────────────────────────
  // Built from color-keyed pixels (not bgMask) so it stays tight to the actual
  // color boundary regardless of flood-fill seed configuration.
  let edgeProx: Float32Array | null = null;
  if (edgesOnly) {
    const keyMask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const r = srcD[i * 4], g = srcD[i * 4 + 1], b = srcD[i * 4 + 2];
      keyMask[i] = colorCoverage(r, g, b) < 0.5 ? 1.0 : 0.0;
    }
    edgeProx = boxBlur2D(keyMask, w, h, Math.max(2, Math.round(cellSize * 2.5)));
  }

  // ── Main halftone loop ─────────────────────────────────────────────────────
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = srcD[i * 4], g = srcD[i * 4 + 1], b = srcD[i * 4 + 2];

      let coverage: number;

      if (!edgesOnly) {
        // ── Whole Image ─────────────────────────────────────────────────────
        // Background removed by bgMask (left-panel flood-fill controls).
        // Halftone applied over all remaining artwork pixels based on luminance —
        // the same luminance→dot-size logic threshold mode uses per layer, but
        // applied directly to the full-color artwork with no ink-layer separation.
        if (bgMask && bgMask[i] === 255) { outD[i * 4 + 3] = 0; continue; }
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Lighter pixels → bigger dots → more opaque (DTG: bright colors need
        // more ink to cover the dark garment beneath).
        coverage = lum / 255;
      } else {
        // ── Edges Only ──────────────────────────────────────────────────────
        // Color-distance from detected bg drives the screen; only the
        // artwork-to-bg transition zone is halftone-screened.
        coverage = colorCoverage(r, g, b);
      }

      // Halftone grid
      const xr = x * cosA + y * sinA;
      const yr = -x * sinA + y * cosA;
      const cx = Math.round(xr / cellSize) * cellSize;
      const cy = Math.round(yr / cellSize) * cellSize;
      const dxr = xr - cx, dyr = yr - cy;
      const pixDist = Math.sqrt(dxr * dxr + dyr * dyr);
      const dotRadius = halfCell * Math.sqrt(coverage);
      const isInsideDot = pixDist <= dotRadius;

      if (edgesOnly && edgeProx !== null) {
        const prox = edgeProx[i];
        if (prox < 0.01) continue; // deep interior stays fully opaque
        const htAlpha = isInsideDot ? 255 : 0;
        const blended = Math.round(255 * (1 - prox) + htAlpha * prox);
        if (blended < outD[i * 4 + 3]) outD[i * 4 + 3] = blended;
      } else {
        if (!isInsideDot) outD[i * 4 + 3] = 0;
      }
    }
  }

  if (despeckle) applyDespeckle(outD, w, h, despeckleRadius);
  return new ImageData(outD, w, h);
}
