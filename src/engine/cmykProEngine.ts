import type { ProcessedLayer } from './imageProcessor';
import { loadIccProfile, separateWithProfile } from './colorEngine';
import { optimizePlates } from './plateOptimizer';

export type GcrPreset =
  | 'adaptive' | 'photo' | 'illustration' | 'poster'
  | 'vintage'  | 'screenPrint' | 'maxInkSaving';

export type DotShape = 'round' | 'euclidean' | 'ellipse' | 'line' | 'square' | 'diamond';

export interface ChannelHalftone {
  lpi:           number;    // 25–200
  angle:         number;    // 0–180 degrees
  shape:         DotShape;
  dotGain:       number;    // 0–30%
  highlightClip: number;    // 0–10% — ink below this → 0 (suppress isolated highlight dots)
  highlightFade: number;    // 0–15% — smooth ramp zone above the clip threshold
  shadowClip?:   number;    // 0–10% — ink above (1 - this) → 255 (fill tiny holes in shadows)
  shadowFade?:   number;    // 0–15% — smooth ramp zone below the shadow clip threshold
}

export interface ProCmykSettings {
  cmykProfile:       'USWebCoatedSWOP' | 'CoatedFOGRA39' | 'WebCoatedFOGRA28' | 'JapanColor2001Coated';
  blackGeneration:   GcrPreset;
  totalInkLimit:     number;   // 200–400%
  preservePureBlack: boolean;
  densityC:          number;   // 50–150
  densityM:          number;
  densityY:          number;
  densityK:          number;
  grayBalance:       number;   // -50 to +50
  lockLpi:           boolean;
  halftoneC:         ChannelHalftone;
  halftoneM:         ChannelHalftone;
  halftoneY:         ChannelHalftone;
  halftoneK:         ChannelHalftone;
  // Legacy fields — kept for backward compat with saved presets
  lpi?:     number;
  dotGain?: number;
  angleC?:  number;
  angleM?:  number;
  angleY?:  number;
  angleK?:  number;
}

const mkHalftone = (angle: number): ChannelHalftone =>
  ({ lpi: 65, angle, shape: 'round', dotGain: 15, highlightClip: 5, highlightFade: 8 });

export const DEFAULT_PRO_CMYK_SETTINGS: ProCmykSettings = {
  cmykProfile:       'USWebCoatedSWOP',
  blackGeneration:   'adaptive',
  totalInkLimit:     300,
  preservePureBlack: false,
  densityC:          100,
  densityM:          100,
  densityY:          100,
  densityK:          100,
  grayBalance:       0,
  lockLpi:           true,
  halftoneC:         mkHalftone(15),
  halftoneM:         mkHalftone(75),
  halftoneY:         mkHalftone(0),
  halftoneK:         mkHalftone(45),
};

export interface CmykProPlates {
  C: Uint8Array;
  M: Uint8Array;
  Y: Uint8Array;
  K: Uint8Array;
  width:  number;
  height: number;
}

// ── Chroma-gated GCR curves ───────────────────────────────────────────────────
// Each curve defines GCR strength at 5 chroma breakpoints: [0, 0.10, 0.20, 0.35, 0.50+].
// Chroma = max(C,M,Y) − min(C,M,Y) in the ICC-separated planes.
// Low chroma = neutral gray/stone/shadow → heavy GCR pulls neutral CMY → K.
// High chroma = vivid red/banner/skin → light GCR preserves ink saturation.
// Values are linearly interpolated between breakpoints.
//
// Legacy values ('light','medium','heavy','maximum') are mapped so existing
// saved presets continue to work.

type GcrCurve = readonly [number, number, number, number, number];
const CHROMA_BP = [0, 0.10, 0.20, 0.35, 0.50] as const;

