// Plate Optimizer — content-aware CMYK plate processing.
// Runs between ICC separation and halftoning, like a commercial RIP's
// internal plate-preparation stage.
//
// Operations (in order):
//   1. Grayscale proxy → fast L1-norm edge detection
//   2. Edge mask dilation (box-blur radius 2) — protect edge neighborhoods
//   3. Per-pixel chroma map — protect saturated colors from over-smoothing
//   4. CMY plates: edge-masked box-blur (flat neutrals → smooth, edges → untouched)
//   5. K plate: minimal smoothing + unsharp-mask boost at edges
//   6. Minimum dot threshold (kills sub-printable ink noise)

// ── Separable box blur (O(n) sliding window) ─────────────────────────────────

function blurH(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = src[row], count = 1;
    for (let x = 1; x <= r && x < w; x++) { sum += src[row + x]; count++; }
    dst[row] = sum / count;
    for (let x = 1; x < w; x++) {
      if (x + r     < w) { sum += src[row + x + r];     count++; }
      if (x - r - 1 >= 0) { sum -= src[row + x - r - 1]; count--; }
      dst[row + x] = sum / count;
    }
  }
  return dst;
}

function blurV(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const dst = new Float32Array(src.length);
  for (let x = 0; x < w; x++) {
    let sum = src[x], count = 1;
    for (let y = 1; y <= r && y < h; y++) { sum += src[y * w + x]; count++; }
    dst[x] = sum / count;
    for (let y = 1; y < h; y++) {
      if (y + r     < h) { sum += src[(y + r)     * w + x]; count++; }
      if (y - r - 1 >= 0) { sum -= src[(y - r - 1) * w + x]; count--; }
      dst[y * w + x] = sum / count;
    }
  }
  return dst;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  return blurV(blurH(src, w, h, r), w, h, r);
}

// ── Fast L1-norm edge detection ────────────────────────────────────────────────
// Approximates Sobel using only right and bottom neighbors — O(2n), cache-friendly.

function edgeDetect(gray: Float32Array, w: number, h: number): Float32Array {
  const edge = new Float32Array(w * h);
  const scale = 6.0;
  for (let y = 0; y < h - 1; y++) {
    const row = y * w;
    for (let x = 0; x < w - 1; x++) {
      const i = row + x;
      const dx = Math.abs(gray[i + 1] - gray[i]);
      const dy = Math.abs(gray[i + w] - gray[i]);
      edge[i] = Math.min(1, (dx + dy) * scale);
    }
  }
  return edge;
}

// ── Main optimizer ─────────────────────────────────────────────────────────────

export function optimizePlates(
  C: Float32Array, M: Float32Array, Y: Float32Array, K: Float32Array,
  w: number, h: number,
): { C: Float32Array; M: Float32Array; Y: Float32Array; K: Float32Array } {
  const n = w * h;

  // 1. Gray proxy: K-dominant so structural edges dominate, with CMY support
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = K[i] * 0.65 + M[i] * 0.17 + C[i] * 0.12 + Y[i] * 0.06;
  }

  // 2. Edge detection + dilation (spreads protection 2px outward from each edge)
  const rawEdge  = edgeDetect(gray, w, h);
  const edgeProt = boxBlur(rawEdge, w, h, 2);

  // 3. Per-pixel chroma (protects saturated colors from smoothing)
  const chroma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    chroma[i] = Math.max(C[i], M[i], Y[i]) - Math.min(C[i], M[i], Y[i]);
  }

  // 4. Edge-masked channel smoothing
  //    protection = 1 → no smoothing (edge or vivid pixel)
  //    protection = 0 → maximum smoothing (flat neutral area)
  function smoothChannel(
    src: Float32Array, radius: number, maxBlend: number, chromaScale: number,
  ): Float32Array {
    const blurred = boxBlur(src, w, h, radius);
    const result  = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const protect     = Math.min(1, edgeProt[i] * 4 + chroma[i] * chromaScale);
      const blendWeight = (1 - protect) * maxBlend;
      result[i] = src[i] + (blurred[i] - src[i]) * blendWeight;
    }
    return result;
  }

  // C: lower chromaScale (1.3) so skin-tone chroma (~0.3–0.5) still gets smoothed
  // M: moderate (1.6) — M carries flesh-tone warmth, protect its saturation slightly more
  // Y: most aggressive (2.0) — Y carries least structural detail
  const Cs = smoothChannel(C, 2, 0.75, 1.3);
  const Ms = smoothChannel(M, 2, 0.75, 1.6);
  const Ys = smoothChannel(Y, 2, 0.78, 2.0);

  // K: light smooth only — K is the sharpness carrier
  const Ks = smoothChannel(K, 1, 0.30, 0.4);

  // 5. K unsharp mask at edges: adds high-freq boost in exact edge locations
  //    This gives K plate the crisp "bite" of a commercial RIP output
  const Kblur  = boxBlur(Ks, w, h, 1);
  const Kfinal = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const hf = (Ks[i] - Kblur[i]) * rawEdge[i] * 0.55;
    Kfinal[i] = Math.min(1, Math.max(0, Ks[i] + hf));
  }

  // 6. Minimum dot threshold — drops sub-printable ink to zero
  //    Ink below ~2.2% can't hold on a screen mesh; prints as color noise.
  const MIN = 0.022;
  const Cf = new Float32Array(n), Mf = new Float32Array(n), Yf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Cf[i] = Cs[i] < MIN ? 0 : Cs[i];
    Mf[i] = Ms[i] < MIN ? 0 : Ms[i];
    Yf[i] = Ys[i] < MIN ? 0 : Ys[i];
    if (Kfinal[i] < MIN) Kfinal[i] = 0;
  }

  return { C: Cf, M: Mf, Y: Yf, K: Kfinal };
}
