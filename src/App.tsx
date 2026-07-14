import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from './auth/useAuth';
import { initBetaFeatures } from './auth/betaFeatures';
import { LoginPage } from './components/LoginPage';
import { SubscribePage } from './components/SubscribePage';
import { MobileLayout } from './components/MobileLayout';
import { TopBar } from './components/TopBar';
import { LayerPanel } from './components/LayerPanel';
import { CanvasView } from './components/CanvasView';
import { ControlPanel } from './components/ControlPanel';
import type { ExportConfig } from './components/ExportModal';
import { BetaNoticeModal, shouldShowBetaNotice } from './components/BetaNoticeModal';
import { WhatsNewModal, hasUnseenUpdates, markChangelogSeen } from './components/WhatsNewModal';
import { LoginSplash } from './components/LoginSplash';

const ExportModal     = lazy(() => import('./components/ExportModal').then(m => ({ default: m.ExportModal })));
const MockupPreview   = lazy(() => import('./components/MockupPreview').then(m => ({ default: m.MockupPreview })));
const PresetsModal    = lazy(() => import('./components/PresetsModal').then(m => ({ default: m.PresetsModal })));
const EulaModal       = lazy(() => import('./components/EulaModal').then(m => ({ default: m.EulaModal })));
const FaqModal        = lazy(() => import('./components/FaqModal').then(m => ({ default: m.FaqModal })));
const ContactModal    = lazy(() => import('./components/ContactModal').then(m => ({ default: m.ContactModal })));
const TutorialsModal  = lazy(() => import('./components/TutorialsModal').then(m => ({ default: m.TutorialsModal })));
const TutorialOverlay = lazy(() => import('./components/TutorialOverlay').then(m => ({ default: m.TutorialOverlay })));
const ChatWidget      = lazy(() => import('./components/ChatWidget').then(m => ({ default: m.ChatWidget })));
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard').then(m => ({ default: m.AnalyticsDashboard })));
import { useStore } from './store/useStore';
import { useHistorySync } from './hooks/useHistorySync';
import { useVersionCheck } from './hooks/useVersionCheck';
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
import { runV2Halftone } from './engine/dtgEngineV2';
import { packSheet, calcLayout as calcSheetLayout } from './engine/sheetEngine';
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
  (c.getContext('2d', { colorSpace: 'srgb' }) as CanvasRenderingContext2D).putImageData(imageData, 0, 0);
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

const DtgV2TestPage    = lazy(() => import('./pages/DtgV2TestPage'));
const DitherV2TestPage = lazy(() => import('./pages/DitherV2TestPage'));
const XeroxTestPage    = lazy(() => import('./pages/XeroxTestPage'));