const GCR_CURVES: Record<string, GcrCurve> = {
  // ── New semantic presets ───────────────────────────────────────────────────
  adaptive:     [0.93, 0.78, 0.52, 0.11, 0.05],  // smart default — biased toward K in low-chroma shadows
  photo:        [0.60, 0.40, 0.22, 0.08, 0.03],  // gentle — preserves photographic tone
  illustration: [0.95, 0.72, 0.38, 0.08, 0.04],  // strong K in shadows, clean CMY for art
  poster:       [0.95, 0.76, 0.35, 0.06, 0.03],  // bold, protects color vibrancy
  vintage:      [0.48, 0.28, 0.15, 0.06, 0.03],  // soft blacks, CMY-biased retro feel
  screenPrint:  [0.92, 0.76, 0.52, 0.15, 0.08],  // heavy GCR, minimal ink overlap
  maxInkSaving: [0.98, 0.90, 0.70, 0.32, 0.15],  // maximum K everywhere safe
  // ── Legacy fallbacks so saved presets still render ─────────────────────────
  light:        [0.35, 0.22, 0.12, 0.04, 0.02],
  medium:       [0.55, 0.38, 0.22, 0.08, 0.04],
  heavy:        [0.80, 0.58, 0.35, 0.12, 0.06],
  maximum:      [0.96, 0.82, 0.60, 0.25, 0.12],
};

function chromaGcr(chroma: number, curve: GcrCurve): number {
  if (chroma <= 0)    return curve[0];
  if (chroma >= 0.50) return curve[4];
  for (let i = 0; i < CHROMA_BP.length - 1; i++) {
    const lo = CHROMA_BP[i], hi = CHROMA_BP[i + 1];
    if (chroma < hi) {
      const t = (chroma - lo) / (hi - lo);
      return curve[i] * (1 - t) + curve[i + 1] * t;
    }
  }
  return curve[4];
}

