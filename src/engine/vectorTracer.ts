import ImageTracer from 'imagetracerjs';

export interface VectorTraceOptions {
  numColors: number;
  detail: number; // 1 (smooth) – 10 (tight)
  inkColor?: string; // used when numColors === 1
}

export interface VectorTraceResult {
  svgString: string;
  colors: string[];
}

// detail 1..10 → path error tolerance. High = fewer nodes = smoother curves.
const DETAIL_TO_LTRES = [25, 15, 9, 5.5, 3.5, 2, 1.2, 0.75, 0.4, 0.1];

export function traceImageToSVG(
  imageData: ImageData,
  options: VectorTraceOptions,
): VectorTraceResult {
  const { numColors, detail, inkColor = '#000000' } = options;
  const ltres = DETAIL_TO_LTRES[Math.max(0, Math.min(9, detail - 1))];

  if (numColors === 1) {
    return traceSingleColor(imageData, ltres, inkColor);
  }

  const svgString = ImageTracer.imagedataToSVG(imageData, {
    numberofcolors: numColors,
    ltres,
    qtres: ltres,
    pathomit: 16,
    strokewidth: 0,
    linefilter: false,
    rightangleenhance: false,
    colorquantcycles: 3,
    blurradius: 1,
    blurdelta: 20,
    layering: 0,
    desc: false,
    viewbox: true,
    colorsampling: 2,
    roundcoords: 1,
  });

  return { svgString, colors: extractColorsFromSVG(svgString) };
}

// ─── 1-color path ─────────────────────────────────────────────────────────────
// NOTE: imagetracerjs outputs fill="rgb(r,g,b)" with a separate opacity="a/255"
// attribute — NOT hex. String-replacing "#000000" never matches. Instead, we
// bake the ink color directly into the binary pixels so the SVG is already
// colored correctly from the trace step.

function traceSingleColor(
  src: ImageData,
  ltres: number,
  inkColor: string,
): VectorTraceResult {
  const { width, height } = src;
  const n = width * height;
  const [ir, ig, ib] = hexToRgbArr(inkColor);

  // Decide binarization strategy based on ink luminance.
  // For near-white inks: trace only light pixels (so black badge bodies don't fill).
  // For near-black inks: trace only dark pixels (so white backgrounds don't fill).
  // For mid-tone inks: alpha-only (rely on bg removal to strip the background).
  const inkLum = (0.299 * ir + 0.587 * ig + 0.114 * ib) / 255;
  const traceLightPixels = inkLum > 0.75;   // white/cream inks → trace light areas
  const traceDarkPixels  = inkLum < 0.25;   // black/dark inks  → trace dark areas

  // Blur the alpha channel with radius=2 to feather staircase pixel edges
  const smoothAlpha = blurAlpha(src, 2);

  const binary = new ImageData(width, height);
  for (let i = 0; i < n; i++) {
    if (smoothAlpha[i] < 128) {
      // Transparent/bg-removed → always skip
      binary.data[i * 4] = 255; binary.data[i * 4 + 1] = 255;
      binary.data[i * 4 + 2] = 255; binary.data[i * 4 + 3] = 0;
      continue;
    }

    // For extreme-luminance inks, filter by pixel luminance so that opaque
    // pixels of the "wrong" brightness (e.g. the black badge body behind a
    // white logo) don't flood the silhouette with the ink color.
    if (traceLightPixels || traceDarkPixels) {
      const r = src.data[i * 4], g = src.data[i * 4 + 1], b = src.data[i * 4 + 2];
      const pixLum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const isInk = traceLightPixels ? pixLum > 0.5 : pixLum <= 0.5;
      if (!isInk) {
        binary.data[i * 4] = 255; binary.data[i * 4 + 1] = 255;
        binary.data[i * 4 + 2] = 255; binary.data[i * 4 + 3] = 0;
        continue;
      }
    }

    binary.data[i * 4]     = ir;
    binary.data[i * 4 + 1] = ig;
    binary.data[i * 4 + 2] = ib;
    binary.data[i * 4 + 3] = 255;
  }

  const svgString = ImageTracer.imagedataToSVG(binary, {
    numberofcolors: 2,
    pal: [
      { r: ir,  g: ig,  b: ib,  a: 255 },
      { r: 255, g: 255, b: 255, a: 0   },
    ],
    ltres,
    qtres: ltres,
    pathomit: 32,
    strokewidth: 0,
    linefilter: false,
    rightangleenhance: false,
    colorquantcycles: 1,
    blurradius: 0,
    layering: 0,
    desc: false,
    viewbox: true,
    roundcoords: 1,
  });

  return { svgString, colors: [toHex6(inkColor)] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgbArr(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Separable box blur on the alpha channel. O(n × 2r+1) per axis.
function blurAlpha(imageData: ImageData, radius: number): Uint8ClampedArray {
  const { data, width, height } = imageData;
  const src = new Uint8ClampedArray(width * height);
  for (let i = 0; i < src.length; i++) src[i] = data[i * 4 + 3];

  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const d   = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        sum += src[y * width + Math.max(0, Math.min(width - 1, x + kx))];
      }
      tmp[y * width + x] = Math.round(sum / d);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        sum += tmp[Math.max(0, Math.min(height - 1, y + ky)) * width + x];
      }
      out[y * width + x] = Math.round(sum / d);
    }
  }
  return out;
}

function toHex6(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#000000';
}

function extractColorsFromSVG(svg: string): string[] {
  // imagetracerjs outputs fill="rgb(r,g,b)" with a separate opacity="X" attribute.
  // We pair them to exclude fully-transparent background paths.
  const seen = new Set<string>();
  const re = /fill="rgb\((\d+),(\d+),(\d+)\)"[^>]*opacity="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    if (parseFloat(m[4]) < 0.01) continue; // skip transparent (background)
    const hex = '#' + [m[1], m[2], m[3]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
    seen.add(hex);
  }
  return Array.from(seen);
}
