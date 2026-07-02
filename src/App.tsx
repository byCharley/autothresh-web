import { useState, useEffect } from 'react';
import { useAuth } from './auth/useAuth';
import { initBetaFeatures } from './auth/betaFeatures';
import { LoginPage } from './components/LoginPage';
import { SubscribePage } from './components/SubscribePage';
import { MobileLayout } from './components/MobileLayout';
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
import { BetaNoticeModal, shouldShowBetaNotice } from './components/BetaNoticeModal';
import { WhatsNewModal, hasUnseenUpdates, markChangelogSeen } from './components/WhatsNewModal';
import { ContactModal } from './components/ContactModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import { LoginSplash } from './components/LoginSplash';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { useStore } from './store/useStore';
import { useHistorySync } from './hooks/useHistorySync';
import { paletteSeparate, renderPaletteComposite, bayerOrder } from './engine/colorSeparation';
import { colorSeparate, renderColorSepComposite } from './engine/colorSeparator';
import type { RGB } from './engine/colorSeparation';
import {
  processImage, applyKnockout, renderComposite, renderCmykSmooth, garmentRgbFromParam,
  drawRegistrationMarks, computeBackgroundMask,
  cmykSeparate, contrastColor, hexToRgb, applyGlobalAdjustments,
} from './engine/imageProcessor';
import type { LayerConfig, PatternConfig, ProcessedLayer, PatternType } from './engine/imageProcessor';
import { generateTextureMask } from './engine/textureGenerator';
import { applyFabricBlend } from './engine/fabricBlend';
import { buildImportanceMap } from './engine/analysisPass';
import { encodeTiff, encodeEps } from './engine/exportFormats';
import { isShadowColor, nearestPantone } from './engine/pantoneMatch';
import { separateCmykPro, applyHalftoneToCmykPlates } from './engine/cmykProEngine';
import { generateCmykProUnderbase, chokeWhitePlate } from './engine/underbaseEngine';
import { compositeHalftonePlates, buildNeugebauerPrimaries } from './engine/inkSimulator';

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

// Inject a pHYs chunk into PNG bytes so Photoshop/browsers read the correct DPI.
// The pHYs chunk must come immediately after IHDR (byte 33 in any valid PNG).
function injectPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc32 = (buf: Uint8Array, off: number, len: number): number => {
    let c = 0xFFFFFFFF;
    for (let i = off; i < off + len; i++) c = table[(c ^ buf[i]) & 0xFF]! ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const ppm = Math.round(dpi * 39.3701); // pixels per metre
  const phys = new Uint8Array(21); // 4 length + 4 type + 9 data + 4 CRC
  const dv = new DataView(phys.buffer);
  dv.setUint32(0, 9, false);
  phys[4] = 0x70; phys[5] = 0x48; phys[6] = 0x59; phys[7] = 0x73; // 'pHYs'
  dv.setUint32(8, ppm, false);
  dv.setUint32(12, ppm, false);
  phys[16] = 1; // unit: metre
  dv.setUint32(17, crc32(phys, 4, 13), false);
  const out = new Uint8Array(pngBytes.length + 21);
  out.set(pngBytes.subarray(0, 33));
  out.set(phys, 33);
  out.set(pngBytes.subarray(33), 54);
  return out;
}

async function canvasToBlobWithDpi(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const bytes = await canvasToPngBytes(canvas);
  const patched = injectPngDpi(bytes, dpi);
  return new Blob([patched.buffer.slice(patched.byteOffset, patched.byteOffset + patched.byteLength) as ArrayBuffer], { type: 'image/png' });
}

initBetaFeatures();

function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  // Block phones only — tablets (iPad, Android tablets) are allowed through
  const phoneUA = /webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const tinyScreen = window.innerWidth < 768;
  return phoneUA || tinyScreen;
}

