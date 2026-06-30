import type { ProcessedLayer } from './imageProcessor';
import type { CmykProPlates } from './cmykProEngine';

// Lab D50 → linear sRGB (for ink reflectance computation)
function labToLinear(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const f3 = (t: number) => t > 0.20689 ? t * t * t : (t - 16 / 116) / 7.787;
  const Xd50 = 0.9642 * f3(fx);
  const Yd50 = 1.0000 * f3(fy);
  const Zd50 = 0.8249 * f3(fz);
  // Bradford D50 → D65 chromatic adaptation
  const X =  Xd50 *  0.9555766 + Yd50 * -0.0230393 + Zd50 *  0.0631636;
  const Y =  Xd50 * -0.0282895 + Yd50 *  1.0099416 + Zd50 *  0.0210077;
  const Z =  Xd50 *  0.0122982 + Yd50 * -0.0204830 + Zd50 *  1.3299098;
  // XYZ D65 → linear sRGB (IEC 61966-2-1)
  return [
    Math.max(0,  X *  3.2404542 + Y * -1.5371385 + Z * -0.4985314),
    Math.max(0,  X * -0.9692660 + Y *  1.8760108 + Z *  0.0415560),
    Math.max(0,  X *  0.0556434 + Y * -0.2040259 + Z *  1.0572252),
  ];
}

