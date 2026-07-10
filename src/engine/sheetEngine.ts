export interface SheetSettings {
  unit: 'in' | 'cm';
  sheetWidthIn: number;
  sheetHeightIn: number;
  designWidthIn: number;
  quantity: number;
  spacingIn: number;
  cutLines: boolean;
  dpi: 150 | 300;
}

export const DEFAULT_SHEET_SETTINGS: SheetSettings = {
  unit: 'in',
  sheetWidthIn: 22.83,
  sheetHeightIn: 18.67,
  designWidthIn: 5.0,
  quantity: 1,
  spacingIn: 0.25,
  cutLines: false,
  dpi: 150,
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

export function displayVal(valueIn: number, unit: 'in' | 'cm'): number {
  return unit === 'cm' ? inToCm(valueIn) : Math.round(valueIn * 100) / 100;
}

export interface PackResult {
  canvas: HTMLCanvasElement;
  placed: number;
  cols: number;
  rows: number;
  perSheet: number;
  sheets: number;
  usedAreaIn2: number;
  wastedAreaIn2: number;
  designHeightIn: number;
}

export function calcLayout(settings: SheetSettings, designAspect: number): Omit<PackResult, 'canvas' | 'placed'> {
  const { sheetWidthIn, sheetHeightIn, designWidthIn, quantity, spacingIn, dpi } = settings;
  const designHeightIn = designWidthIn * designAspect;
  const designW = Math.round(designWidthIn * dpi);
  const designH = Math.round(designHeightIn * dpi);
  const spacingPx = Math.max(0, Math.round(spacingIn * dpi));
  const sheetW = Math.round(sheetWidthIn * dpi);
  const sheetH = Math.round(sheetHeightIn * dpi);

  const cols = designW > 0 ? Math.max(0, Math.floor((sheetW + spacingPx) / (designW + spacingPx))) : 0;
  const rows = designH > 0 ? Math.max(0, Math.floor((sheetH + spacingPx) / (designH + spacingPx))) : 0;
  const perSheet = cols * rows;
  const sheets = perSheet > 0 ? Math.ceil(quantity / perSheet) : 0;
  const placed = perSheet > 0 ? Math.min(quantity, perSheet) : 0;
  const usedAreaIn2 = placed * designWidthIn * designHeightIn;
  const wastedAreaIn2 = Math.max(0, sheetWidthIn * sheetHeightIn - usedAreaIn2);

  return { cols, rows, perSheet, sheets, usedAreaIn2, wastedAreaIn2, designHeightIn };
}

export function packSheet(
  designCanvas: HTMLCanvasElement,
  settings: SheetSettings,
  designAspect: number,
): PackResult {
  const { sheetWidthIn, sheetHeightIn, designWidthIn, quantity, spacingIn, cutLines, dpi } = settings;
  const designHeightIn = designWidthIn * designAspect;

  const sheetW = Math.round(sheetWidthIn * dpi);
  const sheetH = Math.round(sheetHeightIn * dpi);
  const designW = Math.round(designWidthIn * dpi);
  const designH = Math.round(designHeightIn * dpi);
  const spacingPx = Math.max(0, Math.round(spacingIn * dpi));

  const cols = designW > 0 ? Math.max(0, Math.floor((sheetW + spacingPx) / (designW + spacingPx))) : 0;
  const rows = designH > 0 ? Math.max(0, Math.floor((sheetH + spacingPx) / (designH + spacingPx))) : 0;
  const perSheet = cols * rows;
  const sheets = perSheet > 0 ? Math.ceil(quantity / perSheet) : 0;

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
      const x = spacingPx + col * (designW + spacingPx);
      const y = spacingPx + row * (designH + spacingPx);
      ctx.drawImage(designCanvas, x, y, designW, designH);
      if (cutLines) {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(1, Math.round(dpi / 300));
        ctx.setLineDash([Math.round(dpi * 0.04), Math.round(dpi * 0.03)]);
        ctx.strokeRect(x + 0.5, y + 0.5, designW - 1, designH - 1);
        ctx.restore();
      }
      placed++;
    }
  }

  const usedAreaIn2 = placed * designWidthIn * designHeightIn;
  const wastedAreaIn2 = Math.max(0, sheetWidthIn * sheetHeightIn - usedAreaIn2);

  return { canvas, placed, cols, rows, perSheet, sheets, usedAreaIn2, wastedAreaIn2, designHeightIn };
}
