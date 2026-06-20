import { useState, useEffect } from 'react';
import { useAuth } from './auth/useAuth';
import { LoginPage } from './components/LoginPage';
import { SubscribePage } from './components/SubscribePage';
import { MobileBlock } from './components/MobileBlock';
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
  processImage, renderComposite, renderCmykComposite, drawRegistrationMarks, computeBackgroundMask,
  cmykSeparate,
} from './engine/imageProcessor';
import type { LayerConfig, PatternConfig, ProcessedLayer } from './engine/imageProcessor';
import { generateTextureMask } from './engine/textureGenerator';
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

function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const smallScreen = window.innerWidth < 1024;
  return mobileUA || smallScreen;
}

function App() {
  const { status, session, initiateLogin, logout } = useAuth();
  const [showExport, setShowExport] = useState(false);
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const {
    originalImage, layers, globalPattern, knockoutEnabled,
    bgRemovalEnabled, bgTolerance, regMarkPadding, imageAdjustments, canvasColor,
    documentDpi, documentWidthIn, documentHeightIn, showRegistrationMarks, imageFileName,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    separationMode, cmykLpi, cmykAngles,
  } = useStore();

  useEffect(() => {
    const check = () => setIsMobile(isMobileDevice());
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (isMobile) return <MobileBlock />;

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
          Verifying…
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage onLogin={initiateLogin} />;
  }

  if (status === 'no-subscription') {
    return <SubscribePage firstName={session?.firstName} onLogout={logout} />;
  }

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

    // ── Scale the artwork to export resolution ───────────────────────────────
    // exportScaleFactor maps preview pattern density → export resolution so
    // grain/halftone density matches what the user sees in the canvas preview.
    const MAX_PREVIEW_DIM = 1200;
    const pds = Math.min(MAX_PREVIEW_DIM / Math.max(docPxW, docPxH), 1.0);
    const artPrevW = Math.round(artScaleW * pds);
    const exportScaleFactor = artScaleW / Math.max(1, artPrevW);

    const artSrcCanvas = canvasFromImageData(originalImage);
    const artExpCanvas = document.createElement('canvas');
    artExpCanvas.width = artScaleW; artExpCanvas.height = artScaleH;
    artExpCanvas.getContext('2d')!.drawImage(artSrcCanvas, 0, 0, artScaleW, artScaleH);
    const artImageData = artExpCanvas.getContext('2d')!.getImageData(0, 0, artScaleW, artScaleH);

    const artBgMask = bgRemovalEnabled ? computeBackgroundMask(artImageData, bgTolerance) : null;

    let artLayers: ProcessedLayer[];
    if (separationMode === 'cmyk') {
      // Cell size derived from LPI: output DPI / LPI = pixels per halftone dot
      artLayers = cmykSeparate(artImageData, documentDpi / cmykLpi, artBgMask, cmykAngles);
    } else {
      const resolved = resolvePatterns(layers, globalPattern);
      artLayers = processImage(artImageData, resolved, knockoutEnabled, artBgMask, imageAdjustments, exportScaleFactor);
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (const layer of artLayers) {
          for (let i = 0; i < layer.mask.length; i++) {
            if (texMask[i] === 0) layer.mask[i] = 0;
          }
        }
      }
    }

    const regPaddingPx = Math.round(regMarkPadding * documentDpi);
    const baseName    = fileName || imageFileName.replace(/\.[^.]+$/, '') || 'autothresh';

    // ── Build per-layer canvas: place artwork mask at its offset in the doc ──
    const buildLayerCanvas = (pl: typeof artLayers[number], withMarks: boolean): HTMLCanvasElement => {
      const [r, g, b] = pl.color;
      const data = new ImageData(docPxW, docPxH);
      for (let ay = 0; ay < artScaleH; ay++) {
        for (let ax = 0; ax < artScaleW; ax++) {
          if (pl.mask[ay * artScaleW + ax] !== 255) continue;
          const dx = artOffX + ax, dy = artOffY + ay;
          if (dx < 0 || dx >= docPxW || dy < 0 || dy >= docPxH) continue;
          const pi = (dy * docPxW + dx) * 4;
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
      // Composite artwork layers, then place in document canvas
      const artComposite = separationMode === 'cmyk'
        ? renderCmykComposite(artLayers, artScaleW, artScaleH, artBgMask)
        : renderComposite(artLayers, artScaleW, artScaleH, true, '#ffffff', !knockoutEnabled);
      const docCanvas = document.createElement('canvas');
      docCanvas.width = docPxW; docCanvas.height = docPxH;
      const dCtx = docCanvas.getContext('2d')!;
      dCtx.drawImage(canvasFromImageData(artComposite), artOffX, artOffY);
      if (withMarks && showRegistrationMarks) {
        drawRegistrationMarks(dCtx, docPxW, docPxH, regPaddingPx, '#000000');
      }
      return docCanvas;
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

    const visibleLayers = artLayers.filter((pl) => pl.visible);
    // Helper: get display name for a processed layer (works for both threshold and CMYK)
    const layerName = (pl: ProcessedLayer) =>
      pl.name ?? layers.find((l) => l.id === pl.id)?.name ?? pl.id;

    // ── PNG ──────────────────────────────────────────────────────────────────
    if (format === 'png') {
      if (mode === 'dtg') {
        const blob = await canvasToBlob(buildCompositeCanvas(true));
        saveAs(blob, `${baseName}-dtg.png`);
      } else {
        const zip    = new JSZip();
        const folder = zip.folder('screen-print')!;
        for (const pl of visibleLayers) {
          folder.file(`${layerName(pl).toLowerCase()}.png`, await canvasToBlob(buildLayerCanvas(pl, true)));
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
            { name: 'Composite', canvas: buildCompositeCanvas(true), top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
          ],
        });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-dtg.psd`);
      } else {
        const psdLayers = visibleLayers.map((pl) => ({
          name:      layerName(pl),
          canvas:    buildLayerCanvas(pl, true),
          top:       0,
          left:      0,
          blendMode: 'normal' as const,
          opacity:   1,
        }));
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
        await addPage(buildCompositeCanvas(true));
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
        const buf = encodeTiff(getPixels(buildCompositeCanvas(true)), documentDpi);
        saveAs(new Blob([buf], { type: 'image/tiff' }), `${baseName}-dtg.tiff`);
      } else {
        const zip    = new JSZip();
        const folder = zip.folder('screen-print-tiff')!;
        for (const pl of visibleLayers) {
          const buf = encodeTiff(getPixels(buildLayerCanvas(pl, true)), documentDpi);
          folder.file(`${layerName(pl).toLowerCase()}.tiff`, buf);
        }
        folder.file('composite.tiff', encodeTiff(getPixels(buildCompositeCanvas(true)), documentDpi));
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen-tiff.zip`);
      }
    }
  };

  return (
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} onLogout={logout} firstName={session?.firstName} userEmail={session?.email} subscriptionExpiresAt={session?.subscriptionExpiresAt} />
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
