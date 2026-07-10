// Xerox / photocopy effect engine.
// Used by: XeroxTestPage (/xerox-test) and the Texture mode pipeline.

export type XeroxMode = 'fax' | 'hybrid';

export interface XeroxSettings {
  mode:            XeroxMode;
  fineStrength:    number;
  fineSize:        number;
  coarseStrength:  number;
  coarseSize:      number;
  chroma:          number;
  shadowWeight:    number;
  midWeight:       number;
  highlightWeight: number;
  threshold:       number;
  preBlur:         number;
  edgeEmphasis:    number;
  paperTexture:    number;
  seed:            number;
  inkR: number; inkG: number; inkB: number;
  paperR: number; paperG: number; paperB: number;
  posterizeLevels: number;
  colorBoost:      number;
}

export const DEFAULT_XEROX_FAX: XeroxSettings = {
  mode: 'fax',
  fineStrength: 1.6,   fineSize: 0.5,
  coarseStrength: 1.0, coarseSize: 2.0,
  chroma: 0.1,
  shadowWeight: 0.9, midWeight: 0.2, highlightWeight: 0.5,
  threshold: 0.40, preBlur: 0, edgeEmphasis: 0.6,
  paperTexture: 0.5, seed: 0,
  inkR: 28, inkG: 26, inkB: 24,
  paperR: 245, paperG: 242, paperB: 235,
  posterizeLevels: 2, colorBoost: 0,
};

export const DEFAULT_XEROX_HYBRID: XeroxSettings = {
  mode: 'hybrid',
  fineStrength: 1.92, fineSize: 0.89,
  coarseStrength: 0.65, coarseSize: 0.96,
  chroma: 0.31,
  shadowWeight: 0.18, midWeight: 0.52, highlightWeight: 0.43,
  threshold: 0.43, preBlur: 0, edgeEmphasis: 0.35,
  paperTexture: 0.50, seed: 0,
  inkR: 23, inkG: 23, inkB: 23,
  paperR: 245, paperG: 243, paperB: 238,
  posterizeLevels: 8, colorBoost: 0.33,
};

// ─── Noise ────────────────────────────────────────────────────────────────────

function h2(x: number, y: number, s: number): number {
  let n = (Math.imul(x, 1619) + Math.imul(y, 31337) + Math.imul(s, 1234567)) | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n >>> 0) / 0xffffffff;
}

export function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (
    h2(ix,     iy,     seed) * (1-ux) * (1-uy) +
    h2(ix + 1, iy,     seed) * ux     * (1-uy) +
    h2(ix,     iy + 1, seed) * (1-ux) * uy     +
    h2(ix + 1, iy + 1, seed) * ux     * uy
  );
}

function grainAt(x: number, y: number, size: number, seed: number): number {
  return vnoise(x / Math.max(0.1, size), y / Math.max(0.1, size), seed) * 2 - 1;
}

function tonalWeight(lum: number, sw: number, mw: number, hw: number): number {
  return Math.max(0, Math.min(1,
    sw * (1 - lum) +
    mw * (1 - Math.abs(lum - 0.5) * 2) +
    hw * lum
  ));
}

function boxBlur(d: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.length);
  const tmp = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, n = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.max(0, Math.min(w - 1, x + dx));
        const j = (y * w + nx) * 4;
        r0 += d[j]; g0 += d[j+1]; b0 += d[j+2]; n++;
      }
      const j = (y * w + x) * 4;
      tmp[j] = r0/n; tmp[j+1] = g0/n; tmp[j+2] = b0/n; tmp[j+3] = d[j+3];
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r0 = 0, g0 = 0, b0 = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.max(0, Math.min(h - 1, y + dy));
        const j = (ny * w + x) * 4;
        r0 += tmp[j]; g0 += tmp[j+1]; b0 += tmp[j+2]; n++;
      }
      const i = (y * w + x) * 4;
      out[i] = Math.round(r0/n); out[i+1] = Math.round(g0/n);
      out[i+2] = Math.round(b0/n); out[i+3] = d[i+3];
    }
  }
  return out;
}

function unsharpMask(d: Uint8ClampedArray, w: number, h: number, amount: number): Uint8ClampedArray {
  if (amount <= 0) return d;
  const blurred = boxBlur(d, w, h, 2);
  const out = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    out[i]   = Math.max(0, Math.min(255, d[i]   + (d[i]   - blurred[i])   * amount));
    out[i+1] = Math.max(0, Math.min(255, d[i+1] + (d[i+1] - blurred[i+1]) * amount));
    out[i+2] = Math.max(0, Math.min(255, d[i+2] + (d[i+2] - blurred[i+2]) * amount));
    out[i+3] = d[i+3];
  }
  return out;
}

