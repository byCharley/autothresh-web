export interface SheetSettings {
  unit: 'in' | 'cm';
  sheetWidthIn: number;
  sheetHeightIn: number;
  quantity: number;
  spacingIn: number;
  cutLines: boolean;
  dpi: 150 | 300;
  rotateDesign: boolean;
}

export const DEFAULT_SHEET_SETTINGS: SheetSettings = {
  unit: 'in',
  sheetWidthIn: 22.83,
  sheetHeightIn: 18.67,
  quantity: 1,
  spacingIn: 0.25,
  cutLines: false,
  dpi: 300,
  rotateDesign: true,
};

export const DTF_PRESETS: Array<{ label: string; widthIn: number; heightIn: number }> = [
  { label: '11.8"', widthIn: 11.8, heightIn: 98.43 },
  { label: '23.6"', widthIn: 23.6, heightIn: 98.43 },
];

export const SUBLIMATION_PRESETS: Array<{ label: string; widthIn: number; heightIn: number }> = [
  { label: 'A4', widthIn: 8.27, heightIn: 11.69 },
  { label: 'A3', widthIn: 11.69, heightIn: 16.54 },
  { label: 'A2', widthIn: 16.54, heightIn: 23.39 },
];

export function inToCm(v: number): number { return Math.round(v * 2.54 * 100) / 100; }
export function cmToIn(v: number): number { return Math.round((v / 2.54) * 1000) / 1000; }
export function displayVal(v: number, unit: 'in' | 'cm'): number {
  return unit === 'cm' ? inToCm(v) : Math.round(v * 100) / 100;
}

export interface LayoutResult {
  cols: number;
  rows: number;
  perSheet: number;
  sheets: number;
  designWidthIn: number;
  designHeightIn: number;
  usedAreaIn2: number;
  wastedAreaIn2: number;
}

// Auto-grid: pick cols × rows that best matches the sheet aspect ratio for N copies.
function autoGrid(quantity: number, sheetW: number, sheetH: number): { cols: number; rows: number } {
  let bestCols = 1, bestRows = quantity;
  let bestScore = Infinity;
  for (let c = 1; c <= quantity; c++) {
    const r = Math.ceil(quantity / c);
    // Score = how far the slot aspect is from the sheet aspect
    const slotAspect = (sheetW / c) / (sheetH / r);
    const sheetAspect = sheetW / sheetH;
    const score = Math.abs(Math.log(slotAspect / sheetAspect));
    if (score < bestScore) { bestScore = score; bestCols = c; bestRows = r; }
  }
  return { cols: bestCols, rows: bestRows };
}

// Design size that fills one grid slot maintaining artwork aspect ratio.
function slotFill(
  slotW: number, slotH: number, artAspect: number, rotateDesign: boolean,
): { designWidthIn: number; designHeightIn: number } {
  // artAspect = artH / artW (>1 means portrait, <1 means landscape)
  const effAspect = rotateDesign ? 1 / artAspect : artAspect;
  let dW: number, dH: number;
  if (slotW * effAspect <= slotH) {
    dW = slotW; dH = slotW * effAspect;
  } else {
    dH = slotH; dW = slotH / effAspect;
  }
  // Return natural (pre-rotation) dimensions
  return rotateDesign
    ? { designWidthIn: dH, designHeightIn: dW }
    : { designWidthIn: dW, designHeightIn: dH };
}

export function calcLayout(settings: SheetSettings, artAspect: number): LayoutResult {
  const { sheetWidthIn, sheetHeightIn, quantity, spacingIn, rotateDesign } = settings;

  const { cols, rows } = autoGrid(quantity, sheetWidthIn, sheetHeightIn);
  const slotW = Math.max(0.1, (sheetWidthIn - (cols + 1) * spacingIn) / cols);
  const slotH = Math.max(0.1, (sheetHeightIn - (rows + 1) * spacingIn) / rows);
  const { designWidthIn, designHeightIn } = slotFill(slotW, slotH, artAspect, rotateDesign);

  const perSheet = cols * rows;
  const sheets = Math.ceil(quantity / perSheet);
  const placed = Math.min(quantity, perSheet);
  const footprintW = rotateDesign ? designHeightIn : designWidthIn;
  const footprintH = rotateDesign ? designWidthIn : designHeightIn;
  const usedAreaIn2 = placed * footprintW * footprintH;
  const wastedAreaIn2 = Math.max(0, sheetWidthIn * sheetHeightIn - usedAreaIn2);

  return { cols, rows, perSheet, sheets, designWidthIn, designHeightIn, usedAreaIn2, wastedAreaIn2 };
}

export interface PackResult extends LayoutResult {
  canvas: HTMLCanvasElement;
  placed: number;
}

export function packSheet(
  designCanvas: HTMLCanvasElement,
  settings: SheetSettings,
  artAspect: number,
): PackResult {
  const { sheetWidthIn, sheetHeightIn, quantity, spacingIn, cutLines, dpi, rotateDesign } = settings;

  const { cols, rows } = autoGrid(quantity, sheetWidthIn, sheetHeightIn);
  const slotW = Math.max(0.1, (sheetWidthIn - (cols + 1) * spacingIn) / cols);
  const slotH = Math.max(0.1, (sheetHeightIn - (rows + 1) * spacingIn) / rows);
  const { designWidthIn, designHeightIn } = slotFill(slotW, slotH, artAspect, rotateDesign);

  // Footprint of each copy on the sheet
  const footprintW = rotateDesign ? designHeightIn : designWidthIn;
  const footprintH = rotateDesign ? designWidthIn : designHeightIn;
  const fpW_px = Math.round(footprintW * dpi);
  const fpH_px = Math.round(footprintH * dpi);
  const srcW_px = Math.round(designWidthIn * dpi);
  const srcH_px = Math.round(designHeightIn * dpi);
  const spacingPx = Math.round(spacingIn * dpi);

  const sheetW = Math.round(sheetWidthIn * dpi);
  const sheetH = Math.round(sheetHeightIn * dpi);

  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = sheetH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheetW, sheetH);

  let placed = 0;
  outer: for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (placed >= quantity) break outer;
      const x = spacingPx + col * (fpW_px + spacingPx);
      const y = spacingPx + row * (fpH_px + spacingPx);

      if (rotateDesign) {
        ctx.save();
        ctx.translate(x + fpW_px, y);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(designCanvas, 0, 0, srcW_px, srcH_px);
        ctx.restore();
      } else {
        ctx.drawImage(designCanvas, x, y, srcW_px, srcH_px);
      }

      if (cutLines) {
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(1, Math.round(dpi / 300));
        ctx.setLineDash([Math.round(dpi * 0.04), Math.round(dpi * 0.03)]);
        ctx.strokeRect(x + 0.5, y + 0.5, fpW_px - 1, fpH_px - 1);
        ctx.restore();
      }
      placed++;
    }
  }

  const perSheet = cols * rows;
  const sheets = Math.ceil(quantity / perSheet);
  const usedAreaIn2 = placed * footprintW * footprintH;
  const wastedAreaIn2 = Math.max(0, sheetWidthIn * sheetHeightIn - usedAreaIn2);

  return { canvas, placed, cols, rows, perSheet, sheets, designWidthIn, designHeightIn, usedAreaIn2, wastedAreaIn2 };
}
