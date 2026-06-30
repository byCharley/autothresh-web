export interface FabricBlendOptions {
  garmentType: 'light' | 'dark';
  blendStrength: number;  // 0–1
  textureDepth: number;   // 0–1
  canvasRgb: [number, number, number];
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function smoothstep(lo: number, hi: number, x: number): number {
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const t = (x - lo) / (hi - lo);
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function sampleBilinear(
  d: Uint8ClampedArray, w: number, h: number, u: number, v: number,
): [number, number, number] {
  const x = u * (w - 1);
  const y = v * (h - 1);
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;

  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;

  const inv = 1 / 255;
  const ifx = 1 - fx, ify = 1 - fy;

  return [
    ((d[i00]*inv)*ifx + (d[i10]*inv)*fx)*ify + ((d[i01]*inv)*ifx + (d[i11]*inv)*fx)*fy,
    ((d[i00+1]*inv)*ifx + (d[i10+1]*inv)*fx)*ify + ((d[i01+1]*inv)*ifx + (d[i11+1]*inv)*fx)*fy,
    ((d[i00+2]*inv)*ifx + (d[i10+2]*inv)*fx)*ify + ((d[i01+2]*inv)*ifx + (d[i11+2]*inv)*fx)*fy,
  ];
}

/**
 * Three-stage Blend If fabric engine:
 *
 * Stage 1 — Base integration (Blend Strength):
 *   Blends screen/multiply result toward raw fabric proportionally.
 *   At 0% → minimal fabric interaction; at 100% → heavily woven in.
 *
 * Stage 2 — Blend If shadow absorption (Blend Strength × fabric lum):
 *   Dark zones (wrinkle valleys, fiber gaps) absorb ink back toward fabric.
 *   Shadow zone is wide enough to create visible depth.
 *
 * Stage 3 — Direct grain overlay (Texture Depth):
 *   Per-pixel fabric variance (local lum − average) is added directly to the
 *   result. Brighter fibers lighten the print, darker fibers darken it.
 *   At 0% → smooth, grain-free; at 100% → full weave grain visible.
 */
export function applyFabricBlend(
  artData: ImageData,
  fabData: ImageData,
  opts: FabricBlendOptions,
): void {
  const { garmentType, blendStrength, textureDepth, canvasRgb } = opts;

  const { width, height, data } = artData;
  const fd = fabData.data;
  const fw = fabData.width, fh = fabData.height;
  const inv255 = 1 / 255;

  const bgR = canvasRgb[0] * inv255;
  const bgG = canvasRgb[1] * inv255;
  const bgB = canvasRgb[2] * inv255;

  // Average fabric luminance for grain variance computation
  let totalLum = 0;
  const np = fw * fh;
  for (let i = 0; i < fd.length; i += 4) {
    totalLum += luma(fd[i] * inv255, fd[i+1] * inv255, fd[i+2] * inv255);
  }
  const avgLum = totalLum / np;

  // Shadow zone: range where Blend If absorption activates.
  // Wide enough to give strong effect at high strength values.
  // Dark shirts: most charcoal fabric is 0.10–0.30; zone covers the lower half.
  // Light shirts: most jersey fabric is 0.60–0.95; zone covers the darker wrinkles.
  const LO = garmentType === 'dark' ? 0.04 : 0.20;
  const HI = garmentType === 'dark' ? 0.35 : 0.75;

  // Stage 1 pull-to-fabric coefficient (at 100% strength, artwork pulls 55% toward fabric).
  // Creates visible fabric presence in the print even in bright zones.
  const PULL = 0.55;

  const invW = width  > 1 ? 1 / (width  - 1) : 0;
  const invH = height > 1 ? 1 / (height - 1) : 0;

  for (let y = 0; y < height; y++) {
    const v = y * invH;
    for (let x = 0; x < width; x++) {
      const u = x * invW;
      const idx = (y * width + x) * 4;

      const aR = data[idx]   * inv255;
      const aG = data[idx+1] * inv255;
      const aB = data[idx+2] * inv255;

      const [fR, fG, fB] = sampleBilinear(fd, fw, fh, u, v);
      const localLum = luma(fR, fG, fB);

      // Blend If uses textureDepth to mix average vs local lum.
      // 0% → uniform absorption (no grain); 100% → full fiber-level variation.
      const effLum = avgLum + (localLum - avgLum) * textureDepth;

      // ── Artwork vs background detection ──────────────────────────────────────
      const dr = aR - bgR, dg = aG - bgG, db = aB - bgB;
      const artWeight = clamp01(Math.sqrt(dr*dr + dg*dg + db*db) * 4);

      // ── Blend mode (how artwork sits on fabric) ───────────────────────────────
      let bR: number, bG: number, bB: number;
      if (garmentType === 'light') {
        bR = aR * fR; bG = aG * fG; bB = aB * fB;      // multiply
      } else {
        bR = 1 - (1-aR)*(1-fR);                         // screen
        bG = 1 - (1-aG)*(1-fG);
        bB = 1 - (1-aB)*(1-fB);
      }

      // ── Stage 1: Base integration pull ───────────────────────────────────────
      // Pull screen/multiply result toward fabric by blendStrength × PULL.
      // Background pixels (artWeight≈0) already resolve to fabric; this only
      // affects actual artwork pixels, making them look woven into the substrate.
      const pull = blendStrength * PULL;
      const iR = bR + (fR - bR) * pull;
      const iG = bG + (fG - bG) * pull;
      const iB = bB + (fB - bB) * pull;

      // Apply artWeight: background → fabric, artwork → integrated result
      const eR = fR + (iR - fR) * artWeight;
      const eG = fG + (iG - fG) * artWeight;
      const eB = fB + (iB - fB) * artWeight;

      // ── Stage 2: Blend If shadow absorption ──────────────────────────────────
      // In darker shadow zones, blend further toward raw fabric.
      const shadowFactor = 1 - smoothstep(LO, HI, effLum);
      const shadowW = shadowFactor * blendStrength;

      let rR = eR + (fR - eR) * shadowW;
      let rG = eG + (fG - eG) * shadowW;
      let rB = eB + (fB - eB) * shadowW;

      // ── Stage 3: Direct grain overlay ────────────────────────────────────────
      // Add per-pixel fabric variance directly, independent of shadow zone.
      // This makes Texture Depth visibly affect the whole print, not just shadows.
      const grain = (localLum - avgLum) * textureDepth * blendStrength * 1.6;
      rR = clamp01(rR + grain);
      rG = clamp01(rG + grain);
      rB = clamp01(rB + grain);

      data[idx]   = (rR * 255 + 0.5) | 0;
      data[idx+1] = (rG * 255 + 0.5) | 0;
      data[idx+2] = (rB * 255 + 0.5) | 0;
    }
  }
}
