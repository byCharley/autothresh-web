import type { VercelRequest, VercelResponse } from '@vercel/node';
import sharp from 'sharp';
import path from 'path';

export interface CmykSepRequest {
  imageBase64: string;
  settings: {
    cmykProfile: 'USWebCoatedSWOP' | 'CoatedFOGRA39' | 'WebCoatedFOGRA28' | 'JapanColor2001Coated';
    blackGeneration: 'light' | 'medium' | 'heavy' | 'maximum';
    totalInkLimit: number;   // 200–400 (%)
    preservePureBlack: boolean;
    densityC: number;        // 50–150 (100 = normal)
    densityM: number;
    densityY: number;
    densityK: number;
    grayBalance: number;     // -50 to +50
  };
}

export interface CmykSepResponse {
  width: number;
  height: number;
  C: string; // base64 raw grayscale bytes (one byte per pixel)
  M: string;
  Y: string;
  K: string;
}

// ICC_DIR reserved for future custom profile loading
const _ICC_DIR = path.join(process.cwd(), 'api', 'icc'); void _ICC_DIR;

// Black generation: how much to shift gray component from CMY → K
// Negative = lighter (pull from K into CMY), positive = heavier (push to K)
const BG_FACTOR: Record<string, number> = {
  light:   -0.25,
  medium:   0.0,
  heavy:    0.35,
  maximum:  0.70,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, settings } = req.body as CmykSepRequest;
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const inputBuffer = Buffer.from(base64Data, 'base64');

    // ── RGB → CMYK via libvips / LittleCMS ───────────────────────────────
    // sharp/libvips uses LittleCMS internally. The input is treated as sRGB.
    // .toColorspace('cmyk') applies a proper perceptual conversion.
    const { data: rawCmyk, info } = await sharp(inputBuffer)
      .removeAlpha()
      .toColorspace('cmyk')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const numPixels = info.width * info.height;

    // Extract interleaved CMYK into separate Float32 channels (0–1 range)
    const C = new Float32Array(numPixels);
    const M = new Float32Array(numPixels);
    const Y = new Float32Array(numPixels);
    const K = new Float32Array(numPixels);

    for (let i = 0; i < numPixels; i++) {
      C[i] = rawCmyk[i * 4]     / 255;
      M[i] = rawCmyk[i * 4 + 1] / 255;
      Y[i] = rawCmyk[i * 4 + 2] / 255;
      K[i] = rawCmyk[i * 4 + 3] / 255;
    }

    // ── Black generation adjustment ───────────────────────────────────────
    // Post-process the ICC output to shift the gray balance between K and CMY.
    const bgFactor = BG_FACTOR[settings.blackGeneration ?? 'medium'] ?? 0;
    if (bgFactor !== 0) {
      for (let i = 0; i < numPixels; i++) {
        const c = C[i], m = M[i], y = Y[i], k = K[i];
        const gray = Math.min(c, m, y);
        if (gray < 0.005) continue;

        if (bgFactor > 0) {
          // Push gray component from CMY → K
          const shift = Math.min(bgFactor * gray, gray * 0.95, 1 - k);
          const ratio = shift / gray;
          C[i] = c - ratio * c;
          M[i] = m - ratio * m;
          Y[i] = y - ratio * y;
          K[i] = Math.min(1, k + shift);
        } else {
          // Pull from K → distribute back into CMY
          const pull = Math.min(-bgFactor * gray, k * 0.9);
          C[i] = Math.min(1, c + pull);
          M[i] = Math.min(1, m + pull);
          Y[i] = Math.min(1, y + pull);
          K[i] = Math.max(0, k - pull);
        }
      }
    }

    // ── Preserve pure black ───────────────────────────────────────────────
    if (settings.preservePureBlack) {
      for (let i = 0; i < numPixels; i++) {
        if (C[i] < 0.06 && M[i] < 0.06 && Y[i] < 0.06 && K[i] > 0.75) {
          C[i] = 0; M[i] = 0; Y[i] = 0; K[i] = 1;
        }
      }
    }

    // ── Gray balance (C bias) ─────────────────────────────────────────────
    const gb = (settings.grayBalance ?? 0) / 300; // small correction
    if (Math.abs(gb) > 0.001) {
      for (let i = 0; i < numPixels; i++) {
        C[i] = Math.min(1, Math.max(0, C[i] * (1 + gb)));
      }
    }

    // ── Per-channel density ───────────────────────────────────────────────
    const dC = (settings.densityC ?? 100) / 100;
    const dM = (settings.densityM ?? 100) / 100;
    const dY = (settings.densityY ?? 100) / 100;
    const dK = (settings.densityK ?? 100) / 100;
    if (dC !== 1 || dM !== 1 || dY !== 1 || dK !== 1) {
      for (let i = 0; i < numPixels; i++) {
        C[i] = Math.min(1, C[i] * dC);
        M[i] = Math.min(1, M[i] * dM);
        Y[i] = Math.min(1, Y[i] * dY);
        K[i] = Math.min(1, K[i] * dK);
      }
    }

    // ── Total Ink Coverage limit ──────────────────────────────────────────
    const tacNorm = (settings.totalInkLimit ?? 300) / 100; // 300% → 3.0
    for (let i = 0; i < numPixels; i++) {
      const total = C[i] + M[i] + Y[i] + K[i];
      if (total > tacNorm) {
        const scale = tacNorm / total;
        C[i] *= scale; M[i] *= scale; Y[i] *= scale; K[i] *= scale;
      }
    }

    // ── Pack to Uint8 ─────────────────────────────────────────────────────
    const cOut = Buffer.alloc(numPixels);
    const mOut = Buffer.alloc(numPixels);
    const yOut = Buffer.alloc(numPixels);
    const kOut = Buffer.alloc(numPixels);
    for (let i = 0; i < numPixels; i++) {
      cOut[i] = Math.round(C[i] * 255);
      mOut[i] = Math.round(M[i] * 255);
      yOut[i] = Math.round(Y[i] * 255);
      kOut[i] = Math.round(K[i] * 255);
    }

    const response: CmykSepResponse = {
      width:  info.width,
      height: info.height,
      C: cOut.toString('base64'),
      M: mOut.toString('base64'),
      Y: yOut.toString('base64'),
      K: kOut.toString('base64'),
    };

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(response);

  } catch (err) {
    console.error('[cmyk-separate]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Separation failed' });
  }
}