function App() {
  // Dev-only test pages — bypass auth entirely.
  if (window.location.pathname === '/dtg-v2-test') {
    return <Suspense fallback={null}><DtgV2TestPage /></Suspense>;
  }
  if (window.location.pathname === '/dither-v2-test') {
    return <Suspense fallback={null}><DitherV2TestPage /></Suspense>;
  }
  if (window.location.pathname === '/xerox-test') {
    return <Suspense fallback={null}><XeroxTestPage /></Suspense>;
  }

  useHistorySync();
  const updateAvailable = useVersionCheck();
  const { status, session, initiateLogin, switchAccount, logout, recheck } = useAuth();
  const [showExport, setShowExport] = useState(false);
  const [sheetGenerating, setSheetGenerating] = useState(false);
  const [showEula, setShowEula]         = useState(false);
  const [showFaq, setShowFaq]           = useState(false);
  const [showBetaNotice, setShowBetaNotice] = useState(() => shouldShowBetaNotice());
  const [showWhatsNew, setShowWhatsNew]   = useState(false);
  const [hasUpdates, setHasUpdates]       = useState(() => hasUnseenUpdates());
  const [showContact, setShowContact]     = useState(false);
  const [showTutorial, setShowTutorial]   = useState(false);
  const [showVideo, setShowVideo]         = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showDesktopApp, setShowDesktopApp] = useState(false);
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

  // Allow any component to open the contact modal via custom event.
  useEffect(() => {
    const handler = () => setShowContact(true);
    window.addEventListener('at:open-contact', handler);
    return () => window.removeEventListener('at:open-contact', handler);
  }, []);
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
    colorSepPatternDensity, colorSepPatternAngle, colorSepLockedColors, colorSepVisibility, colorSepNames,
    paintMasks,
    underbaseIncludeShadows, underbaseEnabled, underbaseDensity, underbaseChoke: storeUnderbaseChoke,
    passthroughMode, bgSeedColors, bgPaintMask, bgPaintMaskDims,
    fabricTexture, fabricBlendStrength, fabricTextureDepth,
    printSettings,
    dtgPaintMask, dtgPaintMaskDims,
    sheetSettings,
  } = useStore();

  useEffect(() => {
    const check = () => setIsMobile(isMobileDevice());
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Poll for unread customer messages — creator only, shown as dot on Command Center icon
  const [creatorChatUnread, setCreatorChatUnread] = useState(0);
  useEffect(() => {
    if (session?.subscriptionStatus !== 'creator' || !session?.token) return;
    const token = session.token;
    const check = () => {
      fetch('/api/chat?resource=tickets&all=1', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then((ts: { unread_by_creator?: number }[]) =>
          setCreatorChatUnread(ts.reduce((s, t) => s + (t.unread_by_creator ?? 0), 0))
        )
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 20_000);
    return () => clearInterval(id);
  }, [session?.subscriptionStatus, session?.token]);

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
    return <SubscribePage firstName={session?.firstName} email={session?.email} subscriptionStatus={session?.subscriptionStatus} onLogout={logout} onSwitchAccount={switchAccount} onRecheck={recheck} />;
  }

  function buildColorRefCanvas(refColors: RGB[], dpi = 72): HTMLCanvasElement {
    // Scale swatch dimensions by DPI so the reference card is the same physical
    // size regardless of document resolution (readable in Photoshop at 300 DPI).
    const sc = dpi / 72;
    const S = Math.round(56 * sc), labelH = Math.round(28 * sc), gap = Math.round(6 * sc), pad = Math.round(14 * sc);
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
      ctx.lineWidth = Math.max(1, sc);
      ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
      ctx.fillStyle = '#111111';
      ctx.font = `bold ${Math.round(9 * sc)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`Color ${i + 1}`, x + S / 2, y + S + Math.round(11 * sc));
      ctx.fillStyle = '#666666';
      ctx.font = `${Math.round(8 * sc)}px monospace`;
      ctx.fillText(hexVal, x + S / 2, y + S + Math.round(22 * sc));
    });
    return c;
  }

  const handleGenerateDtgSheet = async () => {
    if (!originalImage) return;
    setSheetGenerating(true);
    try {
      const { dpi } = sheetSettings;
      const aspect = originalImage.height / originalImage.width;
      // Auto-fill: compute design size from sheet layout (same as preview)
      const layout = calcSheetLayout(sheetSettings, aspect);
      const designWidthPx = Math.round(layout.designWidthIn * dpi);
      const designHeightPx = Math.round(layout.designHeightIn * dpi);

      // Scale originalImage to design print size
      const srcCanvas = canvasFromImageData(originalImage);
      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = designWidthPx;
      scaledCanvas.height = designHeightPx;
      const scaledCtx = scaledCanvas.getContext('2d')!;
      scaledCtx.imageSmoothingEnabled = true;
      scaledCtx.imageSmoothingQuality = 'high';
      scaledCtx.drawImage(srcCanvas, 0, 0, designWidthPx, designHeightPx);
      let artData = scaledCtx.getImageData(0, 0, designWidthPx, designHeightPx);

      // Apply image adjustments
      const adj = imageAdjustments;
      const sat = adj.saturation ?? 0;
      const isNoop = adj.adjMode === 'basic' &&
        adj.exposure === 0 && adj.contrast === 0 &&
        adj.shadows === 0 && adj.highlights === 0 && adj.blur === 0 && sat === 0;
      if (!isNoop) {
        const rd = artData.data;
        const n = designWidthPx * designHeightPx;
        const satFactor = 1 + sat / 100;
        for (let i = 0; i < n; i++) {
          if (rd[i * 4 + 3] < 128) continue;
          let r = rd[i * 4], g = rd[i * 4 + 1], b = rd[i * 4 + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const adjLum = applyGlobalAdjustments(lum, adj);
          if (lum < 1) { r = g = b = adjLum | 0; } else {
            const scale = adjLum / lum;
            r = Math.min(255, (r * scale + 0.5)) | 0;
            g = Math.min(255, (g * scale + 0.5)) | 0;
            b = Math.min(255, (b * scale + 0.5)) | 0;
          }
          if (sat !== 0) {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = Math.min(255, Math.max(0, (gray + satFactor * (r - gray) + 0.5))) | 0;
            g = Math.min(255, Math.max(0, (gray + satFactor * (g - gray) + 0.5))) | 0;
            b = Math.min(255, Math.max(0, (gray + satFactor * (b - gray) + 0.5))) | 0;
          }
          rd[i * 4] = r; rd[i * 4 + 1] = g; rd[i * 4 + 2] = b;
        }
      }

      // Apply bg paint mask (scale from preview coords — uses same approach as regular export)
      if (bgPaintMask && bgPaintMaskDims) {
        const { w: pmW, h: pmH } = bgPaintMaskDims;
        const scaleX = designWidthPx / pmW;
        const scaleY = designHeightPx / pmH;
        for (let y = 0; y < designHeightPx; y++) {
          for (let x = 0; x < designWidthPx; x++) {
            const sx = Math.min(pmW - 1, Math.floor(x / scaleX));
            const sy = Math.min(pmH - 1, Math.floor(y / scaleY));
            const pv = bgPaintMask[sy * pmW + sx];
            if (pv === 2) artData.data[(y * designWidthPx + x) * 4 + 3] = 0;
          }
        }
      }

      // Run halftone at sheet DPI — cell size is physically correct: dpi / lpi
      const cellSizePx = dpi / printSettings.lpi;
      const { output } = runV2Halftone(artData, printSettings, cellSizePx);

      // Build design canvas
      const designCanvas = document.createElement('canvas');
      designCanvas.width = designWidthPx;
      designCanvas.height = designHeightPx;
      designCanvas.getContext('2d')!.putImageData(output, 0, 0);

      // Pack onto sheet (packSheet recomputes the same layout internally)
      const { canvas } = packSheet(designCanvas, sheetSettings, aspect);

      // Download
      const blob = await new Promise<Blob>((res) => canvas.toBlob(b => res(b!), 'image/png'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const shW = sheetSettings.sheetWidthIn.toFixed(1).replace('.', 'p');
      const shH = sheetSettings.sheetHeightIn.toFixed(1).replace('.', 'p');
      a.download = `dtf-sheet-${shW}x${shH}in-${dpi}dpi-x${sheetSettings.quantity}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExport(false);
    } finally {
      setSheetGenerating(false);
    }
  };

  const handleExport = async ({ mode: _mode, format, fileName, includeColorInfo, usePantoneNames, underbase, underbaseChoke, cropToArtwork, withFabricView }: ExportConfig) => {
    if (!originalImage) return;

    const loadMods = () => Promise.all([import('jszip'), import('file-saver'), import('ag-psd'), import('pdf-lib')]);
    let modResult: Awaited<ReturnType<typeof loadMods>>;
    try {
      modResult = await loadMods();
    } catch {
      throw new Error('A newer version of AutoThresh is available. Please do a hard refresh (Cmd+Shift+R / Ctrl+Shift+R) and re-upload your image to export.');
    }
    const [{ default: JSZip }, { saveAs }, { writePsd }, { PDFDocument }] = modResult;

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
    const artExpCtx = artExpCanvas.getContext('2d', { colorSpace: 'srgb' }) as CanvasRenderingContext2D;
    artExpCtx.drawImage(artSrcCanvas, 0, 0, artScaleW, artScaleH);
    const artImageData = artExpCtx.getImageData(0, 0, artScaleW, artScaleH);

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
          ? '/textures/White_Fabric_ATW.jpg'
          : '/textures/Black_Fabric_ATW.jpg';
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
      const sat = adj.saturation ?? 0;
      const isNoop = adj.adjMode === 'basic' &&
        adj.exposure === 0 && adj.contrast === 0 &&
        adj.shadows === 0 && adj.highlights === 0 && adj.blur === 0 && sat === 0;
      if (isNoop) return img;
      const result = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      const rd = result.data;
      const n = img.width * img.height;
      const satFactor = 1 + sat / 100;
      for (let i = 0; i < n; i++) {
        if (rd[i * 4 + 3] < 128) continue;
        let r = rd[i * 4], g = rd[i * 4 + 1], b = rd[i * 4 + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const adjLum = applyGlobalAdjustments(lum, adj);
        if (lum < 1) {
          r = g = b = adjLum | 0;
        } else {
          const scale = adjLum / lum;
          r = Math.min(255, (r * scale + 0.5)) | 0;
          g = Math.min(255, (g * scale + 0.5)) | 0;
          b = Math.min(255, (b * scale + 0.5)) | 0;
        }
        if (sat !== 0) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          r = Math.min(255, Math.max(0, (gray + satFactor * (r - gray) + 0.5))) | 0;
          g = Math.min(255, Math.max(0, (gray + satFactor * (g - gray) + 0.5))) | 0;
          b = Math.min(255, Math.max(0, (gray + satFactor * (b - gray) + 0.5))) | 0;
        }
        rd[i * 4] = r; rd[i * 4 + 1] = g; rd[i * 4 + 2] = b;
      }
      return result;
    }

    // color-sep composite data — populated in the color-sep branch, used by buildCompositeCanvas
    let csExportImageData: ImageData | null = null;
    let csExportColors: RGB[] = [];
    let csExportSettings: { numColors: number; colorPriority: number; pattern: PatternType; patternScale: number; patternDensity: number; patternAngle: number } | null = null;

    // DTG composite — full-color RGBA with pattern-based alpha knockout
    let dtgExportImageData: ImageData | null = null;

    let artLayers: ProcessedLayer[];
    if (separationMode === 'cmyk') {
      // Cell size derived from LPI: output DPI / LPI = pixels per halftone dot
      artLayers = cmykSeparate(applyAdjToImageData(artImageData), documentDpi / cmykLpi, artBgMask, cmykAngles, 1, cmykParams);
    } else if (separationMode === 'cmyk-pro') {
      // ICC-based separation + per-channel halftone screening
      const plates = await separateCmykPro(applyAdjToImageData(artImageData), proCmykSettings);
      let exportWhitePlate: Uint8Array | undefined;
      if (underbaseEnabled) {
        const raw = generateCmykProUnderbase(plates, { density: underbaseDensity, includeShadows: underbaseIncludeShadows }, artBgMask);
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
      csLayers.forEach((l, i) => { if (colorSepNames[i]) l.name = colorSepNames[i]; });
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
    } else if (separationMode === 'dtg') {
      // Export uses actual document DPI for full-resolution dot sizing.
      const exportCellSizePx = artScaleW / (printSettings.lpi * (375 / 45));
      const v2ExportResult = runV2Halftone(
        applyAdjToImageData(artImageData),
        printSettings,
        exportCellSizePx,
      );
      dtgExportImageData = v2ExportResult.output;
      // Apply DTG paint mask (erase strokes only — restore lets halftone result stand)
      if (dtgPaintMask && dtgPaintMaskDims) {
        const { w: pmW, h: pmH } = dtgPaintMaskDims;
        const scaleX = artScaleW / pmW;
        const scaleY = artScaleH / pmH;
        for (let y = 0; y < artScaleH; y++) {
          for (let x = 0; x < artScaleW; x++) {
            const sx = Math.min(pmW - 1, Math.floor(x / scaleX));
            const sy = Math.min(pmH - 1, Math.floor(y / scaleY));
            if (dtgPaintMask[sy * pmW + sx] === 2) {
              dtgExportImageData.data[(y * artScaleW + x) * 4 + 3] = 0;
            }
          }
        }
      }
      if (textureEnabled) {
        const texMask = generateTextureMask(artScaleW, artScaleH, textureType, textureIntensity, textureScale * exportScaleFactor, textureWidth, textureSeed);
        for (let i = 0; i < texMask.length; i++) {
          if (texMask[i] === 0) dtgExportImageData.data[i * 4 + 3] = 0;
        }
      }
      artLayers = [];
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
      const skipTex = !exportTexMask || isShadowColor(r, g, b);
      const data = new ImageData(docPxW, docPxH);
      for (let ay = 0; ay < artScaleH; ay++) {
        for (let ax = 0; ax < artScaleW; ax++) {
          if (pl.mask[ay * artScaleW + ax] !== 255) continue;
          if (!skipTex && exportTexMask![ay * artScaleW + ax] === 0) continue;
          const dx = artOffX + ax, dy = artOffY + ay;
          if (dx < 0 || dx >= docPxW || dy < 0 || dy >= docPxH) continue;
          const pi = (dy * docPxW + dx) * 4;
          data.data[pi] = r; data.data[pi + 1] = g; data.data[pi + 2] = b; data.data[pi + 3] = 255;
        }
      }
      const canvas = canvasFromImageData(data);
      if (withMarks && showRegistrationMarks) {
        drawRegistrationMarks(canvas.getContext('2d')!, docPxW, docPxH, regPaddingPx, contrastColor(canvasColor), documentDpi);
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
        drawRegistrationMarks(c.getContext('2d')!, docPxW, docPxH, regPaddingPx, '#000000', documentDpi);
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
        artComposite = renderCmykSmooth(applyAdjToImageData(artImageData), artBgMask, { 'cmyk-k': true, 'cmyk-c': true, 'cmyk-m': true, 'cmyk-y': true }, overrideParams);
      } else if (separationMode === 'palette') {
        artComposite = renderPaletteComposite(artImageData, paletteColors, artBgMask,
          Object.fromEntries(paletteColors.map((_, i) => [`palette-${i}`, true])),
          palettePattern, paletteTileSize, imageAdjustments,
          paletteDensity, paletteAngle, paletteSoftness, importanceMap);
      } else if (separationMode === 'color-sep' && csExportImageData && csExportSettings) {
        artComposite = renderColorSepComposite(csExportImageData, csExportColors, colorSepVisibility, csExportSettings, artBgMask, importanceMap);
      } else if (separationMode === 'dtg' && dtgExportImageData) {
        artComposite = dtgExportImageData;
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
        drawRegistrationMarks(dCtx, docPxW, docPxH, regPaddingPx, '#000000', documentDpi);
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

    // ── JPG (texture mode flat composite) ────────────────────────────────────
    if (format === 'jpg') {
      const c = buildCompositeCanvas(false);
      // Flatten transparency to white before JPEG (no alpha channel support)
      const flat = document.createElement('canvas');
      flat.width = c.width; flat.height = c.height;
      const fCtx = flat.getContext('2d')!;
      fCtx.fillStyle = '#ffffff';
      fCtx.fillRect(0, 0, flat.width, flat.height);
      fCtx.drawImage(c, 0, 0);
      const jpegBlob = await new Promise<Blob>((res) => flat.toBlob((b) => res(b!), 'image/jpeg', 0.95));
      saveAs(jpegBlob, `${baseName}-texture.jpg`);
      return;
    }

    // ── PNG ──────────────────────────────────────────────────────────────────
    const pngOf = (c: HTMLCanvasElement) => canvasToBlobWithDpi(c, documentDpi);
    if (format === 'png') {
      if (mode === 'dtg' || separationMode === 'texture' || separationMode === 'dtg') {
        const suffix = separationMode === 'texture' ? 'texture' : 'dtg';
        if (separationMode === 'dtg' && dtgExportImageData) {
          // Build an artwork-sized canvas, optionally composited over the garment background.
          // Order must match the preview: fill bg → draw artwork → apply fabric blend.
          // Applying fabric blend before the artwork (old order) made artwork sit flat on top.
          const artCanvas = document.createElement('canvas');
          artCanvas.width = artScaleW; artCanvas.height = artScaleH;
          const artCtx = artCanvas.getContext('2d')!;

          // Step 1: fill garment color
          if (withFabricView) {
            artCtx.fillStyle = canvasColor;
            artCtx.fillRect(0, 0, artScaleW, artScaleH);
          }

          // Step 2: draw artwork (transparent areas reveal garment)
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = artScaleW; tmpCanvas.height = artScaleH;
          tmpCanvas.getContext('2d')!.putImageData(dtgExportImageData, 0, 0);
          artCtx.drawImage(tmpCanvas, 0, 0);

          // Step 3: fabric blend over the composited result — same as applyFabricBlendToCanvas in preview
          if (withFabricView && fabricTexture !== 'none') {
            const fabricPath = fabricTexture === 'light'
              ? '/textures/White_Fabric_ATW.jpg'
              : '/textures/Black_Fabric_ATW.jpg';
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
              const combined = artCtx.getImageData(0, 0, artScaleW, artScaleH);
              applyFabricBlend(combined, fabData, { garmentType: fabricTexture, blendStrength: fabricBlendStrength, textureDepth: fabricTextureDepth, canvasRgb: hexToRgb(canvasColor) });
              artCtx.putImageData(combined, 0, 0);
            }
          }

          if (cropToArtwork) {
            // Scan non-transparent pixels in the artwork for tight bounding box
            const d = dtgExportImageData.data;
            const W = artScaleW, H = artScaleH;
            let minX = W, maxX = 0, minY = H, maxY = 0;
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                if (d[(y * W + x) * 4 + 3] > 0) {
                  if (x < minX) minX = x; if (x > maxX) maxX = x;
                  if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
              }
            }
            const cropW = maxX - minX + 1, cropH = maxY - minY + 1;
            const cropCanvas = document.createElement('canvas');
            if (cropW > 0 && cropH > 0) {
              cropCanvas.width = cropW; cropCanvas.height = cropH;
              cropCanvas.getContext('2d')!.drawImage(artCanvas, -minX, -minY);
            } else {
              cropCanvas.width = W; cropCanvas.height = H;
              cropCanvas.getContext('2d')!.drawImage(artCanvas, 0, 0);
            }
            saveAs(await pngOf(cropCanvas), `${baseName}-${suffix}.png`);
          } else {
            // Full doc canvas — place artwork at its document position
            const docCanvas = document.createElement('canvas');
            docCanvas.width = docPxW; docCanvas.height = docPxH;
            const dCtx = docCanvas.getContext('2d')!;
            if (withFabricView) { dCtx.fillStyle = canvasColor; dCtx.fillRect(0, 0, docPxW, docPxH); }
            dCtx.drawImage(artCanvas, artOffX, artOffY);
            saveAs(await pngOf(docCanvas), `${baseName}-${suffix}.png`);
          }
        } else {
          saveAs(await pngOf(buildCompositeCanvas(separationMode !== 'texture' && separationMode !== 'dtg')), `${baseName}-${suffix}.png`);
        }
      } else if (separationMode === 'cmyk' || separationMode === 'cmyk-pro') {
        // Plates (grayscale positives) + proofs on white and on garment
        const zip    = new JSZip();
        const plates = zip.folder(baseName)!;
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
        const folder = zip.folder(baseName)!;
        if (underbase) folder.file('underbase.png', await pngOf(buildUnderbaseCanvas(underbaseChoke)));
        for (const pl of visibleLayers) {
          folder.file(`${layerName(pl).toLowerCase()}.png`, await pngOf(buildLayerCanvas(pl, true)));
        }
        folder.file('composite.png', await pngOf(buildCompositeCanvas(true)));
        if (includeColorInfo) {
          const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors
            : artLayers.map(l => l.color as RGB);
          if (refColors.length > 0) folder.file('color-reference.png', await pngOf(buildColorRefCanvas(refColors, documentDpi)));
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
            drawRegistrationMarks(pCtx, docPxW, docPxH, regPaddingPx, '#000000', documentDpi);
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
          canvas: buildColorRefCanvas(refColors, documentDpi),
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
        const folder = zip.folder(baseName)!;
        if (underbase) folder.file('underbase.tiff', encodeTiff(getPixels(buildUnderbaseCanvas(underbaseChoke)), documentDpi));
        for (const pl of visibleLayers) {
          const buf = encodeTiff(getPixels(buildLayerCanvas(pl, true)), documentDpi);
          folder.file(`${layerName(pl).toLowerCase()}.tiff`, buf);
        }
        folder.file('composite.tiff', encodeTiff(getPixels(buildCompositeCanvas(true)), documentDpi));
        if (includeColorInfo) {
          const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors
            : artLayers.map(l => l.color as RGB);
          if (refColors.length > 0) folder.file('color-reference.png', await canvasToBlob(buildColorRefCanvas(refColors, documentDpi)));
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
        const folder = zip.folder(baseName)!;
        for (const pl of visibleLayers) {
          const name = layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-');
          folder.file(`${name}.eps`, epsOf(buildCmykPlateCanvas(pl), layerName(pl)));
        }
        const suffix = separationMode === 'cmyk-pro' ? 'cmyk-pro-eps' : 'cmyk-eps';
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-${suffix}.zip`);

      } else {
        // Screen-print separation modes: one EPS per color layer + optional underbase
        const zip    = new JSZip();
        const folder = zip.folder(baseName)!;
        if (underbase) {
          folder.file('underbase.eps', epsOf(buildUnderbaseCanvas(underbaseChoke), 'Underbase · #FFFFFF', [255, 255, 255]));
        }
        for (const pl of visibleLayers) {
          const name = layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-');
          folder.file(`${name}.eps`, epsOf(buildLayerCanvas(pl, true), layerName(pl), pl.color));
        }
        if (includeColorInfo) {
          const refColors: RGB[] = separationMode === 'color-sep' ? csExportColors : artLayers.map(l => l.color as RGB);
          if (refColors.length > 0) folder.file('color-reference.png', await canvasToBlob(buildColorRefCanvas(refColors, documentDpi)));
        }
        saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-screen-eps.zip`);
      }
      return;
    }

    // ── CorelDRAW Package ─────────────────────────────────────────────────────
    // ZIP of numbered EPS separations (spot-color DSC headers) + a plaintext
    // import guide. Intended for screen printers who work in CorelDRAW.
    if (format === 'cdr') {
      const zip    = new JSZip();
      const folder = zip.folder(baseName)!;

      const epsOf = (canvas: HTMLCanvasElement, title: string, spotColor?: [number,number,number] | null) =>
        encodeEps(canvas, { dpi: documentDpi, title, spotColor: spotColor ?? null, grayscale: true });

      const printOrder: string[] = [];

      if (separationMode === 'cmyk' || separationMode === 'cmyk-pro') {
        for (const [i, pl] of visibleLayers.entries()) {
          const num  = String(i + 1).padStart(2, '0');
          const name = layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-');
          const fname = `${num}-${name}.eps`;
          folder.file(fname, epsOf(buildCmykPlateCanvas(pl), layerName(pl)));
          printOrder.push(fname);
        }
      } else if (mode === 'dtg' || separationMode === 'palette') {
        const fname = '01-composite.eps';
        folder.file(fname, encodeEps(buildCompositeCanvas(false), { dpi: documentDpi, title: baseName, grayscale: false }));
        printOrder.push(fname);
      } else {
        // Screen-print color separations
        let idx = 1;
        if (underbase) {
          const fname = '01-underbase.eps';
          folder.file(fname, epsOf(buildUnderbaseCanvas(underbaseChoke), 'Underbase - White', [255, 255, 255]));
          printOrder.push(fname);
          idx = 2;
        }
        for (const pl of visibleLayers) {
          const num   = String(idx++).padStart(2, '0');
          const name  = layerName(pl).toLowerCase().replace(/\s*·\s*/g, '-');
          const fname = `${num}-${name}.eps`;
          folder.file(fname, epsOf(buildLayerCanvas(pl, true), layerName(pl), pl.color as [number, number, number]));
          printOrder.push(fname);
        }
        // Composite proof
        folder.file('composite-proof.eps', encodeEps(buildCompositeCanvas(false), { dpi: documentDpi, title: `${baseName} - Composite Proof`, grayscale: false }));
      }

      const isCmykMode = separationMode === 'cmyk' || separationMode === 'cmyk-pro';
      const readme = [
        `CORELDRAW IMPORT GUIDE — ${baseName}`,
        `Generated by AutoThresh  ·  autothresh.com`,
        ``,
        `HOW TO PLACE SEPARATIONS IN CORELDRAW`,
        `─────────────────────────────────────────────────────────────────`,
        `1. Open a new CorelDRAW document at your artwork print size.`,
        ``,
        `2. Import each EPS file in the order listed below:`,
        `   File → Import → select the .eps file → click Import`,
        `   Position each one at (0, 0) — coordinates shown in the toolbar.`,
        ``,
        `3. Each separation will import as a bitmap object. CorelDRAW`,
        `   reads the %%CMYKCustomColor DSC header and assigns the`,
        `   correct spot color name automatically.`,
        ``,
        `4. To print color separations:`,
        `   File → Print → Color tab → enable "Separations"`,
        `   Confirm each ink channel appears in the separations list.`,
        ``,
        `PRINT ORDER (place bottom → top)`,
        `─────────────────────────────────────────────────────────────────`,
        ...printOrder.map(f => `  ${f}`),
        ``,
        isCmykMode ? [
          `CMYK NOTES`,
          `─────────────────────────────────────────────────────────────────`,
          `These are process color plates (Cyan / Magenta / Yellow / Black).`,
          `In the CorelDRAW Separations dialog, map each plate to its`,
          `corresponding process color channel.`,
        ].join('\n') : [
          `SPOT COLOR NOTES`,
          `─────────────────────────────────────────────────────────────────`,
          `Each EPS carries a DSC spot-color header (%%CMYKCustomColor).`,
          `CorelDRAW reads these automatically — each ink appears as a`,
          `named spot color in the color palette.`,
          ``,
          `TIP: Match spot colors to Pantone equivalents in the Object`,
          `Properties panel for more accurate ink specification.`,
        ].join('\n'),
        ``,
        `ALIGNMENT TIP`,
        `─────────────────────────────────────────────────────────────────`,
        `Lock each placed object (Object → Lock) before importing the next`,
        `so all plates stay aligned. Registration marks are embedded in`,
        `each plate for physical film output.`,
        ``,
        `─────────────────────────────────────────────────────────────────`,
        `AutoThresh Web — professional screen-print separations`,
        `autothresh.com`,
      ].join('\n');

      folder.file('README-CorelDRAW.txt', readme);
      saveAs(await zip.generateAsync({ type: 'blob' }), `${baseName}-corel.zip`);
      return;
    }
  };

  const subStatus = import.meta.env.DEV ? 'creator' : session?.subscriptionStatus;
  const isCreator = subStatus === 'creator';

  if (isMobile) {
    return (
      <Suspense fallback={null}>
      <MobileLayout
        onExport={() => setShowExport(true)}
        onMockup={() => setMockupOpen(true)}
        onLogout={logout}
        onAnalytics={() => setShowAnalytics(true)}
        session={session}
      >
        {showExport && <ExportModal onClose={() => setShowExport(false)} onExport={handleExport} onGenerateSheet={handleGenerateDtgSheet} generatingSheet={sheetGenerating} defaultFileName={imageFileName.replace(/\.[^.]+$/, '') || 'autothresh'} separationMode={separationMode} />}
        {mockupOpen && <MockupPreview onClose={() => setMockupOpen(false)} />}
        {presetsOpen && session?.token && <PresetsModal token={session.token} onClose={() => setPresetsOpen(false)} />}
        {showFaq      && <FaqModal      onClose={() => setShowFaq(false)} />}
        {showEula     && <EulaModal     onClose={() => setShowEula(false)} />}
        {showContact  && <ContactModal  onClose={() => setShowContact(false)} />}
        {showTutorial && <TutorialOverlay onClose={() => setShowTutorial(false)} />}
        {showVideo    && <TutorialsModal  onClose={() => setShowVideo(false)} />}
        {showSplash   && <LoginSplash firstName={session?.firstName} email={session?.email} onDone={() => setShowSplash(false)} />}
        {showAnalytics && session && <AnalyticsDashboard session={session} onClose={() => setShowAnalytics(false)} />}
        {session && !isCreator && <ChatWidget session={session} />}
      </MobileLayout>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
    <div className="app">
      <TopBar onExport={() => setShowExport(true)} onMockup={() => setMockupOpen(true)} onPresets={() => setPresetsOpen(true)} onTutorial={() => setShowTutorial(true)} onVideo={() => setShowVideo(true)} onAnalytics={() => { setShowAnalytics(true); setCreatorChatUnread(0); }} onWhatsNew={() => setShowWhatsNew(true)} onLogout={logout} firstName={session?.firstName} userEmail={session?.email} subscriptionExpiresAt={session?.subscriptionExpiresAt} planTitle={session?.planTitle} subscriptionStatus={subStatus} sessionToken={session?.token} accentColor={session?.accentColor} chatUnread={creatorChatUnread} />


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
          onGenerateSheet={handleGenerateDtgSheet}
          generatingSheet={sheetGenerating}
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
      {showVideo    && <TutorialsModal  onClose={() => setShowVideo(false)} />}
      {showSplash && <LoginSplash firstName={session?.firstName} email={session?.email} onDone={() => setShowSplash(false)} />}
      {showAnalytics && session && <AnalyticsDashboard session={session} onClose={() => setShowAnalytics(false)} />}
      {session && !isCreator && <ChatWidget session={session} />}

      {updateAvailable && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9990, display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--surface)', border: '1px solid var(--accent)',
          padding: '10px 16px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/>
          </svg>
          <span style={{ fontSize: 11, color: 'var(--text)', letterSpacing: '0.04em' }}>
            Update available — export your work first
          </span>
          <button
            onClick={() => { if (window.confirm('Reloading will lose your current image. Export first if you need it. Reload now?')) window.location.reload(); }}
            style={{
              height: 24, padding: '0 12px', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.06em', background: 'var(--accent)', border: 'none',
              color: '#111', cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            RELOAD
          </button>
        </div>
      )}

      {showDesktopApp && (
        <div
          onClick={() => setShowDesktopApp(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '100%', maxWidth: 400, padding: '24px 24px 28px', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Desktop App</div>
              <button onClick={() => setShowDesktopApp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, display: 'flex', lineHeight: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em', marginBottom: 6 }}>AutoThresh™ for Desktop</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-sans)', lineHeight: 1.6, marginBottom: 24 }}>
              A native desktop app for Mac and Windows is in the works.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 16px', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" style={{ opacity: 0.4 }}>
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Coming Soon</div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.7 }}>
                Mac &amp; Windows · Free with any active subscription
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </Suspense>
  );
}

export default App;