function posterize(v: number, levels: number): number {
  return Math.round(v * (levels - 1)) / (levels - 1);
}

function boostSat(r: number, g: number, b: number, amount: number): [number, number, number] {
  const mean = (r + g + b) / 3;
  return [
    Math.max(0, Math.min(1, mean + (r - mean) * (1 + amount))),
    Math.max(0, Math.min(1, mean + (g - mean) * (1 + amount))),
    Math.max(0, Math.min(1, mean + (b - mean) * (1 + amount))),
  ];
}

// ─── Main engine ─────────────────────────────────────────────────────────────

export function runXerox(src: ImageData, cfg: XeroxSettings): ImageData {
  const { width: w, height: h } = src;
  let data = new Uint8ClampedArray(src.data);

  if (cfg.preBlur >= 1) data = boxBlur(data, w, h, Math.round(cfg.preBlur)) as Uint8ClampedArray<ArrayBuffer>;
  if (cfg.edgeEmphasis > 0) data = unsharpMask(data, w, h, cfg.edgeEmphasis) as Uint8ClampedArray<ArrayBuffer>;

  const out  = new Uint8ClampedArray(w * h * 4);
  const sc   = 0.22;
  const gs   = cfg.seed * 97;

  const [inkRn, inkGn, inkBn] = [cfg.inkR/255, cfg.inkG/255, cfg.inkB/255];
  const [papRn, papGn, papBn] = [cfg.paperR/255, cfg.paperG/255, cfg.paperB/255];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;

      let r = data[i]   / 255;
      let g = data[i+1] / 255;
      let b = data[i+2] / 255;

      if (cfg.chroma > 0) {
        const cs = cfg.chroma * 0.12;
        r = Math.max(0, Math.min(1, r + grainAt(x, y, cfg.fineSize, gs + 1) * cs));
        g = Math.max(0, Math.min(1, g + grainAt(x, y, cfg.fineSize, gs + 2) * cs));
        b = Math.max(0, Math.min(1, b + grainAt(x, y, cfg.fineSize, gs + 3) * cs));
      }

      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const tw  = tonalWeight(lum, cfg.shadowWeight, cfg.midWeight, cfg.highlightWeight);
      const n1  = grainAt(x, y, cfg.fineSize,    gs + 7)  * cfg.fineStrength   * tw * sc;
      const n2  = grainAt(x, y, cfg.coarseSize,  gs + 13) * cfg.coarseStrength * tw * sc;
      const nl  = Math.max(0, Math.min(1, lum + n1 + n2));

      let outR: number, outG: number, outB: number;

      if (cfg.mode === 'fax') {
        const isInk = nl < cfg.threshold;
        outR = isInk ? inkRn : papRn;
        outG = isInk ? inkGn : papGn;
        outB = isInk ? inkBn : papBn;

      } else {
        const ratio = lum > 0.01 ? nl / lum : 1;
        let cr = Math.max(0, Math.min(1, r * ratio));
        let cg = Math.max(0, Math.min(1, g * ratio));
        let cb = Math.max(0, Math.min(1, b * ratio));

        if (cfg.colorBoost > 0) [cr, cg, cb] = boostSat(cr, cg, cb, cfg.colorBoost);

        const lvl = Math.max(2, Math.round(cfg.posterizeLevels));
        cr = posterize(cr, lvl);
        cg = posterize(cg, lvl);
        cb = posterize(cb, lvl);

        const darkEdge  = cfg.threshold * 0.55;
        const lightEdge = 1 - cfg.threshold * 0.45;

        if (nl < darkEdge) {
          const t = nl / darkEdge;
          outR = inkRn + (cr - inkRn) * t;
          outG = inkGn + (cg - inkGn) * t;
          outB = inkBn + (cb - inkBn) * t;
        } else if (nl > lightEdge) {
          const t = (nl - lightEdge) / (1 - lightEdge);
          outR = cr + (papRn - cr) * t;
          outG = cg + (papGn - cg) * t;
          outB = cb + (papBn - cb) * t;
        } else {
          outR = cr; outG = cg; outB = cb;
        }
      }

      // Paper texture — smooth large-scale noise multiplied over every pixel
      if (cfg.paperTexture > 0) {
        const pn    = vnoise(x / 10.0, y / 10.0, gs + 99);
        const factor = 1 - cfg.paperTexture * (1 - (0.82 + pn * 0.18));
        outR *= factor; outG *= factor; outB *= factor;
      }

      out[i]   = Math.round(Math.max(0, Math.min(1, outR)) * 255);
      out[i+1] = Math.round(Math.max(0, Math.min(1, outG)) * 255);
      out[i+2] = Math.round(Math.max(0, Math.min(1, outB)) * 255);
      out[i+3] = src.data[i+3];
    }
  }

  return new ImageData(out, w, h);
}