function srgbEncode(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

// Per-profile ink Lab D50 primaries (100% single-ink on coated paper)
// Sourced from ISO 12647-2 and FOGRA measurement datasets
const PROFILE_INK_LAB: Record<string, {
  C: [number, number, number]; M: [number, number, number];
  Y: [number, number, number]; K: [number, number, number];
  paper: [number, number, number];
}> = {
  USWebCoatedSWOP:     { C: [57, -34, -46], M: [52,  68, -3], Y: [91,  -4, 87], K: [18, 0, 0], paper: [95, 0, 2] },
  CoatedFOGRA39:       { C: [54, -37, -50], M: [48,  74, -3], Y: [89,  -5, 93], K: [16, 0, 0], paper: [95, 0, 3] },
  JapanColor2001Coated:{ C: [55, -34, -44], M: [50,  66, -2], Y: [90,  -4, 88], K: [17, 0, 0], paper: [94, 0, 3] },
  WebCoatedFOGRA28:    { C: [56, -35, -47], M: [50,  70, -3], Y: [90,  -4, 89], K: [17, 0, 0], paper: [94, 0, 3] },
};

// Build 16-entry Neugebauer primary lookup table.
// Bit encoding: bit0=C, bit1=M, bit2=Y, bit3=K → 0=paper, 1=C, 2=M, …, 15=CMYK
// Returns Uint8Array of [R,G,B] × 16
export function buildNeugebauerPrimaries(profileName: string): Uint8Array {
  const def = PROFILE_INK_LAB[profileName] ?? PROFILE_INK_LAB['USWebCoatedSWOP'];

  const [pR, pG, pB] = labToLinear(...def.paper);
  const [cR, cG, cB] = labToLinear(...def.C);
  const [mR, mG, mB] = labToLinear(...def.M);
  const [yR, yG, yB] = labToLinear(...def.Y);
  const [kR, kG, kB] = labToLinear(...def.K);

  // Each ink's transmittance = R_ink / R_substrate (element-wise)
  // Combined: R = R_paper × ∏(T_i) for all present inks
  const table = new Uint8Array(16 * 3);
  for (let i = 0; i < 16; i++) {
    const hasC = (i & 1) !== 0;
    const hasM = (i & 2) !== 0;
    const hasY = (i & 4) !== 0;
    const hasK = (i & 8) !== 0;

    let r = pR, g = pG, bl = pB;
    if (hasC) { r *= cR / Math.max(1e-5, pR); g *= cG / Math.max(1e-5, pG); bl *= cB / Math.max(1e-5, pB); }
    if (hasM) { r *= mR / Math.max(1e-5, pR); g *= mG / Math.max(1e-5, pG); bl *= mB / Math.max(1e-5, pB); }
    if (hasY) { r *= yR / Math.max(1e-5, pR); g *= yG / Math.max(1e-5, pG); bl *= yB / Math.max(1e-5, pB); }
    if (hasK) { r *= kR / Math.max(1e-5, pR); g *= kG / Math.max(1e-5, pG); bl *= kB / Math.max(1e-5, pB); }

    table[i * 3]     = srgbEncode(r);
    table[i * 3 + 1] = srgbEncode(g);
    table[i * 3 + 2] = srgbEncode(bl);
  }
  return table;
}

// Composite halftone masks using the Neugebauer lookup table.
//
// garmentMode controls the substrate simulation:
//   'light'  — white/paper garment: no-ink pixels use Neugebauer[0] (paper white)
//   'dark'   — dark garment with white underbase: no-ink pixels inside artwork = pure white (255),
//              transparent pixels (bgMask) show garment color through alpha=0
//
// Transparent pixels (bgMask[i] === 255) are always left at alpha=0 so the canvas fabric
// color shows through, correctly rendering the garment outside the print area.
export function compositeHalftonePlates(
  allLayers: ProcessedLayer[],
  width: number,
  height: number,
  neugebauer: Uint8Array,
  bgMask: Uint8Array | null,
  vis: { c: boolean; m: boolean; y: boolean; k: boolean },
  garmentMode: 'light' | 'dark' = 'light',
  garmentRgb?: [number, number, number],
): ImageData {
  const data  = new Uint8ClampedArray(width * height * 4);
  const cMask = allLayers.find(l => l.id === 'cmyk-c')?.mask;
  const mMask = allLayers.find(l => l.id === 'cmyk-m')?.mask;
  const yMask = allLayers.find(l => l.id === 'cmyk-y')?.mask;
  const kMask = allLayers.find(l => l.id === 'cmyk-k')?.mask;
  // Look up white underbase mask outside the per-pixel loop for performance
  const wMask = allLayers.find(l => l.id === 'cmyk-w')?.mask;
  const n     = width * height;

  for (let i = 0; i < n; i++) {
    if (bgMask && bgMask[i] === 255) continue; // transparent — garment color shows through

    const cv = vis.c ? (cMask?.[i] ?? 0) / 255 : 0;
    const mv = vis.m ? (mMask?.[i] ?? 0) / 255 : 0;
    const yv = vis.y ? (yMask?.[i] ?? 0) / 255 : 0;
    const kv = vis.k ? (kMask?.[i] ?? 0) / 255 : 0;

    // Fast path: fully binary pixel (no AA blending needed)
    const isBinary = (cv === 0 || cv === 1) && (mv === 0 || mv === 1) && (yv === 0 || yv === 1) && (kv === 0 || kv === 1);
    if (isBinary) {
      const idx = (cv ? 1 : 0) | (mv ? 2 : 0) | (yv ? 4 : 0) | (kv ? 8 : 0);
      if (garmentMode === 'dark' && idx === 0) {
        if (wMask && garmentRgb) {
          const wv = wMask[i] / 255;
          const [gr, gg, gb] = garmentRgb;
          data[i*4]   = Math.round(gr*(1-wv) + 255*wv);
          data[i*4+1] = Math.round(gg*(1-wv) + 255*wv);
          data[i*4+2] = Math.round(gb*(1-wv) + 255*wv);
          data[i*4+3] = 255;
        } else {
          // Legacy: full white substrate approximation
          data[i*4]=255; data[i*4+1]=255; data[i*4+2]=255; data[i*4+3]=255;
        }
      } else {
        data[i*4]=neugebauer[idx*3]; data[i*4+1]=neugebauer[idx*3+1]; data[i*4+2]=neugebauer[idx*3+2]; data[i*4+3]=255;
      }
      continue;
    }

    // AA edge pixel: quadrilinear blend across all 16 Neugebauer primaries,
    // weighted by fractional ink coverage (the Neugebauer equation proper).
    let r = 0, g = 0, b = 0;
    const wvAA = wMask ? wMask[i] / 255 : 1;
    for (let combo = 0; combo < 16; combo++) {
      const w = ((combo&1)?cv:(1-cv)) * ((combo&2)?mv:(1-mv)) * ((combo&4)?yv:(1-yv)) * ((combo&8)?kv:(1-kv));
      if (w <= 0) continue;
      if (garmentMode === 'dark' && combo === 0) {
        if (wMask && garmentRgb) {
          r += (garmentRgb[0]*(1-wvAA) + 255*wvAA) * w;
          g += (garmentRgb[1]*(1-wvAA) + 255*wvAA) * w;
          b += (garmentRgb[2]*(1-wvAA) + 255*wvAA) * w;
        } else {
          r += 255*w; g += 255*w; b += 255*w;
        }
      } else {
        r += neugebauer[combo*3] * w; g += neugebauer[combo*3+1] * w; b += neugebauer[combo*3+2] * w;
      }
    }
    data[i*4]=r; data[i*4+1]=g; data[i*4+2]=b; data[i*4+3]=255;
  }

  return new ImageData(data, width, height);
}

// ── Supersampling utilities ───────────────────────────────────────────────────

// Bilinear upsample for a Uint8Array plate (continuous ink coverage values)
function bilinearUpsamplePlate(src: Uint8Array, w: number, h: number, scale: number): Uint8Array {
  const W = w * scale, H = h * scale;
  const dst = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) * h / H - 0.5;
    const y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) * w / W - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1);
      const tx = sx - x0;
      dst[y * W + x] = Math.round(
        src[y0*w+x0]*(1-tx)*(1-ty) + src[y0*w+x1]*tx*(1-ty) +
        src[y1*w+x0]*(1-tx)*ty     + src[y1*w+x1]*tx*ty,
      );
    }
  }
  return dst;
}

