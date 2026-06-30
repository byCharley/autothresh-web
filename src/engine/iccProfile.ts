// ICC Profile parser — mft1 (lut8Type) only.
// All four bundled CMYK output profiles (SWOP, FOGRA39, JapanColor, WebCoated)
// use mft1 B2A0/B2A1 tags with 3 Lab inputs → 4 CMYK outputs, 33-point grid.

export interface IccLut {
  gridPoints: number;           // 33 for all bundled profiles
  inputTables: Float32Array[];  // [3][256] values in [0,1]
  outputTables: Float32Array[]; // [4][256] values in [0,1]
  clut: Float32Array;           // [33^3 * 4] values in [0,1], L-major ordering
}

export interface IccProfile {
  name: string;
  pcs: 'Lab' | 'XYZ';
  bToA0: IccLut | null; // perceptual (what Photoshop uses by default)
  bToA1: IccLut | null; // relative colorimetric
}

const MFT1_TYPE  = 0x6D667431; // 'mft1'
const TAG_B2A0   = 0x42324130; // 'B2A0'
const TAG_B2A1   = 0x42324131; // 'B2A1'

function u32(buf: Uint8Array, off: number): number {
  return (buf[off] << 24 | buf[off+1] << 16 | buf[off+2] << 8 | buf[off+3]) >>> 0;
}

function parseMft1(buf: Uint8Array, tagOffset: number): IccLut | null {
  if (u32(buf, tagOffset) !== MFT1_TYPE) return null;

  const inputChannels  = buf[tagOffset + 8];   // 3 (Lab)
  const outputChannels = buf[tagOffset + 9];   // 4 (CMYK)
  const gridPoints     = buf[tagOffset + 10];  // 33

  // mft1 fixed sizes: 256 entries per table, uint8 values
  const TABLE_SIZE = 256;
  let pos = tagOffset + 48; // skip header + matrix

  // Input tone curves (3 × 256 bytes)
  const inputTables: Float32Array[] = [];
  for (let c = 0; c < inputChannels; c++) {
    const t = new Float32Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i++) t[i] = buf[pos++] / 255;
    inputTables.push(t);
  }

  // 3D CLUT (33^3 × 4 bytes)
  const clutSize = gridPoints ** inputChannels * outputChannels;
  const clut = new Float32Array(clutSize);
  for (let i = 0; i < clutSize; i++) clut[i] = buf[pos++] / 255;

  // Output tone curves (4 × 256 bytes)
  const outputTables: Float32Array[] = [];
  for (let c = 0; c < outputChannels; c++) {
    const t = new Float32Array(TABLE_SIZE);
    for (let i = 0; i < TABLE_SIZE; i++) t[i] = buf[pos++] / 255;
    outputTables.push(t);
  }

  return { gridPoints, inputTables, outputTables, clut };
}

export function parseIccProfile(buffer: ArrayBuffer, name: string): IccProfile {
  const buf = new Uint8Array(buffer);

  // PCS is at header bytes 20-23
  const pcsCode = String.fromCharCode(buf[20], buf[21], buf[22], buf[23]).trim();
  const pcs: 'Lab' | 'XYZ' = pcsCode === 'Lab' ? 'Lab' : 'XYZ';

  const tagCount = u32(buf, 128);
  let bToA0: IccLut | null = null;
  let bToA1: IccLut | null = null;

  for (let i = 0; i < tagCount; i++) {
    const base   = 132 + i * 12;
    const sig    = u32(buf, base);
    const offset = u32(buf, base + 4);

    if (sig === TAG_B2A0) bToA0 = parseMft1(buf, offset);
    else if (sig === TAG_B2A1) bToA1 = parseMft1(buf, offset);
  }

  return { name, pcs, bToA0, bToA1 };
}
