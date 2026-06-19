import { useState } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { writePsd } from 'ag-psd';
import { PDFDocument } from 'pdf-lib';
import { TopBar } from './components/TopBar';
import { LayerPanel } from './components/LayerPanel';
import { CanvasView } from './components/CanvasView';
import { ControlPanel } from './components/ControlPanel';
import { ExportModal } from './components/ExportModal';
import type { ExportConfig } from './components/ExportModal';
import { useStore } from './store/useStore';
import {
  processImage, renderComposite, drawRegistrationMarks, computeBackgroundMask,
} from './engine/imageProcessor';
import type { LayerConfig, PatternConfig } from './engine/imageProcessor';
import { encodeTiff } from './engine/exportFormats';

function resolvePatterns(layers: LayerConfig[], global: PatternConfig): LayerConfig[] {
  return layers.map((l) =>
    l.useGlobalPattern
      ? { ...l, pattern: global.pattern, patternScale: global.patternScale, patternAngle: global.patternAngle, patternDensity: global.patternDensity }
      : l
  );
}

function canvasFromImageData(imageData: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d')!.putImageData(imageData, 0, 0);
  return c;
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await canvasToBlob(canvas);
  return new Uint8Array(await blob.arrayBuffer());
}

function App() {
  const [showExport, setShowExport] = useState(false);
  const {
    originalImage, layers, globalPattern, knockoutEnabled,
    bgRemovalEnabled, bgTolerance, regMarkPadding, imageAdjustments, canvasColor,
    documentDpi, documentWidthIn, documentHeightIn, showRegistrationMarks, imageFileName,
  } = useStore();

  const handleExport = async ({ mode, format, fileName }: ExportConfig) => {
    if (!originalImage) return;

    // ── Document geometry ────────────────────────────────────────────────────
    const docPxW    = Math.round(documentWidthIn * documentDpi);
    const docPxH    = Math.round(documentHeightIn * documentDpi);
    const ow = originalImage.width, oh = originalImage.height;
    const sf = Math.min(docPxW / ow, docPxH / oh);
    const artScaleW = Math.round(ow * sf);
    const artScaleH = Math.round(oh * sf);
    const artOffX   = Math.round((docPxW - artScaleW) / 2);
    const artOffY   = Math.round((docPxH - artScaleH) / 2);

    const artSrcCanvas  = canvasFromImageData(originalImage);
    const docSrcCanvas  = document.createElement('canvas');
    docSrcCanvas.width  = docPxW; docSrcCanvas.height = docPxH;
    const docSrcCtx     = docSrcCanvas.getContext('2d')!;
    docSrcCtx.fillStyle = canvasColor;
    docSrcCtx.fillRect(0, 0, docPxW, docPxH);
    docSrcCtx.drawImage(artSrcCanvas, artOffX, artOffY, artScaleW, artScaleH);
    const docImageData  = docSrcCtx.getImageData(0, 0, docPxW, docPxH);

    const fullBgMask  = bgRemovalEnabled ? computeBackgroundMask(docImageData, bgTolerance) : null;
    const resolved    = resolvePatterns(layers, globalPattern);
    const fullLayers  = processImage(docImageData, resolved, knockoutEnabled, fullBgMask, imageAdjustments);
    const regPaddingPx = Math.round(regMarkPadding * documentDpi);
    const baseName    = fileName || imageFileName.replace(/\.[^.]+$/, '') || 'autothresh';

    // ── Build per-layer canvas helper ────────────────────────────────────────
    const buildLayerCanvas = (pl: typeof fullLayers[number], withMarks: boolean): HTMLCanvasElement => {
      const [r, g, b] = pl.color;
      const data = new ImageData(docPxW, docPxH);
      for (let i = 0; i < pl.mask.length; i++) {
        if (pl.mask[i] === 255) {
          const pi = i * 4;
          data.data[pi] = r; data.data[pi + 1] = g; data.data[pi + 2] = b; data.data[pi + 3] = 255;
        }
      }
      const canvas = canvasFromImageData(data);
      if (withMarks && showRegistrationMarks) {
        drawRegistrationMarks(canvas.getContext('2d')!, docPxW, docPxH, regPaddingPx, '#000000');
      }
      return canvas;
    };

    const buildCompositeCanvas = (withMarks: boolean): HTMLCanvasElement => {
      const composite = renderComposite(fullLayers, docPxW, docPxH, true);
      const canvas = canvasFromImageData(composite);
      if (withMarks && showRegistrationMarks) {
        drawRegistrationMarks(canvas.getContext('2d')!, docPxW, docPxH, regPaddingPx, '#000000');
      }
      return canvas;
    };

    const buildBgCanvas = (): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = docPxW; c.height = docPxH;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = canvasColor;
      ctx.fillRect(0, 0, docPxW, docPxH);
      return c;
    };

    const bgLayer = {
      name: 'Background',
      canvas: buildBgCanvas(),
      top: 0, left: 0,
      blendMode: 'normal' as const,
      opacity: 1,
    };

    const visibleLayers = fullLayers.filter((pl) => pl.visible);

    // ── PNG ──────────────────────────────────────────────────────────────────
    if (format === 'png') {
      if (mode === 'dtg') {
        const blob = await canvasToBlob(buildCompositeCanvas(false));
        saveAs(blob, `${baseName}-dtg.png`);
      } else {
        const zip    = new JSZip();
        const folder = zip.folder('screen-print')!;
        for (const pl of visibleLayers) {
          const cfg = layers.find((l) => l.id === pl.id)!;
          folder.file(`${cfg.name.toLowerCase()}.png`, await canvasToBlob(buildLayerCanvas(pl, true)));
        }
        folder.file('composite.png', await canvasToBlob(buildCompositeCanvas(true)));
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen.zip`);
      }
      return;
    }

    // ── PSD ──────────────────────────────────────────────────────────────────
    if (format === 'psd') {
      if (mode === 'dtg') {
        const buffer = writePsd({
          width: docPxW, height: docPxH,
          children: [
            bgLayer,
            { name: 'Composite', canvas: buildCompositeCanvas(false), top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
          ],
        });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-dtg.psd`);
      } else {
        const psdLayers = visibleLayers.map((pl) => {
          const cfg = layers.find((l) => l.id === pl.id)!;
          return {
            name:      cfg.name,
            canvas:    buildLayerCanvas(pl, true),
            top:       0,
            left:      0,
            blendMode: 'normal' as const,
            opacity:   1,
          };
        });
        const buffer = writePsd({ width: docPxW, height: docPxH, children: [bgLayer, ...psdLayers] });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-screen.psd`);
      }
      return;
    }

    // ── PDF ──────────────────────────────────────────────────────────────────
    if (format === 'pdf') {
      // PDF dimensions in points (72 pt = 1 inch)
      const ptW = documentWidthIn  * 72;
      const ptH = documentHeightIn * 72;

      const pdfDoc = await PDFDocument.create();

      const addPage = async (canvas: HTMLCanvasElement) => {
        const pngBytes = await canvasToPngBytes(canvas);
        const img      = await pdfDoc.embedPng(pngBytes);
        const page     = pdfDoc.addPage([ptW, ptH]);
        page.drawImage(img, { x: 0, y: 0, width: ptW, height: ptH });
      };

      if (mode === 'dtg') {
        await addPage(buildCompositeCanvas(false));
      } else {
        for (const pl of visibleLayers) await addPage(buildLayerCanvas(pl, true));
        await addPage(buildCompositeCanvas(true));
      }

      const pdfBytes = await pdfDoc.save();
      saveAs(new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), `${baseName}-${mode}.pdf`);
      return;
    }

    // ── TIFF ─────────────────────────────────────────────────────────────────
    if (format === 'tiff') {
      const getPixels = (canvas: HTMLCanvasElement): ImageData =>
        canvas.getContext('2d')!.getImageData(0, 0, docPxW, docPxH);

      if (mode === 'dtg') {
        const buf = encodeTiff(getPixels(buildCompositeCanvas(false)), documentDpi);
        saveAs(new Blob([buf], { type: 'image/tiff' }), `${baseName}-dtg.tiff`);
      } else {
        const zip    = new JSZip();
        const folder = zip.folder('screen-print-tiff')!;
        for (const pl of visibleLayers) {
          const cfg = layers.find((l) => l.id === pl.id)!;
          const buf = encodeTiff(getPixels(buildLayerCanvas(pl, true)), documentDpi);
          folder.file(`${cfg.name.toLowerCase()}.tiff`, buf);
        }
        folder.file('composite.tiff', encodeTiff(getPixels(buildCompositeCanvas(true)), documentDpi));
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen-tiff.zip`);
      }
    }
  };

  return (
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} />
      <div className="workspace">
        <LayerPanel />
        <CanvasView />
        <ControlPanel />
      </div>
      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          onExport={handleExport}
          defaultFileName={imageFileName.replace(/\.[^.]+$/, '') || 'autothresh'}
        />
      )}
    </div>
  );
}

export default App;