export async function separateCmykPro(
  imageData: ImageData,
  settings:  ProCmykSettings,
  _signal?:  AbortSignal,
): Promise<CmykProPlates> {
  const { width: w, height: h } = imageData;
  const src = imageData.data;
  const n   = w * h;

  // ── Step 1: ICC profile lookup (tetrahedral CLUT interpolation) ───────────
  const profile = await loadIccProfile(settings.cmykProfile);
  const { C, M, Y, K } = separateWithProfile(imageData, profile);

  // ── Step 2: Chroma-gated post-profile GCR ────────────────────────────────
  // Push neutral CMY → K based on each pixel's chroma.
  // Low-chroma pixels (stone, shadow, armor) get heavy GCR.
  // High-chroma pixels (red banners, vivid logos) are mostly left alone.
  // Only the neutral (min CMY) component is shifted — hue is preserved.
  const curve = GCR_CURVES[settings.blackGeneration] ?? GCR_CURVES['adaptive'];
  for (let i = 0; i < n; i++) {
    const c = C[i], m = M[i], y = Y[i], k = K[i];
    const neutral = Math.min(c, m, y);
    if (neutral < 0.005) continue;

    const chroma    = Math.max(c, m, y) - neutral;
    const gcrFactor = chromaGcr(chroma, curve);
    if (gcrFactor < 0.001) continue;

    const shift = Math.min(gcrFactor * neutral, neutral * 0.97, 1 - k);
    C[i] = c - shift;
    M[i] = m - shift;
    Y[i] = y - shift;
    K[i] = k + shift;
  }

  // ── Step 2.5: Warm-tone skin protection ──────────────────────────────────
  // In pixels where original R ≥ G ≥ B (warm hue covering all skin tones from
  // pale to very dark), the ICC profile often delivers more C than a skilled
  // print operator would use. We cap C at ≈35% of M for warm pixels, which
  // removes the cyan cast from cheeks/forehead without flattening cool colors.
  for (let i = 0; i < n; i++) {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
    // Only warm hues where red is dominant — catches every skin tone
    if (r < g || g < b || r < 55 || K[i] > 0.60) continue;
    const c = C[i], m = M[i];
    if (m < 0.12 || c < 0.01) continue;

    // Warmth strength: how far R > G > B (normalized, capped at 1)
    const warmth = Math.min(1, (r - g) / 40 + (g - b) / 30);
    const cTarget = m * 0.35;
    if (c <= cTarget) continue;

    C[i] = c - (c - cTarget) * warmth * 0.65;
  }

  // ── Step 2.6: Shadow K punch ──────────────────────────────────────────────
  // Push neutral CMY bulk out of shadows into K progressively — darker means
  // more aggressive. At K=0.30 we shift ~25% of neutral CMY; at K=0.80 we
  // shift ~72%. This keeps the sweater, dark stone, and shadow areas K-dominant
  // rather than leaving residual CMY that muddles the shadow.
  for (let i = 0; i < n; i++) {
    const c = C[i], m = M[i], y = Y[i], k = K[i];
    if (k < 0.25) continue;
    const neutral = Math.min(c, m, y);
    if (neutral < 0.01) continue;
    if (Math.max(c, m, y) - neutral > 0.14) continue;  // protect chromatic areas

    const punchFactor = Math.min(0.90, 0.24 + k * 0.70);
    const shift = Math.min(punchFactor * neutral, 1 - k);
    C[i] = c - shift; M[i] = m - shift; Y[i] = y - shift; K[i] = k + shift;
  }

  // ── Step 3: Pure-K cleanup (smooth fade, no hard RGB snap) ─────────────────
  // Fades residual CMY to zero in very dark, near-neutral pixels, using the
  // already-processed K value rather than a raw RGB threshold so there are
  // no blotch boundaries. Only activates where K > 0.80 and chroma is low.
  if (settings.preservePureBlack) {
    for (let i = 0; i < n; i++) {
      const k = K[i];
      if (k < 0.80) continue;
      const c = C[i], m = M[i], y = Y[i];
      if (c + m + y < 0.02) continue;
      // Protect chromatic darks (deep purples, teal shadows, etc.)
      if (Math.max(c, m, y) - Math.min(c, m, y) > 0.12) continue;
      // Quadratic ramp: t=0 at K=0.80, t=1 at K=1.0 → smooth, no visible edge
      const fade = ((k - 0.80) / 0.20) ** 2;
      C[i] = c * (1 - fade);
      M[i] = m * (1 - fade);
      Y[i] = y * (1 - fade);
    }
  }

  // ── Step 4: Gray balance slider (fine C-channel trim) ────────────────────
  const gb = (settings.grayBalance ?? 0) / 300;
  if (Math.abs(gb) > 0.001) {
    for (let i = 0; i < n; i++) C[i] = Math.min(1, Math.max(0, C[i] * (1 + gb)));
  }

  // ── Step 5: Per-channel density scaling ──────────────────────────────────
  const dC = settings.densityC / 100, dM = settings.densityM / 100;
  const dY = settings.densityY / 100, dK = settings.densityK / 100;
  if (dC !== 1 || dM !== 1 || dY !== 1 || dK !== 1) {
    for (let i = 0; i < n; i++) {
      C[i] = Math.min(1, C[i] * dC); M[i] = Math.min(1, M[i] * dM);
      Y[i] = Math.min(1, Y[i] * dY); K[i] = Math.min(1, K[i] * dK);
    }
  }

  // ── Step 5.5: Plate optimization ────────────────────────────────────────
  // Content-aware RIP-quality plate preparation: edge-preserving smoothing,
  // isolated-dot removal in neutral areas, K sharpening, minimum dot cleanup.
  // Receives Float32 plates and returns optimised Float32 plates.
  const optimized = optimizePlates(C, M, Y, K, w, h);
  C.set(optimized.C); M.set(optimized.M); Y.set(optimized.Y); K.set(optimized.K);

  // ── Step 6: Total ink coverage limit ─────────────────────────────────────
  // Intelligent reduction: remove K first (most neutral), then scale CMY.
  const tac = settings.totalInkLimit / 100;
  for (let i = 0; i < n; i++) {
    const total = C[i] + M[i] + Y[i] + K[i];
    if (total <= tac) continue;
    const excess = total - tac;
    if (K[i] >= excess) {
      K[i] -= excess;
    } else {
      const remaining = excess - K[i];
      K[i] = 0;
      const cmyTotal = C[i] + M[i] + Y[i];
      if (cmyTotal > 0) {
        const scale = Math.max(0, (cmyTotal - remaining) / cmyTotal);
        C[i] *= scale; M[i] *= scale; Y[i] *= scale;
      }
    }
  }

  const toU8 = (f: Float32Array) =>
    Uint8Array.from(f, v => Math.round(Math.min(1, Math.max(0, v)) * 255));

  return Promise.resolve({
    C: toU8(C), M: toU8(M), Y: toU8(Y), K: toU8(K), width: w, height: h,
  });
}

