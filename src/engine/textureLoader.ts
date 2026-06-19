// ─── Texture Loader ────────────────────────────────────────────────────────────
// Loads PNG texture files from /public/textures/ at startup.
// Stores grayscale pixel data (R channel only) so generateTextureMask can
// sample them synchronously during mask generation.
// Files that 404 are silently skipped — procedural fallback kicks in instead.

export type TextureType = 'plastisol-crack' | 'plastisol-fade' | 'distressed' | 'halftone-worn';

export const TEXTURE_FILES: Record<TextureType, string> = {
  'plastisol-crack': '/textures/Plastisol_Texture_byCharleyPangus.png',
  'plastisol-fade':  '/textures/plastisol-fade.png',
  'distressed':      '/textures/distressed.png',
  'halftone-worn':   '/textures/halftone-worn.png',
};

export interface TexCache {
  pixels: Uint8Array;  // grayscale: 0=black/crack, 255=white/ink
  w:      number;
  h:      number;
}

// Max dimension to store in memory. A 5000+ px texture is downscaled to this
// on load — still plenty of detail for tiling over a 1200 px preview.
const MAX_DIM = 2048;

const cache = new Map<TextureType, TexCache>();
const attempted = new Set<TextureType>();

// ── Internal loader ────────────────────────────────────────────────────────────

function loadOne(type: TextureType): Promise<boolean> {
  if (cache.has(type)) return Promise.resolve(true);
  if (attempted.has(type)) return Promise.resolve(false);
  attempted.add(type);

  return new Promise<boolean>((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        // Downscale if the source image is very large
        const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const dw    = Math.round(img.naturalWidth  * scale);
        const dh    = Math.round(img.naturalHeight * scale);

        const c   = document.createElement('canvas');
        c.width   = dw;
        c.height  = dh;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;

        // Draw with smoothing enabled so downscale is high quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, dw, dh);

        const raw = ctx.getImageData(0, 0, dw, dh).data;

        // Store only the red channel (textures are grayscale)
        const pixels = new Uint8Array(dw * dh);
        for (let i = 0; i < pixels.length; i++) pixels[i] = raw[i * 4];

        cache.set(type, { pixels, w: dw, h: dh });
        resolve(true);
      } catch {
        resolve(false);
      }
    };

    img.onerror = () => resolve(false);  // file missing → silently skip
    img.src = TEXTURE_FILES[type];
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Load all texture files that exist. Returns a count of how many loaded. */
export async function loadAllTextures(): Promise<number> {
  const results = await Promise.all(
    (Object.keys(TEXTURE_FILES) as TextureType[]).map(loadOne)
  );
  return results.filter(Boolean).length;
}

/** Returns cached texture data, or null if not loaded / file missing. */
export function getCachedTexture(type: TextureType): TexCache | null {
  return cache.get(type) ?? null;
}

/** True if at least one texture file has been loaded. */
export function hasAnyTexture(): boolean {
  return cache.size > 0;
}