// Upsample all 4 CMYK plates to scale× their current dimensions
export function upsampleCmykPlates(plates: CmykProPlates, scale: number): CmykProPlates {
  const { C, M, Y, K, width: w, height: h } = plates;
  return {
    C: bilinearUpsamplePlate(C, w, h, scale),
    M: bilinearUpsamplePlate(M, w, h, scale),
    Y: bilinearUpsamplePlate(Y, w, h, scale),
    K: bilinearUpsamplePlate(K, w, h, scale),
    width: w * scale, height: h * scale,
  };
}

// Nearest-neighbor upsample for a binary bg mask (0 = print area, 255 = background)
export function upsampleMask(src: Uint8Array, w: number, h: number, scale: number): Uint8Array {
  const W = w * scale, H = h * scale;
  const dst = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor(y / scale));
    for (let x = 0; x < W; x++) {
      dst[y * W + x] = src[sy * w + Math.min(w - 1, Math.floor(x / scale))];
    }
  }
  return dst;
}

// Area-average downsample — averages every (scaleX × scaleY) pixel block.
// This is what makes halftone dots optically blend into smooth tones, simulating
// what the eye perceives when viewing a print at normal distance.
export function areaAverageDownsample(src: ImageData, tW: number, tH: number): ImageData {
  const { width: sw, height: sh, data: sd } = src;
  const scaleX = sw / tW, scaleY = sh / tH;
  const dst = new Uint8ClampedArray(tW * tH * 4);

  for (let y = 0; y < tH; y++) {
    const y0 = Math.floor(y * scaleY), y1 = Math.min(sh, Math.ceil((y + 1) * scaleY));
    for (let x = 0; x < tW; x++) {
      const x0 = Math.floor(x * scaleX), x1 = Math.min(sw, Math.ceil((x + 1) * scaleX));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += sd[i]; g += sd[i+1]; b += sd[i+2]; a += sd[i+3];
          n++;
        }
      }
      const di = (y * tW + x) * 4;
      dst[di] = r/n; dst[di+1] = g/n; dst[di+2] = b/n; dst[di+3] = a/n;
    }
  }
  return new ImageData(dst, tW, tH);
}
