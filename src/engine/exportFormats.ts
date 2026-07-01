// ─── EPS Encoder ──────────────────────────────────────────────────────────────
// Produces an Encapsulated PostScript (EPSF-3.0) file from an HTMLCanvasElement.
//
// grayscale=true  → 8-bit grayscale positive: opaque pixel = black (ink),
//                   transparent pixel = white (no ink). Standard screen-print
//                   film format accepted by AccuRIP, Kothari, Separation Studio, etc.
//
// grayscale=false → RGB colorimage: composited artwork for DTG/reference proofs.
//                   Transparent pixels are composited over white.
//
// Spot-color DSC comments (%%DocumentCustomColors / %%CMYKCustomColor) are
// written when spotColor is provided — lets RIP software label the ink channel.

export interface EpsOptions {
  dpi: number;
  title?: string;
  spotColor?: [number, number, number] | null;
  grayscale?: boolean;
}

export function encodeEps(canvas: HTMLCanvasElement, opts: EpsOptions): Uint8Array {
  const { dpi, title = 'Layer', spotColor = null, grayscale = true } = opts;
  const w = canvas.width;
  const h = canvas.height;
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;

  // Physical size in PostScript points (72 pt = 1 inch)
  const ptW = w / dpi * 72;
  const ptH = h / dpi * 72;
  const ptWs = ptW.toFixed(3);
  const ptHs = ptH.toFixed(3);

  const L: string[] = [];

  // ── DSC header ──────────────────────────────────────────────────────────────
  L.push('%!PS-Adobe-3.0 EPSF-3.0');
  L.push(`%%BoundingBox: 0 0 ${Math.ceil(ptW)} ${Math.ceil(ptH)}`);
  L.push(`%%HiResBoundingBox: 0 0 ${ptWs} ${ptHs}`);
  L.push(`%%Title: (${title})`);
  L.push(`%%Creator: (AutoThresh Web)`);
  L.push(`%%CreationDate: (${new Date().toUTCString()})`);
  L.push('%%DocumentData: Clean7Bit');
  L.push('%%LanguageLevel: 2');

  if (spotColor) {
    const [sr, sg, sb] = spotColor;
    const rc = sr / 255, gc = sg / 255, bc = sb / 255;
    const k = 1 - Math.max(rc, gc, bc);
    const d = k < 1 ? 1 / (1 - k) : 1;
    const c = k < 1 ? (1 - rc - k) * d : 0;
    const m = k < 1 ? (1 - gc - k) * d : 0;
    const y = k < 1 ? (1 - bc - k) * d : 0;
    L.push(`%%DocumentCustomColors: (${title})`);
    L.push(`%%CMYKCustomColor: ${c.toFixed(4)} ${m.toFixed(4)} ${y.toFixed(4)} ${k.toFixed(4)} (${title})`);
  }

  L.push('%%EndComments');
  L.push('%%BeginProlog');
  L.push('%%EndProlog');
  L.push('%%Page: 1 1');

  // ── Image rendering ─────────────────────────────────────────────────────────
  // Scale unit square → page size, then map pixel rows with Y-flip so row 0
  // lands at the top of the page (PS origin is bottom-left).
  L.push('gsave');
  L.push(`0 0 translate`);
  L.push(`${ptWs} ${ptHs} scale`);

  if (grayscale) {
    L.push(`${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}]`);
    L.push(`{currentfile ${w} string readhexstring pop}`);
    L.push('image');
  } else {
    L.push(`${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}]`);
    L.push(`{currentfile ${w} 3 mul string readhexstring pop}`);
    L.push('false 3 colorimage');
  }

  // ── Pixel data as ASCII hex (80 chars / line) ────────────────────────────────
  const HEX = '0123456789abcdef';
  const COLS = grayscale ? 80 : 78; // 78 keeps RGB triplets whole (3×2=6 chars)
  let row = '';

  if (grayscale) {
    for (let i = 0; i < w * h; i++) {
      // Any opaque pixel = ink (0 = black); transparent = no ink (ff = white)
      const g = pixels[i * 4 + 3] > 0 ? 0 : 255;
      row += HEX[(g >> 4) & 0xf];
      row += HEX[g & 0xf];
      if (row.length >= COLS) { L.push(row); row = ''; }
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const px = i * 4;
      const a = pixels[px + 3];
      // Composite over white for transparent pixels
      const inv = (255 - a) / 255;
      const r = Math.round(pixels[px]     * (a / 255) + 255 * inv);
      const g = Math.round(pixels[px + 1] * (a / 255) + 255 * inv);
      const b = Math.round(pixels[px + 2] * (a / 255) + 255 * inv);
      row += HEX[(r >> 4) & 0xf]; row += HEX[r & 0xf];
      row += HEX[(g >> 4) & 0xf]; row += HEX[g & 0xf];
      row += HEX[(b >> 4) & 0xf]; row += HEX[b & 0xf];
      if (row.length >= COLS) { L.push(row); row = ''; }
    }
  }
  if (row) L.push(row);

  // ── Footer ───────────────────────────────────────────────────────────────────
  L.push('grestore');
  L.push('showpage');
  L.push('%%Trailer');
  L.push('%%EOF');

  return new TextEncoder().encode(L.join('\n') + '\n');
}

