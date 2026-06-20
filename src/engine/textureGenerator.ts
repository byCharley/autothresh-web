// ─── Texture Generator ───────────────────────────────────────────────────────
// generateTextureMask() returns a binary mask (255=ink, 0=removed).
//
// When a PNG has been loaded via textureLoader, it is used directly — the real
// scanned plastisol texture is tiled across the mask with a seeded random offset
// so every Randomize press gives a different section of the original scan.
//
// If no PNG is present (file missing / not yet loaded) the function falls back
// to a simple procedural mask so the UI is always functional.

import { getCachedTexture } from './textureLoader';
import type { TextureType } from './textureLoader';

export type { TextureType };

// ─── Primitive hash (no vnoise needed for the image path) ────────────────────

function hash2d(ix: number, iy: number, seed: number): number {
  let n = (ix + Math.imul(iy, 57) + Math.imul(seed, 131)) | 0;
  n = (n ^ (n << 13)) | 0;
  n = (n ^ Math.imul(n, (Math.imul(n, Math.imul(n, 15731) + 789221) + 1376312589) | 0)) | 0;
  return (n >>> 0) / 0xffffffff;
}

function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (
    hash2d(ix,     iy,     seed) * (1 - ux) * (1 - uy) +
    hash2d(ix + 1, iy,     seed) * ux       * (1 - uy) +
    hash2d(ix,     iy + 1, seed) * (1 - ux) * uy +
    hash2d(ix + 1, iy + 1, seed) * ux       * uy
  );
}

// ─── Image-based mask (used when PNG is loaded) ───────────────────────────────
//
// The texture is tiled across the output mask.
//
// `scale`     — zoom into the texture. scale=1 → 1 texture pixel per output pixel.
//               scale=2 → texture features appear 2× larger in the mask.
//               scale=0.5 → features appear half-size (more texture fits).
//
// `intensity` — threshold on the texture's brightness.
//               0 = no cracks (threshold so high nothing passes).
//               100 = maximum cracking (dark AND mid-gray pixels become cracks).
//
// `seed`      — picks a random (x, y) tile offset so every press of Randomize
//               pulls a different section from the original scan.

function applyImageTexture(
  type:      TextureType,
  w:         number,
  h:         number,
  intensity: number,
  scale:     number,
  seed:      number,
): Uint8Array {
  const tex  = getCachedTexture(type)!;
  const mask = new Uint8Array(w * h).fill(255);

  // Random tile offset — different section of the scan each seed
  const ox = Math.floor(hash2d(seed,     0, 0xcafe_babe) * tex.w);
  const oy = Math.floor(hash2d(seed + 1, 0, 0xcafe_babe) * tex.h);

  // ts: texture pixels per output pixel
  // scale=1 → ts=1 (1:1 native resolution)
  // scale>1 → ts<1 (zoom in: texture features appear larger)
  const ts = 1 / scale;

  // Threshold: pixels DARKER than this value become cracks.
  // Intensity 0 → threshold 10 (only pure-black survives → almost no cracks).
  // Intensity 100 → threshold 220 (dark + mid-gray become cracks → heavy distress).
  const threshold = Math.round(10 + (intensity / 100) * 210);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Bilinear interpolation — eliminates pixel-grid aliasing in the tiled texture
      const txf = ((x * ts + ox) % tex.w + tex.w) % tex.w;
      const tyf = ((y * ts + oy) % tex.h + tex.h) % tex.h;
      const tx0 = Math.floor(txf), ty0 = Math.floor(tyf);
      const tx1 = (tx0 + 1) % tex.w, ty1 = (ty0 + 1) % tex.h;
      const fx = txf - tx0, fy = tyf - ty0;
      const v = tex.pixels[ty0 * tex.w + tx0] * (1 - fx) * (1 - fy)
              + tex.pixels[ty0 * tex.w + tx1] * fx       * (1 - fy)
              + tex.pixels[ty1 * tex.w + tx0] * (1 - fx) * fy
              + tex.pixels[ty1 * tex.w + tx1] * fx       * fy;
      if (v < threshold) mask[y * w + x] = 0;
    }
  }

  return mask;
}

// ─── Procedural fallback (used when no PNG is present) ───────────────────────
// Branching crack trees — organic network so it reads as cracks not scratches.

function drawStroke(
  mask: Uint8Array, w: number, h: number,
  x0: number, y0: number,
  length: number, halfW: number,
  angle: number, strokeSeed: number,
): void {
  const sx = Math.sin(angle), sy = Math.cos(angle);
  const steps = Math.ceil(length);
  const fade  = Math.max(1, steps * 0.22);

  for (let t = 0; t <= steps; t++) {
    const nearEnd = Math.min(t, steps - t);
    if (nearEnd < fade) {
      if (hash2d(t, strokeSeed & 0xffff, strokeSeed >> 16) > nearEnd / fade) continue;
    }
    const py = Math.round(y0 + sy * t);
    if (py < 0 || py >= h) continue;
    const cx = x0 + sx * t;
    const xlo = Math.max(0, Math.floor(cx - halfW));
    const xhi = Math.min(w - 1, Math.ceil(cx + halfW));
    for (let xi = xlo; xi <= xhi; xi++) mask[py * w + xi] = 0;
  }
}