// ── Halftone application (unchanged) ─────────────────────────────────────────

const CMYK_CHANNEL_INFO = [
  { id: 'cmyk-c', name: 'C · Cyan',    color: [0, 174, 239]  as [number, number, number] },
  { id: 'cmyk-m', name: 'M · Magenta', color: [236, 0, 140]  as [number, number, number] },
  { id: 'cmyk-y', name: 'Y · Yellow',  color: [255, 242, 0]  as [number, number, number] },
  { id: 'cmyk-k', name: 'K · Black',   color: [10,  10,  10] as [number, number, number] },
];

// Fallback helper: build a ChannelHalftone from legacy flat settings when the
// new per-channel fields are absent (old saved presets).
function resolveHalftone(
  ht: ChannelHalftone | undefined,
  legacyAngle: number,
  s: ProCmykSettings,
): ChannelHalftone {
  if (ht) return { ...ht, highlightClip: ht.highlightClip ?? 5, highlightFade: ht.highlightFade ?? 8, shadowClip: ht.shadowClip ?? 0, shadowFade: ht.shadowFade ?? 0 };
  return { lpi: s.lpi ?? 65, angle: legacyAngle, shape: 'round', dotGain: s.dotGain ?? 15, highlightClip: 5, highlightFade: 8, shadowClip: 0, shadowFade: 0 };
}

