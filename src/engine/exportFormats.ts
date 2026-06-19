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