// ─── TIFF Encoder ─────────────────────────────────────────────────────────────
// Produces an uncompressed RGBA TIFF 6.0 (little-endian).
// No external dependency — plain ArrayBuffer manipulation.
//
// Layout:
//   0   Header (8 bytes)
//   8   IFD (2 + 14×12 + 4 = 174 bytes)
// 182   BitsPerSample data [8,8,8,8] (8 bytes)
// 190   XResolution rational (8 bytes)
// 198   YResolution rational (8 bytes)
// 206   Pixel data (w × h × 4 bytes)

export function encodeTiff(imageData: ImageData, dpi: number): ArrayBuffer {
  const { width: w, height: h } = imageData;
  const pixelBytes = w * h * 4;

  const BPS_OFF  = 182;
  const XRES_OFF = 190;
  const YRES_OFF = 198;
  const IMG_OFF  = 206;

  const buf  = new ArrayBuffer(IMG_OFF + pixelBytes);
  const view = new DataView(buf);
  const le   = true;

  // ── Header ──────────────────────────────────────────────────────────────────
  view.setUint8(0, 0x49); view.setUint8(1, 0x49); // "II" little-endian
  view.setUint16(2, 42, le);  // TIFF magic
  view.setUint32(4, 8, le);   // offset to first IFD

  // ── IFD ─────────────────────────────────────────────────────────────────────
  let p = 8;
  view.setUint16(p, 14, le); p += 2; // 14 entries

  const entry = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(p,     tag,   le);
    view.setUint16(p + 2, type,  le);
    view.setUint32(p + 4, count, le);
    view.setUint32(p + 8, value, le); // value or offset; SHORTs go in low 2 bytes (LE)
    p += 12;
  };

  entry(256, 4, 1, w);            // ImageWidth  (LONG)
  entry(257, 4, 1, h);            // ImageLength (LONG)
  entry(258, 3, 4, BPS_OFF);      // BitsPerSample → offset  (4×SHORT)
  entry(259, 3, 1, 1);            // Compression: 1=none
  entry(262, 3, 1, 2);            // PhotometricInterpretation: 2=RGB
  entry(273, 4, 1, IMG_OFF);      // StripOffsets (single strip)
  entry(277, 3, 1, 4);            // SamplesPerPixel: 4
  entry(278, 4, 1, h);            // RowsPerStrip: all rows in one strip
  entry(279, 4, 1, pixelBytes);   // StripByteCounts
  entry(282, 5, 1, XRES_OFF);     // XResolution → offset (RATIONAL)
  entry(283, 5, 1, YRES_OFF);     // YResolution → offset (RATIONAL)
  entry(284, 3, 1, 1);            // PlanarConfiguration: 1=chunky
  entry(296, 3, 1, 2);            // ResolutionUnit: 2=inch
  entry(338, 3, 1, 2);            // ExtraSamples: 2=unassociated alpha

  view.setUint32(p, 0, le); // next IFD = null

  // ── Extra data ──────────────────────────────────────────────────────────────
  // BitsPerSample: 8,8,8,8
  view.setUint16(BPS_OFF,     8, le);
  view.setUint16(BPS_OFF + 2, 8, le);
  view.setUint16(BPS_OFF + 4, 8, le);
  view.setUint16(BPS_OFF + 6, 8, le);

  // XResolution: dpi/1
  view.setUint32(XRES_OFF,     dpi, le);
  view.setUint32(XRES_OFF + 4, 1,   le);

  // YResolution: dpi/1
  view.setUint32(YRES_OFF,     dpi, le);
  view.setUint32(YRES_OFF + 4, 1,   le);

  // ── Pixel data ───────────────────────────────────────────────────────────────
  new Uint8Array(buf, IMG_OFF).set(new Uint8Array(imageData.data.buffer));

  return buf;
}