function rasterizeHalftoneChannel(
  chan: Uint8Array,
  w: number, h: number,
  ht: ChannelHalftone,
  documentDpi: number,
  bgMask: Uint8Array | null,
): Uint8Array {
  const cs   = Math.max(1, documentDpi / ht.lpi);
  const dg   = ht.dotGain / 100;
  const rad  = ht.angle * Math.PI / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const mask  = new Uint8Array(w * h);

  // Constants hoisted out of the pixel loop
  const AA    = 1.2;
  const AA_H  = AA * 0.5;
  const maxR  = cs * 0.5;
  const hClip = ht.highlightClip / 100;
  const hFade = ht.highlightFade / 100;
  const sClip = (ht.shadowClip ?? 0) / 100;
  const sFade = (ht.shadowFade ?? 0) / 100;

  // Per-cell cache — recomputed only when the halftone cell changes.
  // Bilinear sample + clip/fade/gain + shape math amortised over ~cs² pixels.
  let prevCX = Number.MIN_SAFE_INTEGER, prevCY = Number.MIN_SAFE_INTEGER;
  let cellR = 0, cellR2 = 0, cellAaOut2 = 0, cellAaIn2 = 0;
  let cellInv = false;                       // euclidean / diamond: shrinking hole
  let cellEllA2 = 0, cellEllB2 = 0, cellEllAMin = 0, cellEllInv = false;
  let cellHs = 0;                            // square half-side
  let cellLinMax = 0;                        // line max half-width
  let cellDiamT = 0;                         // diamond threshold (Manhattan space)

  for (let py = 0; py < h; py++) {
    const pyS = py * sinA, pyC = py * cosA;
    for (let px = 0; px < w; px++) {
      const pi = py * w + px;
      if (bgMask && bgMask[pi] === 255) continue;

      const su = px * cosA + pyS;
      const sv = -px * sinA + pyC;

      const cellX = Math.floor(su / cs);
      const cellY = Math.floor(sv / cs);

      // ── Cell cache refresh ────────────────────────────────────────────────
      if (cellX !== prevCX || cellY !== prevCY) {
        prevCX = cellX; prevCY = cellY;
        const cu = (cellX + 0.5) * cs;
        const cv = (cellY + 0.5) * cs;

        // Bilinear sample at rotated cell center
        const fx = Math.max(0, Math.min(w - 1, cu * cosA - cv * sinA));
        const fy = Math.max(0, Math.min(h - 1, cu * sinA + cv * cosA));
        const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1);
        const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1);
        const tx = fx - x0, ty = fy - y0;
        const rawInk = (
          chan[y0*w+x0]*(1-tx)*(1-ty) + chan[y0*w+x1]*tx*(1-ty) +
          chan[y1*w+x0]*(1-tx)*ty     + chan[y1*w+x1]*tx*ty
        ) / 255;

        // Highlight clip + smooth fade
        let fI = rawInk <= hClip ? 0 : rawInk < hClip+hFade ? rawInk*((rawInk-hClip)/hFade) : rawInk;
        // Shadow clip + smooth fade
        if (sClip > 0) {
          const gap = 1 - fI;
          if (gap <= sClip) fI = 1;
          else if (gap < sClip+sFade) fI = 1 - gap*((gap-sClip)/sFade);
        }
        const ink = Math.max(0, fI - dg*fI*(1-fI)*4);

        // Precompute shape-specific values for O(1) per-pixel lookup
        switch (ht.shape) {
          case 'round': {
            cellR = maxR * Math.sqrt(ink / (Math.PI / 4));
            cellR2 = cellR * cellR;
            const ro = cellR + AA_H, ri = Math.max(0, cellR - AA_H);
            cellAaOut2 = ro*ro; cellAaIn2 = ri*ri;
            break;
          }
          case 'euclidean': {
            const er = maxR * Math.sqrt(Math.min(ink, 1-ink) / (Math.PI / 4));
            cellR = er; cellR2 = er*er; cellInv = ink > 0.5;
            const ro = er + AA_H, ri = Math.max(0, er - AA_H);
            cellAaOut2 = ro*ro; cellAaIn2 = ri*ri;
            break;
          }
          case 'ellipse': {
            cellEllInv = ink >= Math.PI / 4;
            const baseR = cellEllInv
              ? maxR * Math.sqrt((1-ink) / (Math.PI/4))
              : maxR * Math.sqrt(ink / (Math.PI/4));
            const a = baseR * 1.4, b = baseR / 1.4;
            cellEllA2 = a*a; cellEllB2 = b*b; cellEllAMin = b;
            break;
          }
          case 'line':
            cellLinMax = ink * maxR;
            break;
          case 'square':
            cellHs = maxR * Math.sqrt(ink);
            break;
          case 'diamond':
            cellDiamT = maxR * Math.sqrt(2 * Math.min(ink, 1-ink));
            cellInv = ink >= 0.5;
            break;
        }
      }

      // ── Per-pixel signed-distance coverage ───────────────────────────────
      const du = su - (cellX + 0.5) * cs;
      const dv = sv - (cellY + 0.5) * cs;
      let cov: number;

      switch (ht.shape) {
        case 'round': {
          const d2 = du*du + dv*dv;
          if (d2 >= cellAaOut2) { cov = 0; break; }
          if (d2 <= cellAaIn2)  { cov = 255; break; }
          cov = Math.round(Math.max(0, Math.min(1, 0.5 - (Math.sqrt(d2) - cellR) / AA)) * 255);
          break;
        }
        case 'euclidean': {
          const d2 = du*du + dv*dv;
          if (!cellInv) {
            if (d2 >= cellAaOut2) { cov = 0; break; }
            if (d2 <= cellAaIn2)  { cov = 255; break; }
            cov = Math.round(Math.max(0, Math.min(1, 0.5 - (Math.sqrt(d2) - cellR) / AA)) * 255);
          } else {
            if (d2 >= cellAaOut2) { cov = 255; break; }
            if (d2 <= cellAaIn2)  { cov = 0; break; }
            cov = Math.round(Math.max(0, Math.min(1, 0.5 - (cellR - Math.sqrt(d2)) / AA)) * 255);
          }
          break;
        }
        case 'ellipse': {
          const rho = Math.sqrt(du*du/Math.max(1e-6, cellEllA2) + dv*dv/Math.max(1e-6, cellEllB2));
          const dist = cellEllInv ? (1 - rho) * cellEllAMin : (rho - 1) * cellEllAMin;
          cov = Math.round(Math.max(0, Math.min(1, 0.5 - dist / AA)) * 255);
          break;
        }
        case 'line': {
          cov = Math.round(Math.max(0, Math.min(1, 0.5 - (Math.abs(dv) - cellLinMax) / AA)) * 255);
          break;
        }
        case 'square': {
          cov = Math.round(Math.max(0, Math.min(1, 0.5 - (Math.max(Math.abs(du), Math.abs(dv)) - cellHs) / AA)) * 255);
          break;
        }
        case 'diamond': {
          const ml = (Math.abs(du) + Math.abs(dv)) / Math.SQRT2;
          const dist = cellInv ? cellDiamT/Math.SQRT2 - ml : ml - cellDiamT/Math.SQRT2;
          cov = Math.round(Math.max(0, Math.min(1, 0.5 - dist / AA)) * 255);
          break;
        }
        default:
          cov = 0;
      }

      if (cov > 0) mask[pi] = cov;
    }
  }
  // suppress unused variable warnings for cellR2
  void cellR2;
  return mask;
}

