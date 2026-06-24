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
import { MockupPreview } from './components/MockupPreview';
import { PresetsModal } from './components/PresetsModal';
import { EulaModal } from './components/EulaModal';
import { FaqModal } from './components/FaqModal';
import { useStore } from './store/useStore';
import { paletteSeparate, renderPaletteComposite, bayerOrder } from './engine/colorSeparation';
import {
  processImage, applyKnockout, renderComposite, renderCmykSmooth, garmentRgbFromParam,
  drawRegistrationMarks, computeBackgroundMask,
  cmykSeparate, contrastColor, hexToRgb,
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
  const { status, session, initiateLogin, switchAccount, logout } = useAuth();
  const [showExport, setShowExport] = useState(false);
  const [showEula, setShowEula]     = useState(false);
  const [showFaq, setShowFaq]       = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const { mockupOpen, setMockupOpen, presetsOpen, setPresetsOpen } = useStore();
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const {
    originalImage, layers, globalPattern, knockoutEnabled,
    bgRemovalEnabled, bgTolerance, regMarkPadding, imageAdjustments, canvasColor, showFabricBg,
    documentDpi, documentWidthIn, documentHeightIn, showRegistrationMarks, imageFileName,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    separationMode, cmykLpi, cmykAngles, cmykParams, cmykQuality,
    paletteColors, paletteVisibility, palettePattern, palettePatternScale,
    paletteDensity, paletteAngle, paletteSoftness,
    paintMasks,
    vectorSvg,
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
    return <LoginPage onLogin={initiateLogin} onSwitchAccount={switchAccount} />;
  }

  if (status === 'no-subscription') {
    return <SubscribePage firstName={session?.firstName} email={session?.email} onLogout={logout} onSwitchAccount={switchAccount} />;
  }

  const handleExport = async ({ mode: _mode, format, fileName }: ExportConfig) => {
    if (!originalImage) return;

    // ── Vector mode: download the traced SVG directly ────────────────────────
    if (separationMode === 'vector') {
      if (!vectorSvg) return;
      const blob = new Blob([vectorSvg], { type: 'image/svg+xml' });
      saveAs(blob, `${fileName || 'vector'}.svg`);
      return;
    }
    const mode = _mode;

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

    // Palette tile size — same logic as CanvasView so export matches the preview exactly
    const _palIsErrDiff = ['diffusion', 'atkinson', 'jarvis', 'stucki'].includes(palettePattern);
    const _palBN = bayerOrder(palettePattern);
    const _palCell = Math.max(1, Math.round(palettePatternScale * documentDpi / 300));
    const paletteTileSize = _palIsErrDiff
      ? Math.max(1, Math.round(palettePatternScale))
      : _palBN > 0 ? _palBN * _palCell : Math.max(2, _palCell);

    let artLayers: ProcessedLayer[];
    if (separationMode === 'cmyk') {
      // Cell size derived from LPI: output DPI / LPI = pixels per halftone dot
      artLayers = cmykSeparate(artImageData, documentDpi / cmykLpi, artBgMask, cmykAngles, 1, cmykParams);
    } else if (separationMode === 'palette') {
      artLayers = paletteSeparate(
        artImageData, paletteColors, artBgMask,
        palettePattern, paletteTileSize, imageAdjustments,
        paletteDensity, paletteAngle, paletteSoftness,
      ).filter(l => paletteVisibility[l.id] !== false);
    } else {
      const resolved = resolvePatterns(layers, globalPattern);
      artLayers = processImage(artImageData, resolved, false, artBgMask, imageAdjustments, exportScaleFactor);
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (const layer of artLayers) {
          for (let i = 0; i < layer.mask.length; i++) {
            if (texMask[i] === 0) layer.mask[i] = 0;
          }
        }
      }
    }

    // Apply paint masks (scale from preview to export resolution)
    const pds2 = Math.min(MAX_PREVIEW_DIM / Math.max(artScaleW, artScaleH), 1.0);
    const pmW = Math.round(artScaleW * pds2);
    const pmH = Math.round(artScaleH * pds2);
    const pmScaleX = artScaleW / Math.max(1, pmW);
    const pmScaleY = artScaleH / Math.max(1, pmH);
    for (const layer of artLayers) {
      const pm = paintMasks[layer.id];
      if (!pm) continue;
      for (let y = 0; y < artScaleH; y++) {
        for (let x = 0; x < artScaleW; x++) {
          const sx = Math.min(pmW - 1, Math.floor(x / pmScaleX));
          const sy = Math.min(pmH - 1, Math.floor(y / pmScaleY));
          const pv = pm[sy * pmW + sx];
          if (pv === 1) layer.mask[y * artScaleW + x] = 255;
          else if (pv === 2) layer.mask[y * artScaleW + x] = 0;
        }
      }
    }

    // Knockout after paint masks — upper layers remove pixels from lower layers
    if (separationMode !== 'cmyk' && knockoutEnabled) applyKnockout(artLayers);

    // Expand extra colors at export resolution
    if (separationMode !== 'cmyk') {
      const base = [...artLayers];
      artLayers = base.flatMap((pl) => {
        const cfg = layers.find((l) => l.id === pl.id);
        const extras = (cfg?.extraColors ?? []).map((ec, i) => {
          const [r, g, b] = hexToRgb(ec);
          return { ...pl, id: `${pl.id}:ec${i}`, color: [r, g, b] as [number, number, number] };
        });
        return [pl, ...extras];
      });
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
        drawRegistrationMarks(canvas.getContext('2d')!, docPxW, docPxH, regPaddingPx, contrastColor(canvasColor));
      }
      return canvas;
    };

    // CMYK-only: grayscale positive plate — black where ink prints, white where it doesn't.
    // This is the standard film/screen format used by RIPs and screen printers.
    const buildCmykPlateCanvas = (pl: ProcessedLayer): HTMLCanvasElement => {
      const data = new ImageData(docPxW, docPxH);
      for (let i = 0; i < docPxW * docPxH; i++) {
        data.data[i * 4] = 255; data.data[i * 4 + 1] = 255; data.data[i * 4 + 2] = 255; data.data[i * 4 + 3] = 255;
      }
      for (let ay = 0; ay < artScaleH; ay++) {
        for (let ax = 0; ax < artScaleW; ax++) {
          if (pl.mask[ay * artScaleW + ax] !== 255) continue;
          const dx = artOffX + ax, dy = artOffY + ay;
          if (dx < 0 || dx >= docPxW || dy < 0 || dy >= docPxH) continue;
          const pi = (dy * docPxW + dx) * 4;
          data.data[pi] = 0; data.data[pi + 1] = 0; data.data[pi + 2] = 0; data.data[pi + 3] = 255;
        }
      }
      return canvasFromImageData(data);
    };

    // Helper: derive garment hex string from cmykParams.garmentColor (0-100)
    const garmentHex = (() => {
      const [r, g, b] = garmentRgbFromParam(cmykParams.garmentColor ?? 0);
      return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
    })();

    const buildCompositeCanvas = (withMarks: boolean, overrideGarment?: string): HTMLCanvasElement => {
      const effectiveGarment = overrideGarment ?? garmentHex;
      const [gR, gG, gB] = overrideGarment
        ? overrideGarment.match(/[\da-f]{2}/gi)!.map(h => parseInt(h, 16)) as [number,number,number]
        : garmentRgbFromParam(cmykParams.garmentColor ?? 0);
      const overrideParams = overrideGarment
        ? { ...cmykParams, garmentColor: Math.round(100 - (gR + gG + gB) / 3 / 2.55) }
        : cmykParams;

      const artComposite = separationMode === 'cmyk'
        ? renderCmykSmooth(artImageData, artBgMask, { 'cmyk-k': true, 'cmyk-c': true, 'cmyk-m': true, 'cmyk-y': true }, overrideParams)
        : separationMode === 'palette'
          ? renderPaletteComposite(artImageData, paletteColors, artBgMask,
              Object.fromEntries(paletteColors.map((_, i) => [`palette-${i}`, true])),
              palettePattern, paletteTileSize, imageAdjustments,
              paletteDensity, paletteAngle, paletteSoftness)
          : renderComposite(artLayers, artScaleW, artScaleH, true, '#ffffff', !knockoutEnabled);
      const docCanvas = document.createElement('canvas');
      docCanvas.width = docPxW; docCanvas.height = docPxH;
      const dCtx = docCanvas.getContext('2d')!;
      if (separationMode === 'cmyk') {
        dCtx.fillStyle = effectiveGarment;
        dCtx.fillRect(0, 0, docPxW, docPxH);
      } else if (separationMode === 'palette' && showFabricBg) {
        dCtx.fillStyle = canvasColor;
        dCtx.fillRect(0, 0, docPxW, docPxH);
      }
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
      } else if (separationMode === 'cmyk') {
        // Plates (grayscale positives) + proofs on white and on garment
        const zip    = new JSZip();
        const plates = zip.folder('plates')!;
        for (const pl of visibleLayers) {
          plates.file(`${layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-')}.png`, await canvasToBlob(buildCmykPlateCanvas(pl)));
        }
        zip.file('proof-on-garment.png', await canvasToBlob(buildCompositeCanvas(false)));
        zip.file('proof-on-white.png',   await canvasToBlob(buildCompositeCanvas(false, '#ffffff')));
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-cmyk-plates.zip`);
      } else if (separationMode === 'palette') {
        // Single composite PNG for Color Match
        const blob = await canvasToBlob(buildCompositeCanvas(false));
        saveAs(blob, `${baseName}-dither.png`);
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
      } else if (separationMode === 'cmyk') {
        // True separation PSD:
        // • Bottom: Garment fill (the substrate — change to any color without affecting plates)
        // • Middle: Color Proof — pre-rendered by our engine, Normal blend, fully opaque.
        //   Correct on any Photoshop background, no Multiply dependency.
        // • Top group: Grayscale halftone plates (black=ink, white=no ink), hidden by default.
        //   Toggle individual plates to inspect or send to RIP.

        // Garment layer
        const garmentCanvas = document.createElement('canvas');
        garmentCanvas.width = docPxW; garmentCanvas.height = docPxH;
        garmentCanvas.getContext('2d')!.fillStyle = garmentHex;
        garmentCanvas.getContext('2d')!.fillRect(0, 0, docPxW, docPxH);

        // Color proof — rendered on garment by our engine, no blend modes needed
        const proofCanvas = buildCompositeCanvas(false);

        // Grayscale plates (hidden — data, not display)
        const plateLayers = visibleLayers.map((pl) => ({
          name:    layerName(pl) + ' [Plate]',
          canvas:  buildCmykPlateCanvas(pl),
          top: 0, left: 0,
          blendMode: 'normal' as const,
          opacity: 1,
          hidden: true,
        }));

        const buffer = writePsd({
          width: docPxW, height: docPxH,
          children: [
            { name: 'Garment',     canvas: garmentCanvas, top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            { name: 'Color Proof', canvas: proofCanvas,   top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            ...plateLayers,
          ],
        });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-cmyk.psd`);
      } else if (separationMode === 'palette') {
        // PSD: White background + colored dithered ink layers
        const whiteBg = document.createElement('canvas');
        whiteBg.width = docPxW; whiteBg.height = docPxH;
        whiteBg.getContext('2d')!.fillStyle = '#ffffff';
        whiteBg.getContext('2d')!.fillRect(0, 0, docPxW, docPxH);
        const plateLayers = visibleLayers.map((pl) => ({
          name:    layerName(pl),
          canvas:  buildLayerCanvas(pl, false),
          top: 0, left: 0, blendMode: 'normal' as const, opacity: 1,
        }));
        const buffer = writePsd({
          width: docPxW, height: docPxH,
          children: [
            { name: 'White Paper', canvas: whiteBg,               top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            { name: 'Color Proof', canvas: buildCompositeCanvas(false), top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            ...plateLayers,
          ],
        });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-color-match.psd`);
      } else {
        const psdLayers = visibleLayers.map((pl) => ({
          name:      layerName(pl),
          canvas:    buildLayerCanvas(pl, true),
          top:       0, left:      0,
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

      if (separationMode === 'palette' || mode === 'dtg') {
        await addPage(buildCompositeCanvas(false));
      } else {
        for (const pl of visibleLayers) await addPage(buildLayerCanvas(pl, true));
        await addPage(buildCompositeCanvas(true));
      }

      const suffix = separationMode === 'palette' ? 'dither' : mode;
      const pdfBytes = await pdfDoc.save();
      saveAs(new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), `${baseName}-${suffix}.pdf`);
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

  const subStatus = session?.subscriptionStatus;
  const isPaused = subStatus === 'paused' || subStatus === 'cancelled' || subStatus === 'canceled';

  return (
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} onMockup={() => setMockupOpen(true)} onPresets={() => setPresetsOpen(true)} onLogout={logout} firstName={session?.firstName} userEmail={session?.email} subscriptionExpiresAt={session?.subscriptionExpiresAt} planTitle={session?.planTitle} subscriptionStatus={subStatus} />

      {isPaused && (
        <div style={{
          background: '#7c5a00', borderBottom: '1px solid #a87a00',
          padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, fontFamily: 'var(--font-mono)', color: '#ffd966',
          flexShrink: 0,
        }}>
          <span>
            <span style={{ marginRight: 8 }}>⚠</span>
            Your subscription is <strong>{subStatus}</strong>. You have 30 minutes of access remaining.{' '}
            <a
              href="https://www.charleypangus.com/collections/webapps"
              target="_blank" rel="noopener noreferrer"
              style={{ color: '#ffd966', textDecoration: 'underline' }}
            >
              Resubscribe to continue
            </a>
          </span>
        </div>
      )}

      <div className="workspace">
        <div className={`panel-wrap panel-wrap--left${leftOpen ? '' : ' panel-wrap--closed'}`}>
          <LayerPanel />
        </div>
        <button
          className="panel-tab panel-tab--left"
          title={leftOpen ? 'Hide left panel' : 'Show left panel'}
          onClick={() => setLeftOpen(o => !o)}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.8">
            {leftOpen
              ? <polyline points="6 1 2 6 6 11" />
              : <polyline points="2 1 6 6 2 11" />}
          </svg>
        </button>
        <CanvasView />
        <button
          className="panel-tab panel-tab--right"
          title={rightOpen ? 'Hide right panel' : 'Show right panel'}
          onClick={() => setRightOpen(o => !o)}
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.8">
            {rightOpen
              ? <polyline points="2 1 6 6 2 11" />
              : <polyline points="6 1 2 6 6 11" />}
          </svg>
        </button>
        <div className={`panel-wrap panel-wrap--right${rightOpen ? '' : ' panel-wrap--closed'}`}>
          <ControlPanel cmykQuality={cmykQuality} />
        </div>
      </div>
      {showExport && (
        <ExportModal
          onClose={() => setShowExport(false)}
          onExport={handleExport}
          defaultFileName={imageFileName.replace(/\.[^.]+$/, '') || 'autothresh'}
          separationMode={separationMode}
        />
      )}
      {mockupOpen && (
        <MockupPreview onClose={() => setMockupOpen(false)} />
      )}
      {presetsOpen && session?.token && (
        <PresetsModal token={session.token} onClose={() => setPresetsOpen(false)} />
      )}
      <footer style={{
        height: 28, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
          Designed &amp; Developed by Charley Pangus
        </span>
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>
          AutoThresh® | 2026 All Rights Reserved
        </span>
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <a href="https://www.charleypangus.com" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', textDecoration: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          www.charleypangus.com
        </a>
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <a href="https://www.instagram.com/charleypangus" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
            <circle cx="12" cy="12" r="4"/>
            <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
          </svg>
          @charleypangus
        </a>
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <a href="https://charleypangus.com/pages/support" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', textDecoration: 'none' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          Support
        </a>
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <button onClick={() => setShowFaq(true)}
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          FAQ
        </button>
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <button onClick={() => setShowEula(true)}
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          EULA
        </button>
      </footer>
      {showFaq  && <FaqModal  onClose={() => setShowFaq(false)}  />}
      {showEula && <EulaModal onClose={() => setShowEula(false)} />}
    </div>
  );
}

export default App;