function App() {
  useHistorySync();
  const { status, session, initiateLogin, switchAccount, logout } = useAuth();
  const [showExport, setShowExport] = useState(false);
  const [showEula, setShowEula]         = useState(false);
  const [showFaq, setShowFaq]           = useState(false);
  const [showBetaNotice, setShowBetaNotice] = useState(() => shouldShowBetaNotice());
  const [showWhatsNew, setShowWhatsNew]   = useState(false);
  const [hasUpdates, setHasUpdates]       = useState(() => hasUnseenUpdates());
  const [showContact, setShowContact]     = useState(false);
  const [showTutorial, setShowTutorial]   = useState(false);
  const [showVideo, setShowVideo]         = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  // Read the flag immediately so the splash is true on the very first render
  // after the OAuth redirect — no waiting for auth to complete.
  const [showSplash, setShowSplash] = useState(() => !!sessionStorage.getItem('at-pending-welcome'));

  const handleLogin = () => {
    sessionStorage.setItem('at-pending-welcome', '1');
    initiateLogin();
  };

  // Clear the flag once auth lands — the splash timer handles its own dismissal.
  useEffect(() => {
    if (status === 'authenticated') {
      sessionStorage.removeItem('at-pending-welcome');
    }
  }, [status]);
  const [leftOpen, setLeftOpen]   = useState(true);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1100);
  const { mockupOpen, setMockupOpen, presetsOpen, setPresetsOpen } = useStore();
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const {
    originalImage, layers, globalPattern, knockoutEnabled,
    bgRemovalEnabled, bgTolerance, regMarkPadding, documentBleed, imageAdjustments, canvasColor, showFabricBg,
    documentDpi, documentWidthIn, documentHeightIn, showRegistrationMarks, imageFileName,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    separationMode, cmykLpi, cmykAngles, cmykParams, cmykQuality,
    proCmykSettings,
    paletteColors, paletteVisibility, palettePattern, palettePatternScale,
    paletteDensity, paletteAngle, paletteSoftness,
    colorSepNumColors, colorSepColorPriority, colorSepPattern, colorSepPatternScale,
    colorSepPatternDensity, colorSepPatternAngle, colorSepLockedColors, colorSepVisibility,
    paintMasks,
    vectorSvg,
    underbaseIncludeShadows, underbaseEnabled, underbaseDensity, underbaseChoke: storeUnderbaseChoke,
    passthroughMode, bgSeedColors, bgPaintMask, bgPaintMaskDims,
    fabricTexture, fabricBlendStrength, fabricTextureDepth,
  } = useStore();

  useEffect(() => {
    const check = () => setIsMobile(isMobileDevice());
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);


  if (status === 'loading') {
    return (
      <>
        <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
            Verifying…
          </div>
        </div>
        {showSplash && <LoginSplash firstName={session?.firstName} email={session?.email} onDone={() => setShowSplash(false)} />}
      </>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage onLogin={handleLogin} onSwitchAccount={switchAccount} />;
  }

  if (status === 'no-subscription') {
    return <SubscribePage firstName={session?.firstName} email={session?.email} onLogout={logout} onSwitchAccount={switchAccount} />;
  }

  function buildColorRefCanvas(refColors: RGB[]): HTMLCanvasElement {
    const S = 56, labelH = 28, gap = 6, pad = 14;
    const cols = Math.min(refColors.length, 5);
    const rows = Math.ceil(refColors.length / cols);
    const w = pad * 2 + cols * S + (cols - 1) * gap;
    const h = pad * 2 + rows * (S + labelH) + (rows - 1) * gap;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    refColors.forEach(([r, g, b], i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = pad + col * (S + gap), y = pad + row * (S + labelH + gap);
      const hexVal = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      ctx.fillStyle = hexVal;
      ctx.fillRect(x, y, S, S);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Color ${i + 1}`, x + S / 2, y + S + 11);
      ctx.fillStyle = '#666666';
      ctx.font = '8px monospace';
      ctx.fillText(hexVal, x + S / 2, y + S + 22);
    });
    return c;
  }

  const handleExport = async ({ mode: _mode, format, fileName, includeColorInfo, usePantoneNames, underbase, underbaseChoke }: ExportConfig) => {
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
    const bleedPx     = Math.round(documentBleed * documentDpi);
    const innerDocPxW = Math.round(documentWidthIn  * documentDpi);
    const innerDocPxH = Math.round(documentHeightIn * documentDpi);
    const docPxW      = innerDocPxW + 2 * bleedPx;
    const docPxH      = innerDocPxH + 2 * bleedPx;
    const ow = originalImage.width, oh = originalImage.height;
    const sf = Math.min(innerDocPxW / ow, innerDocPxH / oh);
    const artScaleW = Math.round(ow * sf);
    const artScaleH = Math.round(oh * sf);
    const artOffX   = bleedPx + Math.round((innerDocPxW - artScaleW) / 2);
    const artOffY   = bleedPx + Math.round((innerDocPxH - artScaleH) / 2);

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

    // ── Passthrough mode: flat PNG export (bypasses all separation) ─────────────
    if (passthroughMode) {
      const imgData = artImageData;
      if (bgRemovalEnabled) {
        const bgMask = computeBackgroundMask(imgData, bgTolerance, bgSeedColors.length > 0 ? bgSeedColors : undefined);
        if (bgPaintMask && bgPaintMaskDims) {
          const { w: pmW, h: pmH } = bgPaintMaskDims;
          const scaleX = artScaleW / pmW;
          const scaleY = artScaleH / pmH;
          for (let y = 0; y < artScaleH; y++) {
            for (let x = 0; x < artScaleW; x++) {
              const sx = Math.min(pmW - 1, Math.floor(x / scaleX));
              const sy = Math.min(pmH - 1, Math.floor(y / scaleY));
              const pv = bgPaintMask[sy * pmW + sx];
              if (pv === 1) bgMask[y * artScaleW + x] = 0;
              else if (pv === 2) bgMask[y * artScaleW + x] = 255;
            }
          }
        }
        for (let i = 0; i < bgMask.length; i++) {
          if (bgMask[i] === 255) imgData.data[i * 4 + 3] = 0;
        }
      }
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (let i = 0; i < texMask.length; i++) {
          if (texMask[i] === 0) imgData.data[i * 4 + 3] = 0;
        }
      }
      // Put processed artwork on a temp canvas (preserves transparency)
      const artCanvas = document.createElement('canvas');
      artCanvas.width = artScaleW; artCanvas.height = artScaleH;
      artCanvas.getContext('2d')!.putImageData(imgData, 0, 0);
      // Build output canvas — fill background if enabled, then composite artwork
      const flatCanvas = document.createElement('canvas');
      flatCanvas.width = artScaleW; flatCanvas.height = artScaleH;
      const flatCtx = flatCanvas.getContext('2d')!;
      if (showFabricBg) {
        flatCtx.fillStyle = canvasColor;
        flatCtx.fillRect(0, 0, artScaleW, artScaleH);
      }
      flatCtx.drawImage(artCanvas, 0, 0);
      // Apply fabric texture blend on top of the combined result
      if (showFabricBg && fabricTexture !== 'none') {
        const fabricPath = fabricTexture === 'light'
          ? '/textures/White_Fabric_ATW.png'
          : '/textures/Black_Fabric_ATW.png';
        const fabData = await new Promise<ImageData | null>((resolve) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            c.getContext('2d')!.drawImage(img, 0, 0);
            resolve(c.getContext('2d')!.getImageData(0, 0, c.width, c.height));
          };
          img.onerror = () => resolve(null);
          img.src = fabricPath;
        });
        if (fabData) {
          const combined = flatCtx.getImageData(0, 0, artScaleW, artScaleH);
          applyFabricBlend(combined, fabData, {
            garmentType: fabricTexture,
            blendStrength: fabricBlendStrength,
            textureDepth: fabricTextureDepth,
            canvasRgb: hexToRgb(canvasColor),
          });
          flatCtx.putImageData(combined, 0, 0);
        }
      }
      flatCanvas.toBlob(blob => {
        if (blob) saveAs(blob, `${fileName || 'autothresh'}.png`);
      }, 'image/png');
      return;
    }

    const importanceMap = buildImportanceMap(artImageData, artBgMask);

    // Palette tile size — same logic as CanvasView so export matches the preview exactly
    const _palIsErrDiff = ['diffusion', 'atkinson', 'jarvis', 'stucki'].includes(palettePattern);
    const _palBN = bayerOrder(palettePattern);
    const _palCell = Math.max(1, Math.round(palettePatternScale * documentDpi / 300));
    const paletteTileSize = _palIsErrDiff
      ? Math.max(1, Math.round(palettePatternScale))
      : _palBN > 0 ? _palBN * _palCell : Math.max(2, _palCell);

    // Helper: apply image adjustments to a full-res ImageData (mirrors CanvasView's applyAdjToImage)
    function applyAdjToImageData(img: ImageData): ImageData {
      const adj = imageAdjustments;
      const isNoop = adj.adjMode === 'basic' &&
        adj.exposure === 0 && adj.contrast === 0 &&
        adj.shadows === 0 && adj.highlights === 0 && adj.blur === 0;
      if (isNoop) return img;
      const result = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      const rd = result.data;
      const n = img.width * img.height;
      for (let i = 0; i < n; i++) {
        if (rd[i * 4 + 3] < 128) continue;
        const r = rd[i * 4], g = rd[i * 4 + 1], b = rd[i * 4 + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const adjLum = applyGlobalAdjustments(lum, adj);
        if (lum < 1) {
          const v = adjLum | 0;
          rd[i * 4] = v; rd[i * 4 + 1] = v; rd[i * 4 + 2] = v;
        } else {
          const scale = adjLum / lum;
          rd[i * 4]     = Math.min(255, (r * scale + 0.5)) | 0;
          rd[i * 4 + 1] = Math.min(255, (g * scale + 0.5)) | 0;
          rd[i * 4 + 2] = Math.min(255, (b * scale + 0.5)) | 0;
        }
      }
      return result;
    }

    // color-sep composite data — populated in the color-sep branch, used by buildCompositeCanvas
    let csExportImageData: ImageData | null = null;
    let csExportColors: RGB[] = [];
    let csExportSettings: { numColors: number; colorPriority: number; pattern: PatternType; patternScale: number; patternDensity: number; patternAngle: number } | null = null;

    let artLayers: ProcessedLayer[];
    if (separationMode === 'cmyk') {
      // Cell size derived from LPI: output DPI / LPI = pixels per halftone dot
      artLayers = cmykSeparate(artImageData, documentDpi / cmykLpi, artBgMask, cmykAngles, 1, cmykParams);
    } else if (separationMode === 'cmyk-pro') {
      // ICC-based separation + per-channel halftone screening
      const plates = await separateCmykPro(artImageData, proCmykSettings);
      let exportWhitePlate: Uint8Array | undefined;
      if (underbaseEnabled) {
        const raw = generateCmykProUnderbase(plates, { density: underbaseDensity, includeShadows: underbaseIncludeShadows });
        exportWhitePlate = chokeWhitePlate(raw, plates.width, plates.height, storeUnderbaseChoke);
      }
      artLayers = applyHalftoneToCmykPlates(plates, proCmykSettings, documentDpi, artBgMask, exportWhitePlate);
    } else if (separationMode === 'palette') {
      artLayers = paletteSeparate(
        artImageData, paletteColors, artBgMask,
        palettePattern, paletteTileSize, imageAdjustments,
        paletteDensity, paletteAngle, paletteSoftness, importanceMap,
      ).filter(l => paletteVisibility[l.id] !== false);
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (const layer of artLayers) {
          const [lr, lg, lb] = layer.color;
          if (isShadowColor(lr, lg, lb)) continue;
          for (let i = 0; i < layer.mask.length; i++) {
            if (texMask[i] === 0) layer.mask[i] = 0;
          }
        }
      }
    } else if (separationMode === 'color-sep') {
      const adjImageData = applyAdjToImageData(artImageData);
      csExportImageData = adjImageData;
      csExportSettings = {
        numColors:      colorSepNumColors,
        colorPriority:  colorSepColorPriority / 100,
        pattern:        colorSepPattern,
        patternScale:   colorSepPatternScale,
        patternDensity: colorSepPatternDensity,
        patternAngle:   colorSepPatternAngle,
      };
      const { layers: csLayers, colors } = colorSeparate(adjImageData, csExportSettings, artBgMask, colorSepLockedColors ?? undefined, importanceMap);
      csExportColors = colors;
      artLayers = csLayers.filter(l => colorSepVisibility[l.id] !== false);
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (const layer of artLayers) {
          const [lr, lg, lb] = layer.color;
          if (isShadowColor(lr, lg, lb)) continue;
          for (let i = 0; i < layer.mask.length; i++) {
            if (texMask[i] === 0) layer.mask[i] = 0;
          }
        }
      }
    } else {
      const resolved = resolvePatterns(layers, globalPattern);
      artLayers = processImage(artImageData, resolved, false, artBgMask, imageAdjustments, exportScaleFactor, importanceMap);
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (const layer of artLayers) {
          const [lr, lg, lb] = layer.color;
          if (isShadowColor(lr, lg, lb)) continue;
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
    if (separationMode !== 'cmyk' && separationMode !== 'cmyk-pro' && knockoutEnabled) applyKnockout(artLayers);

    // Expand extra colors at export resolution
    if (separationMode !== 'cmyk' && separationMode !== 'cmyk-pro') {
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

    // Texture knockout mask for export — applied to layers and composite so holes are
    // physically removed from ink rather than overlaid on top.
    const exportTexMask = (textureEnabled && separationMode !== 'cmyk' && separationMode !== 'cmyk-pro')
      ? generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed)
      : null;

    // ── Build per-layer canvas: place artwork mask at its offset in the doc ──
    const buildLayerCanvas = (pl: typeof artLayers[number], withMarks: boolean): HTMLCanvasElement => {
      const [r, g, b] = pl.color;
      const data = new ImageData(docPxW, docPxH);
      for (let ay = 0; ay < artScaleH; ay++) {
        for (let ax = 0; ax < artScaleW; ax++) {
          if (pl.mask[ay * artScaleW + ax] !== 255) continue;
          if (exportTexMask && exportTexMask[ay * artScaleW + ax] === 0) continue;
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
      const c = canvasFromImageData(data);
      if (showRegistrationMarks) {
        drawRegistrationMarks(c.getContext('2d')!, docPxW, docPxH, regPaddingPx, '#000000');
      }
      return c;
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

      let artComposite: ImageData;
      if (separationMode === 'cmyk') {
        artComposite = renderCmykSmooth(artImageData, artBgMask, { 'cmyk-k': true, 'cmyk-c': true, 'cmyk-m': true, 'cmyk-y': true }, overrideParams);
      } else if (separationMode === 'palette') {
        artComposite = renderPaletteComposite(artImageData, paletteColors, artBgMask,
          Object.fromEntries(paletteColors.map((_, i) => [`palette-${i}`, true])),
          palettePattern, paletteTileSize, imageAdjustments,
          paletteDensity, paletteAngle, paletteSoftness, importanceMap);
      } else if (separationMode === 'color-sep' && csExportImageData && csExportSettings) {
        artComposite = renderColorSepComposite(csExportImageData, csExportColors, colorSepVisibility, csExportSettings, artBgMask, importanceMap);
      } else {
        artComposite = renderComposite(artLayers, artScaleW, artScaleH, true, '#ffffff', !knockoutEnabled);
      }
      // Knock texture out of composite for palette/color-sep (rendered from raw image, no layer masks).
      // For thresh/screen modes, texture is already knocked out of non-shadow layer masks by renderComposite —
      // applying exportTexMask here would incorrectly punch through the solid shadow layer too.
      if (exportTexMask && (separationMode === 'palette' || separationMode === 'color-sep')) {
        for (let i = 0; i < exportTexMask.length; i++) {
          if (exportTexMask[i] === 0) artComposite.data[i * 4 + 3] = 0;
        }
      }
      const docCanvas = document.createElement('canvas');
      docCanvas.width = docPxW; docCanvas.height = docPxH;
      const dCtx = docCanvas.getContext('2d')!;
      if (separationMode === 'cmyk') {
        dCtx.fillStyle = effectiveGarment;
        dCtx.fillRect(0, 0, docPxW, docPxH);
      } else if (showFabricBg) {
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

    // ── Underbase builder (white ink, all visible masks combined + choke) ──────
    const buildUnderbaseCanvas = (chokePx: number): HTMLCanvasElement => {
      const combined = new Uint8Array(artScaleW * artScaleH);
      for (const pl of visibleLayers) {
        const [r, g, b] = pl.color;
        if (!underbaseIncludeShadows && isShadowColor(r, g, b)) continue;
        for (let i = 0; i < pl.mask.length; i++) {
          if (pl.mask[i] === 255) combined[i] = 255;
        }
      }
      let mask = combined;
      if (chokePx > 0) {
        mask = new Uint8Array(combined);
        for (let y = 0; y < artScaleH; y++) {
          for (let x = 0; x < artScaleW; x++) {
            if (combined[y * artScaleW + x] !== 255) continue;
            let erase = false;
            outer: for (let dy = -chokePx; dy <= chokePx; dy++) {
              for (let dx = -chokePx; dx <= chokePx; dx++) {
                if (Math.abs(dx) + Math.abs(dy) > chokePx) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= artScaleW || ny < 0 || ny >= artScaleH || combined[ny * artScaleW + nx] === 0) {
                  erase = true; break outer;
                }
              }
            }
            if (erase) mask[y * artScaleW + x] = 0;
          }
        }
      }
      const data = new ImageData(docPxW, docPxH);
      for (let ay = 0; ay < artScaleH; ay++) {
        for (let ax = 0; ax < artScaleW; ax++) {
          if (mask[ay * artScaleW + ax] !== 255) continue;
          if (exportTexMask && exportTexMask[ay * artScaleW + ax] === 0) continue;
          const dx = artOffX + ax, dy = artOffY + ay;
          if (dx < 0 || dx >= docPxW || dy < 0 || dy >= docPxH) continue;
          const pi = (dy * docPxW + dx) * 4;
          data.data[pi] = 255; data.data[pi + 1] = 255; data.data[pi + 2] = 255; data.data[pi + 3] = 255;
        }
      }
      return canvasFromImageData(data);
    };
    const ubLabel = `Underbase · #FFFFFF${underbaseChoke > 0 ? ` (${underbaseChoke}px choke)` : ''}`;
    const ubPsdLayer = underbase ? [{
      name: ubLabel,
      canvas: buildUnderbaseCanvas(underbaseChoke),
      top: 0, left: 0, blendMode: 'normal' as const, opacity: 1,
    }] : [];

    // Helper: get display name — Pantone override takes priority over default names
    const layerName = (pl: ProcessedLayer) => {
      const baseName = pl.name ?? layers.find((l) => l.id === pl.id)?.name ?? pl.id;
      if (usePantoneNames) {
        const [r, g, b] = pl.color;
        return `${baseName} · ${nearestPantone(r, g, b).name}`;
      }
      return baseName;
    };
    const toHex = ([r, g, b]: [number, number, number]) =>
      '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const layerNameHex = (pl: ProcessedLayer) => `${layerName(pl)} · ${toHex(pl.color)}`;

    // ── PNG ──────────────────────────────────────────────────────────────────
    const pngOf = (c: HTMLCanvasElement) => canvasToBlobWithDpi(c, documentDpi);
    if (format === 'png') {
      if (mode === 'dtg') {
        saveAs(await pngOf(buildCompositeCanvas(true)), `${baseName}-dtg.png`);
      } else if (separationMode === 'cmyk' || separationMode === 'cmyk-pro') {
        // Plates (grayscale positives) + proofs on white and on garment
        const zip    = new JSZip();
        const plates = zip.folder('plates')!;
        for (const pl of visibleLayers) {
          plates.file(`${layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-')}.png`, await pngOf(buildCmykPlateCanvas(pl)));
        }
        zip.file('proof-on-garment.png', await pngOf(buildCompositeCanvas(false)));
        zip.file('proof-on-white.png',   await pngOf(buildCompositeCanvas(false, '#ffffff')));
        const suffix = separationMode === 'cmyk-pro' ? 'cmyk-pro-plates' : 'cmyk-plates';
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-${suffix}.zip`);
      } else if (separationMode === 'palette') {
        if (underbase) {
          const zip = new JSZip();
          zip.file('underbase.png',  await pngOf(buildUnderbaseCanvas(underbaseChoke)));
          zip.file('composite.png',  await pngOf(buildCompositeCanvas(false)));
          saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-dither.zip`);
        } else {
          saveAs(await pngOf(buildCompositeCanvas(false)), `${baseName}-dither.png`);
        }
      } else {
        const zip    = new JSZip();
        const folder = zip.folder('screen-print')!;
        if (underbase) folder.file('underbase.png', await pngOf(buildUnderbaseCanvas(underbaseChoke)));
        for (const pl of visibleLayers) {
          folder.file(`${layerName(pl).toLowerCase()}.png`, await pngOf(buildLayerCanvas(pl, true)));
        }
        folder.file('composite.png', await pngOf(buildCompositeCanvas(true)));
        if (includeColorInfo) {
          const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors
            : artLayers.map(l => l.color as RGB);
          if (refColors.length > 0) folder.file('color-reference.png', await pngOf(buildColorRefCanvas(refColors)));
        }
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen.zip`);
      }
      return;
    }

    // ── PSD ──────────────────────────────────────────────────────────────────
    const psdRes = {
      imageResources: {
        resolutionInfo: {
          horizontalResolution: documentDpi,
          horizontalResolutionUnit: 'PPI' as const,
          widthUnit: 'Inches' as const,
          verticalResolution: documentDpi,
          verticalResolutionUnit: 'PPI' as const,
          heightUnit: 'Inches' as const,
        },
      },
    };
    if (format === 'psd') {
      if (mode === 'dtg') {
        const buffer = writePsd({
          width: docPxW, height: docPxH, ...psdRes,
          children: [
            bgLayer,
            { name: 'Composite', canvas: buildCompositeCanvas(true), top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
          ],
        });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-dtg.psd`);
      } else if (separationMode === 'cmyk' || separationMode === 'cmyk-pro') {
        if (separationMode === 'cmyk-pro') {
          // CMYK Pro PSD layer order (bottom → top): Garment Substrate, plate layers (hidden), Color Proof.
          const cmykOrder = ['cmyk-w', 'cmyk-y', 'cmyk-m', 'cmyk-c', 'cmyk-k'];
          const sorted = [...visibleLayers].sort((a, b) => {
            const ai = cmykOrder.indexOf(a.id);
            const bi = cmykOrder.indexOf(b.id);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });
          const plateLayers = sorted.map((pl) => ({
            name:   layerName(pl) + (pl.id === 'cmyk-w' ? ' [White Underbase]' : ' [Plate]'),
            canvas: buildCmykPlateCanvas(pl),
            top: 0, left: 0, blendMode: 'normal' as const, opacity: 1, hidden: true,
          }));

          // Proof rendered in 'light' mode (ink on neutral paper) so all channels —
          // including K — are clearly visible against the proof background.
          // The Garment Substrate layer below provides garment-color context.
          const proofData = compositeHalftonePlates(
            artLayers, artScaleW, artScaleH,
            buildNeugebauerPrimaries(proCmykSettings.cmykProfile),
            artBgMask, { c: true, m: true, y: true, k: true },
            'light',
          );
          const proofCanvas = document.createElement('canvas');
          proofCanvas.width = docPxW; proofCanvas.height = docPxH;
          const pCtx = proofCanvas.getContext('2d')!;
          pCtx.drawImage(canvasFromImageData(proofData), artOffX, artOffY);
          if (showRegistrationMarks) {
            drawRegistrationMarks(pCtx, docPxW, docPxH, regPaddingPx, '#000000');
          }

          const buffer = writePsd({
            width: docPxW, height: docPxH, ...psdRes,
            children: [
              ...plateLayers,
              { name: 'Color Proof', canvas: proofCanvas, top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            ],
          });
          saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-cmyk-pro.psd`);
        } else {
          // Legacy CMYK mode PSD
          const substrateCanvas = document.createElement('canvas');
          substrateCanvas.width = docPxW; substrateCanvas.height = docPxH;
          substrateCanvas.getContext('2d')!.fillStyle = garmentHex;
          substrateCanvas.getContext('2d')!.fillRect(0, 0, docPxW, docPxH);
          const plateLayers = visibleLayers.map((pl) => ({
            name: layerName(pl) + ' [Plate]',
            canvas: buildCmykPlateCanvas(pl),
            top: 0, left: 0, blendMode: 'normal' as const, opacity: 1, hidden: true,
          }));
          const buffer = writePsd({
            width: docPxW, height: docPxH, ...psdRes,
            children: [
              { name: 'Substrate', canvas: substrateCanvas, top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
              { name: 'Color Proof', canvas: buildCompositeCanvas(false), top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
              ...plateLayers,
            ],
          });
          saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-cmyk.psd`);
        }
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
          width: docPxW, height: docPxH, ...psdRes,
          children: [
            { name: 'White Paper', canvas: whiteBg,               top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            ...ubPsdLayer,
            { name: 'Color Proof', canvas: buildCompositeCanvas(false), top: 0, left: 0, blendMode: 'normal' as const, opacity: 1 },
            ...plateLayers,
          ],
        });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-color-match.psd`);
      } else {
        const psdLayers = visibleLayers.map((pl) => ({
          name:      layerNameHex(pl),
          canvas:    buildLayerCanvas(pl, true),
          top:       0, left:      0,
          blendMode: 'normal' as const,
          opacity:   1,
        }));
        const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors
          : artLayers.map(l => l.color as RGB);
        const colorRefLayer = (includeColorInfo && refColors.length > 0) ? [{
          name: 'Color Reference',
          canvas: buildColorRefCanvas(refColors),
          top: 0, left: 0,
          blendMode: 'normal' as const,
          opacity: 1,
        }] : [];
        const buffer = writePsd({ width: docPxW, height: docPxH, ...psdRes, children: [bgLayer, ...ubPsdLayer, ...psdLayers, ...colorRefLayer] });
        saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${baseName}-screen.psd`);
      }
      return;
    }

    // ── PDF ──────────────────────────────────────────────────────────────────
    if (format === 'pdf') {
      // PDF dimensions in points (72 pt = 1 inch), expanded by bleed
      const ptW = (documentWidthIn  + 2 * documentBleed) * 72;
      const ptH = (documentHeightIn + 2 * documentBleed) * 72;

      const pdfDoc = await PDFDocument.create();

      const addPage = async (canvas: HTMLCanvasElement) => {
        const pngBytes = await canvasToPngBytes(canvas);
        const img      = await pdfDoc.embedPng(pngBytes);
        const page     = pdfDoc.addPage([ptW, ptH]);
        page.drawImage(img, { x: 0, y: 0, width: ptW, height: ptH });
      };

      if (separationMode === 'palette' || mode === 'dtg') {
        if (underbase) await addPage(buildUnderbaseCanvas(underbaseChoke));
        await addPage(buildCompositeCanvas(false));
      } else {
        if (underbase) await addPage(buildUnderbaseCanvas(underbaseChoke));
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
        if (underbase) folder.file('underbase.tiff', encodeTiff(getPixels(buildUnderbaseCanvas(underbaseChoke)), documentDpi));
        for (const pl of visibleLayers) {
          const buf = encodeTiff(getPixels(buildLayerCanvas(pl, true)), documentDpi);
          folder.file(`${layerName(pl).toLowerCase()}.tiff`, buf);
        }
        folder.file('composite.tiff', encodeTiff(getPixels(buildCompositeCanvas(true)), documentDpi));
        if (includeColorInfo) {
          const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors
            : artLayers.map(l => l.color as RGB);
          if (refColors.length > 0) folder.file('color-reference.png', await canvasToBlob(buildColorRefCanvas(refColors)));
        }
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen-tiff.zip`);
      }
    }

    // ── EPS ──────────────────────────────────────────────────────────────────
    // Screen print: one grayscale-positive EPS per separation (black=ink,
    // white=no-ink), registration marks embedded, spot-color DSC headers
    // so RIP software (AccuRIP, Kothari, Separation Studio …) labels each channel.
    // CMYK/CMYK Pro use the same grayscale plate canvases as PNG/TIFF.
    // DTG / Palette: single composite RGB EPS.
    if (format === 'eps') {
      const epsOf = (canvas: HTMLCanvasElement, title: string, spotColor?: [number,number,number] | null) =>
        encodeEps(canvas, { dpi: documentDpi, title, spotColor: spotColor ?? null, grayscale: true });

      if (mode === 'dtg' || separationMode === 'palette') {
        // Single composite RGB EPS
        const eps = encodeEps(buildCompositeCanvas(false), { dpi: documentDpi, title: baseName, grayscale: false });
        saveAs(new Blob([eps.buffer as ArrayBuffer], { type: 'application/postscript' }), `${baseName}-composite.eps`);

      } else if (separationMode === 'cmyk' || separationMode === 'cmyk-pro') {
        // One grayscale plate EPS per CMYK channel
        const zip    = new JSZip();
        const folder = zip.folder('plates-eps')!;
        for (const pl of visibleLayers) {
          const name = layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-');
          folder.file(`${name}.eps`, epsOf(buildCmykPlateCanvas(pl), layerName(pl)));
        }
        const suffix = separationMode === 'cmyk-pro' ? 'cmyk-pro-eps' : 'cmyk-eps';
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-${suffix}.zip`);

      } else {
        // Screen-print separation modes: one EPS per color layer + optional underbase
        const zip    = new JSZip();
        const folder = zip.folder('screen-print-eps')!;
        if (underbase) {
          folder.file('underbase.eps', epsOf(buildUnderbaseCanvas(underbaseChoke), 'Underbase · #FFFFFF', [255, 255, 255]));
        }
        for (const pl of visibleLayers) {
          const name = layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-');
          folder.file(`${name}.eps`, epsOf(buildLayerCanvas(pl, true), layerName(pl), pl.color));
        }
        if (includeColorInfo) {
          const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors : artLayers.map(l => l.color as RGB);
          if (refColors.length > 0) folder.file('color-reference.png', await canvasToBlob(buildColorRefCanvas(refColors)));
        }
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen-eps.zip`);
      }
      return;
    }
  };

  const subStatus = session?.subscriptionStatus;
  const isPaused = subStatus === 'paused' || subStatus === 'cancelled' || subStatus === 'canceled';

  if (isMobile) {
    return (
      <MobileLayout
        onExport={() => setShowExport(true)}
        onMockup={() => setMockupOpen(true)}
        onLogout={logout}
        session={session}
      >
        {showExport && <ExportModal onClose={() => setShowExport(false)} onExport={handleExport} defaultFileName={imageFileName.replace(/\.[^.]+$/, '') || 'autothresh'} separationMode={separationMode} />}
        {mockupOpen && <MockupPreview onClose={() => setMockupOpen(false)} />}
        {presetsOpen && session?.token && <PresetsModal token={session.token} onClose={() => setPresetsOpen(false)} />}
        {showFaq      && <FaqModal      onClose={() => setShowFaq(false)} />}
        {showEula     && <EulaModal     onClose={() => setShowEula(false)} />}
        {showContact  && <ContactModal  onClose={() => setShowContact(false)} />}
        {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
        {showSplash   && <LoginSplash firstName={session?.firstName} email={session?.email} onDone={() => setShowSplash(false)} />}
      </MobileLayout>
    );
  }

  return (
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} onMockup={() => setMockupOpen(true)} onPresets={() => setPresetsOpen(true)} onTutorial={() => setShowTutorial(true)} onVideo={() => setShowVideo(true)} onAnalytics={() => setShowAnalytics(true)} onLogout={logout} firstName={session?.firstName} userEmail={session?.email} subscriptionExpiresAt={session?.subscriptionExpiresAt} planTitle={session?.planTitle} subscriptionStatus={subStatus} />

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
        <button onClick={() => setShowContact(true)}
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          Contact
        </button>
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
        <span style={{ fontSize: 9, color: 'var(--border-2)', userSelect: 'none' }}>·</span>
        <button
          onClick={() => {
            setShowWhatsNew(true);
            markChangelogSeen();
            setHasUpdates(false);
          }}
          style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: hasUpdates ? 'var(--accent)' : 'var(--text-dim)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 5 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = hasUpdates ? 'var(--accent)' : 'var(--text-dim)')}
        >
          {hasUpdates && (
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
          )}
          What's New
        </button>
      </footer>
      {showFaq      && <FaqModal      onClose={() => setShowFaq(false)}      />}
      {showEula     && <EulaModal     onClose={() => setShowEula(false)}     />}
      {showBetaNotice && <BetaNoticeModal onClose={() => setShowBetaNotice(false)} onContact={() => { setShowBetaNotice(false); setShowContact(true); }} />}
      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} onContact={() => { setShowWhatsNew(false); setShowContact(true); }} />}
      {showContact  && <ContactModal  onClose={() => setShowContact(false)}  />}
      {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
      {showSplash && <LoginSplash firstName={session?.firstName} email={session?.email} onDone={() => setShowSplash(false)} />}
      {showAnalytics && session && <AnalyticsDashboard session={session} onClose={() => setShowAnalytics(false)} />}
      {showVideo && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9980, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowVideo(false)}
        >
          <div style={{ position: 'relative', width: 'min(900px, 92vw)' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowVideo(false)}
              style={{
                position: 'absolute', top: -36, right: 0,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontFamily: 'var(--font-mono)',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              Close
            </button>
            <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
              <iframe
                src="https://www.youtube.com/embed/80Fogz8q5_U?autoplay=1&rel=0"
                title="AutoThresh Tutorial"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