export function applyHalftoneToCmykPlates(
  plates:      CmykProPlates,
  settings:    ProCmykSettings,
  documentDpi: number,
  bgMask:      Uint8Array | null,
  whitePlate?: Uint8Array,  // optional white underbase (pre-choked)
): ProcessedLayer[] {
  const { width: w, height: h } = plates;
  const channelData = [plates.C, plates.M, plates.Y, plates.K];

  const halftones: ChannelHalftone[] = [
    resolveHalftone(settings.halftoneC, settings.angleC ?? 15, settings),
    resolveHalftone(settings.halftoneM, settings.angleM ?? 75, settings),
    resolveHalftone(settings.halftoneY, settings.angleY ?? 0,  settings),
    resolveHalftone(settings.halftoneK, settings.angleK ?? 45, settings),
  ];

  const layers: ProcessedLayer[] = CMYK_CHANNEL_INFO.map(({ id, name, color }, ci) => {
    const mask = rasterizeHalftoneChannel(channelData[ci], w, h, halftones[ci], documentDpi, bgMask);
    return { id, name, color, mask, visible: true } satisfies ProcessedLayer;
  });

  // Append white underbase layer when provided
  if (whitePlate) {
    const kHt = resolveHalftone(settings.halftoneK, settings.angleK ?? 45, settings);
    const whiteHt: ChannelHalftone = { ...kHt, angle: 22.5 };
    const whiteMask = rasterizeHalftoneChannel(whitePlate, w, h, whiteHt, documentDpi, bgMask);
    layers.push({ id: 'cmyk-w', name: 'White', color: [255, 255, 255], mask: whiteMask, visible: true });
  }

  return layers;
}
