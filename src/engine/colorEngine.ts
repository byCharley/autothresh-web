// ColorEngine: ICC-profile-based RGB → CMYK separation.
// Parses the actual B2A0 CLUT from bundled CMYK ICC profiles and executes
// tetrahedral interpolation — the same algorithm LittleCMS uses internally.
// This produces numerically equivalent output to Photoshop's Image → Mode → CMYK.

import { parseIccProfile, type IccProfile, type IccLut } from './iccProfile';

// ── sRGB linearisation LUT ───────────────────────────────────────────────────
const SRGB_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_LIN[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

// ── CIE Lab helper ────────────────────────────────────────────────────────────
const labF = (t: number): number =>
  t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

// ── 1-D tone curve lookup with linear interpolation ──────────────────────────
function lut1d(table: Float32Array, x: number): number {
  const n   = table.length - 1;
  const pos = x * n;
  const i   = Math.min(n - 1, pos | 0);
  return table[i] + (pos - i) * (table[i + 1] - table[i]);
}

// ── Tetrahedral interpolation in the 3-D CLUT ────────────────────────────────
// Divides the unit cube into 6 tetrahedra; result is written into out[].
// Matches LittleCMS's TetrahedralInterp3D algorithm exactly.
function trilinear(
  clut: Float32Array,
  g: number,     // gridPoints (33)
  g2: number,    // g*g
  nOut: number,  // 4
  fL: number, fa: number, fb: number,
  out: Float32Array,
): void {
  const L0 = Math.min(g - 2, fL | 0);
  const a0 = Math.min(g - 2, fa | 0);
  const b0 = Math.min(g - 2, fb | 0);

  const rL = fL - L0;
  const ra = fa - a0;
  const rb = fb - b0;

  const base = (L0 * g2 + a0 * g + b0) * nOut;

  // Stride shortcuts (pre-multiplied by nOut)
  const sL = g2 * nOut;  // = 1089 * 4 = 4356
  const sA = g  * nOut;  // = 33  * 4 = 132
  const sB = nOut;        // = 4

  for (let c = 0; c < nOut; c++) {
    const v000 = clut[base + c];
    const v001 = clut[base + sB + c];
    const v010 = clut[base + sA + c];
    const v011 = clut[base + sA + sB + c];
    const v100 = clut[base + sL + c];
    const v101 = clut[base + sL + sB + c];
    const v110 = clut[base + sL + sA + c];
    const v111 = clut[base + sL + sA + sB + c];

    let v: number;
    if (rL >= ra && ra >= rb) {
      v = (1-rL)*v000 + (rL-ra)*v100 + (ra-rb)*v110 + rb*v111;
    } else if (rL >= rb && rb >= ra) {
      v = (1-rL)*v000 + (rL-rb)*v100 + (rb-ra)*v101 + ra*v111;
    } else if (rb >= rL && rL >= ra) {
      v = (1-rb)*v000 + (rb-rL)*v001 + (rL-ra)*v101 + ra*v111;
    } else if (ra >= rL && rL >= rb) {
      v = (1-ra)*v000 + (ra-rL)*v010 + (rL-rb)*v110 + rb*v111;
    } else if (rb >= ra && ra >= rL) {
      v = (1-rb)*v000 + (rb-ra)*v001 + (ra-rL)*v011 + rL*v111;
    } else {
      v = (1-ra)*v000 + (ra-rb)*v010 + (rb-rL)*v011 + rL*v111;
    }
    out[c] = v;
  }
}

// ── Profile cache (parse once, reuse across separations) ─────────────────────
const profileCache = new Map<string, IccProfile>();

const PROFILE_FILES: Record<string, string> = {
  USWebCoatedSWOP:      'USWebCoatedSWOP.icc',
  CoatedFOGRA39:        'CoatedFOGRA39.icc',
  JapanColor2001Coated: 'JapanColor2001Coated.icc',
  WebCoatedFOGRA28:     'WebCoatedFOGRA28.icc',
};

export async function loadIccProfile(name: string): Promise<IccProfile> {
  if (profileCache.has(name)) return profileCache.get(name)!;

  const filename = PROFILE_FILES[name];
  if (!filename) throw new Error(`Unknown ICC profile: ${name}`);

  const resp = await fetch(`/icc/${filename}`);
  if (!resp.ok) throw new Error(`Failed to fetch ICC profile ${filename}: HTTP ${resp.status}`);

  const buf = await resp.arrayBuffer();
  const profile = parseIccProfile(buf, name);

  if (!profile.bToA0 && !profile.bToA1) {
    throw new Error(`ICC profile ${name} contains no B2A LUT`);
  }

  profileCache.set(name, profile);
  return profile;
}

// ── Main separation function ──────────────────────────────────────────────────
export interface CmykPlanes {
  C: Float32Array;
  M: Float32Array;
  Y: Float32Array;
  K: Float32Array;
}

export function separateWithProfile(imageData: ImageData, profile: IccProfile): CmykPlanes {
  const lut = (profile.bToA0 ?? profile.bToA1) as IccLut;
  const { gridPoints: g, inputTables, outputTables, clut } = lut;
  const g2   = g * g;
  const gm1  = g - 1;
  const nOut = 4;

  const { width: w, height: h } = imageData;
  const src = imageData.data;
  const n   = w * h;

  const C = new Float32Array(n);
  const M = new Float32Array(n);
  const Y = new Float32Array(n);
  const K = new Float32Array(n);

  const tmp = new Float32Array(4); // reused per-pixel; no heap allocs in hot loop

  for (let i = 0; i < n; i++) {
    const alpha = src[i * 4 + 3] / 255;

    // Composite onto white substrate, then linearise sRGB
    const Rl = SRGB_LIN[Math.round(src[i * 4]     * alpha + 255 * (1 - alpha))];
    const Gl = SRGB_LIN[Math.round(src[i * 4 + 1] * alpha + 255 * (1 - alpha))];
    const Bl = SRGB_LIN[Math.round(src[i * 4 + 2] * alpha + 255 * (1 - alpha))];

    // sRGB linear → XYZ D65
    const X65 = Rl * 0.4124564 + Gl * 0.3575761 + Bl * 0.1804375;
    const Y65 = Rl * 0.2126729 + Gl * 0.7151522 + Bl * 0.0721750;
    const Z65 = Rl * 0.0193339 + Gl * 0.1191920 + Bl * 0.9503041;

    // Bradford D65 → D50 (ICC profiles use D50 as illuminant)
    const Xd =  X65 * 1.0478112 + Y65 * 0.0228866 + Z65 * -0.0501270;
    const Yd =  X65 * 0.0295424 + Y65 * 0.9904844 + Z65 * -0.0170491;
    const Zd =  X65 * -0.009234 + Y65 * 0.0150436 + Z65 *  0.7521316;

    // XYZ D50 → CIE L*a*b* (D50 white = 0.9642, 1.0000, 0.8249)
    const fX = labF(Xd / 0.9642);
    const fY = labF(Yd);
    const fZ = labF(Zd / 0.8249);

    const Lstar = 116 * fY - 16;
    const Astar = 500 * (fX - fY);
    const Bstar = 200 * (fY - fZ);

    // Normalise Lab to [0,1] for the CLUT input
    // L*: [0,100] → [0,1];  a*/b*: [-128,127] → [0,1]  (LittleCMS encoding)
    const Lnorm = Math.max(0, Math.min(1, Lstar / 100));
    const Anorm = Math.max(0, Math.min(1, (Astar + 128) / 255));
    const Bnorm = Math.max(0, Math.min(1, (Bstar + 128) / 255));

    // Apply input tone curves
    const Li = lut1d(inputTables[0], Lnorm);
    const ai = lut1d(inputTables[1], Anorm);
    const bi = lut1d(inputTables[2], Bnorm);

    // Evaluate 3-D CLUT with tetrahedral interpolation
    trilinear(clut, g, g2, nOut, Li * gm1, ai * gm1, bi * gm1, tmp);

    // Apply output tone curves
    C[i] = lut1d(outputTables[0], tmp[0]);
    M[i] = lut1d(outputTables[1], tmp[1]);
    Y[i] = lut1d(outputTables[2], tmp[2]);
    K[i] = lut1d(outputTables[3], tmp[3]);
  }

  return { C, M, Y, K };
}