function proceduralCrack(
  w: number, h: number,
  intensity: number, scale: number, crackWidth: number, seed: number,
): Uint8Array {
  const n    = w * h;
  const S    = Math.min(w, h) / scale;
  const intF = intensity / 100;
  const mask = new Uint8Array(n).fill(255);
  if (intF <= 0) return mask;

  interface Node { x: number; y: number; angle: number; len: number; wid: number; depth: number; }
  const stack: Node[] = [];
  let   nodeId = 0;

  const nRoots = Math.round((60 + 180 * intF) / scale);
  for (let i = 0; i < nRoots; i++) {
    stack.push({
      x: hash2d(i, 0, seed + 1) * w,
      y: hash2d(i, 1, seed + 2) * h,
      angle: (hash2d(i, 2, seed + 3) - 0.5) * 0.70,
      len:   S * 0.09 * (0.5 + hash2d(i, 3, seed + 4)),
      wid:   crackWidth,
      depth: 4,
    });
  }

  while (stack.length > 0) {
    const { x, y, angle, len, wid, depth } = stack.pop()!;
    drawStroke(mask, w, h, x, y, len, wid / 2, angle, (seed + nodeId) & 0x7fffffff);
    nodeId++;
    if (depth <= 0 || len < 5 || wid < 0.35) continue;
    const ex = x + Math.sin(angle) * len, ey = y + Math.cos(angle) * len;
    const roll = hash2d(Math.round(ex) ^ (depth << 12), Math.round(ey), seed + 9001);
    if (roll < 0.55) {
      const sp = 0.45 + (4 - depth) * 0.08;
      stack.push({ x: ex, y: ey, angle: angle + hash2d(nodeId,     depth, seed + 101) * sp,  len: len * (0.45 + hash2d(nodeId,     depth + 1, seed + 303) * 0.35), wid: wid * 0.78, depth: depth - 1 });
      stack.push({ x: ex, y: ey, angle: angle - hash2d(nodeId + 1, depth, seed + 202) * sp,  len: len * (0.40 + hash2d(nodeId + 1, depth + 1, seed + 404) * 0.30), wid: wid * 0.68, depth: depth - 1 });
    } else {
      stack.push({ x: ex, y: ey, angle: angle + (hash2d(nodeId, depth + 5, seed + 505) - 0.5) * 0.28, len: len * 0.73, wid: wid * 0.88, depth: depth - 1 });
    }
  }

  // Worn patches
  const pf1 = 4.2 / S, pf2 = 11.0 / S, ef = 29.0 / S, thr = 0.91 - intF * 0.18;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 0) continue;
      const p = vnoise(x * pf1, y * pf1, seed + 400) * 0.54
              + vnoise(x * pf2, y * pf2, seed + 410) * 0.30
              + vnoise(x * ef,  y * ef,  seed + 420) * 0.16;
      if (p > thr) mask[y * w + x] = 0;
    }
  }

  return mask;
}

function proceduralFade(w: number, h: number, intensity: number, scale: number, seed: number): Uint8Array {
  const n  = w * h, S = Math.min(w, h), cx = w / 2, cy = h / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy), nf = 2.8 / (S * scale);
  const mask = new Uint8Array(n).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
      const v = vnoise(x * nf, y * nf, seed) * 0.57 + vnoise(x * nf * 2, y * nf * 2, seed + 97) * 0.43;
      if (r * 0.65 + (1 - v) * 0.40 > 0.92 - (intensity / 100) * 0.80) mask[y * w + x] = 0;
    }
  }
  return mask;
}

function proceduralHalftone(w: number, h: number, intensity: number, scale: number, seed: number): Uint8Array {
  const n  = w * h, S = Math.min(w, h), sp = Math.max(4, S * 0.025 * scale);
  const mask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = ((x / sp) % 1 + 1) % 1 - 0.5, gy = ((y / sp) % 1 + 1) % 1 - 0.5;
      const d  = Math.sqrt(gx * gx + gy * gy);
      const e  = vnoise(x * 0.04, y * 0.04, seed) * 0.08 + vnoise(x * 0.18, y * 0.18, seed + 50) * 0.04;
      if (d < 0.44 - (intensity / 100) * 0.36 - e) mask[y * w + x] = 255;
    }
  }
  return mask;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateTextureMask(
  w:          number,
  h:          number,
  type:       TextureType,
  intensity:  number,
  scale:      number,
  crackWidth: number,
  seed:       number,
): Uint8Array {
  // Use real scanned texture if loaded, otherwise procedural fallback
  if (getCachedTexture(type)) {
    return applyImageTexture(type, w, h, intensity, scale, seed);
  }

  switch (type) {
    case 'plastisol-crack':  return proceduralCrack(w, h, intensity, scale, crackWidth, seed);
    case 'plastisol-fade':   return proceduralFade(w, h, intensity, scale, seed);
    case 'distressed':       return proceduralCrack(w, h, intensity * 1.3, scale, crackWidth * 1.5, seed + 7777);
    case 'halftone-worn':    return proceduralHalftone(w, h, intensity, scale, seed);
  }
}
