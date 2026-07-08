import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  processImage, applyKnockout, renderComposite, scaleImageData, scaleImageDataExact,
  computeBackgroundMask, detectBackgroundColor, hexToRgb, registerPatternTexture,
  cmykSeparate, renderCmykComposite, renderCmykSmooth, computeCmykQuality,
  garmentRgbFromParam, contrastColor, autoImageAdjustments, applyGlobalAdjustments,
} from '../engine/imageProcessor';
import { kMeansColors, paletteSeparate, renderPaletteComposite, bayerOrder } from '../engine/colorSeparation';
import { colorSeparate, detectColorSepColors, renderColorSepCompositeFromLayers } from '../engine/colorSeparator';
import type { LayerConfig, PatternConfig, ImageAdjustments } from '../engine/imageProcessor';
import { generateTextureMask } from '../engine/textureGenerator';
import { buildImportanceMap } from '../engine/analysisPass';
import { loadAllTextures } from '../engine/textureLoader';
import { getCachedOverlay, setCachedOverlay } from '../engine/overlayCache';
import { isShadowColor, nearestPantoneRgb } from '../engine/pantoneMatch';
import { iccSeparateRaw, applyPostIcc, applyHalftoneToCmykPlates } from '../engine/cmykProEngine';
import type { RawIccPlanes } from '../engine/cmykProEngine';
import {
  buildNeugebauerPrimaries, compositeHalftonePlates,
  upsampleCmykPlates, upsampleMask, areaAverageDownsample,
} from '../engine/inkSimulator';
import { generateCmykProUnderbase, chokeWhitePlate } from '../engine/underbaseEngine';
import { applyFabricBlend } from '../engine/fabricBlend';
import { applyDtgHalftone, detectDtgBgColor, renderDtgGreyscalePreview } from '../engine/dtgEngine';


// ── CMYK Inspect Grid ─────────────────────────────────────────────────────────
// Shows all 4 CMYK halftone plates in a 2×2 grid overlay for inspection mode.

const CMYK_INSPECT_CHANNELS = [
  { key: 'cmyk-c', label: 'C', angle: 15, r: 0,   g: 174, b: 239 },
  { key: 'cmyk-m', label: 'M', angle: 75, r: 236, g: 0,   b: 140 },
  { key: 'cmyk-y', label: 'Y', angle: 0,  r: 200, g: 168, b: 0   },
  { key: 'cmyk-k', label: 'K', angle: 45, r: 26,  g: 26,  b: 26  },
] as const;

function CmykInspectGrid() {
  const { processedLayers, processedLayerDims, proCmykSettings } = useStore();
  const canvasRefs = [
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
    useRef<HTMLCanvasElement>(null),
  ];

  useEffect(() => {
    if (!processedLayerDims) return;
    const { w, h } = processedLayerDims;

    CMYK_INSPECT_CHANNELS.forEach(({ key, r, g, b }, ci) => {
      const cvs = canvasRefs[ci].current;
      if (!cvs) return;
      const layer = processedLayers.find(l => l.id === key);
      if (!layer) return;
      const { mask } = layer;

      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;

      const imgData = new ImageData(w, h);
      const d = imgData.data;
      for (let i = 0; i < w * h; i++) {
        const cov = mask[i] / 255;
        d[i*4]   = Math.round(255*(1-cov) + r*cov);
        d[i*4+1] = Math.round(255*(1-cov) + g*cov);
        d[i*4+2] = Math.round(255*(1-cov) + b*cov);
        d[i*4+3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedLayers, processedLayerDims]);

  if (!processedLayerDims) return null;

  const halftones = [
    proCmykSettings.halftoneC,
    proCmykSettings.halftoneM,
    proCmykSettings.halftoneY,
    proCmykSettings.halftoneK,
  ];

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none',
      display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
      gap: 3, background: '#111111', padding: 3,
    }}>
      {CMYK_INSPECT_CHANNELS.map(({ key, label, r, g, b }, ci) => {
        const ht = halftones[ci];
        const angle = ht?.angle ?? CMYK_INSPECT_CHANNELS[ci].angle;
        const color = key === 'cmyk-k' ? '#1a1a1a' : `rgb(${r},${g},${b})`;
        return (
          <div key={key} style={{
            position: 'relative', background: '#ffffff', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <canvas
              ref={canvasRefs[ci]}
              style={{
                maxWidth: '100%', maxHeight: '100%',
                width: 'auto', height: 'auto',
                display: 'block', imageRendering: 'auto',
              }}
            />
            <div style={{
              position: 'absolute', bottom: 4, left: 4,
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
              color, letterSpacing: '0.05em',
              textShadow: key === 'cmyk-k' ? 'none' : '0 0 3px rgba(0,0,0,0.5)',
            }}>
              {label} {angle}°
            </div>
          </div>
        );
      })}
    </div>
  );
}

function resolvePatterns(layers: LayerConfig[], global: PatternConfig): LayerConfig[] {
  return layers.map((l) =>
    l.useGlobalPattern
      ? { ...l, pattern: global.pattern, patternScale: global.patternScale, patternAngle: global.patternAngle, patternDensity: global.patternDensity }
      : l
  );
}

function drawScaledOverlay(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, scale: number) {
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  if (scale <= 1) {
    for (let y = 0; y < h; y += th) {
      for (let x = 0; x < w; x += tw) {
        ctx.drawImage(img, x, y, tw, th);
      }
    }
  } else {
    ctx.drawImage(img, 0, 0, tw, th);
  }
}

// Base preview resolution (zoom = 1). High-res cap: beyond this we use nearest-neighbor.
const MAX_PREVIEW_DIM = 1200;
const MAX_RENDER_DIM  = 3200;

function RegMark({ x, y, size }: { x: number; y: number; size: number }) {
  const r = size / 2;
  const arm = r * 1.7;
  return (
    <g transform={`translate(${x},${y})`}>
      <circle cx={0} cy={0} r={r} fill="none" stroke="currentColor" strokeWidth={size / 22} />
      <line x1={-arm} y1={0} x2={arm} y2={0} stroke="currentColor" strokeWidth={size / 22} />
      <line x1={0} y1={-arm} x2={0} y2={arm} stroke="currentColor" strokeWidth={size / 22} />
      <circle cx={0} cy={0} r={r * 0.13} fill="currentColor" />
    </g>
  );
}

export function CanvasView() {
  const canvasRef           = useRef<HTMLCanvasElement>(null);
  const paintOverlayRef     = useRef<HTMLCanvasElement>(null);
  const brushSizeRef        = useRef(20);
  const containerRef        = useRef<HTMLDivElement>(null);
  const zoomRef             = useRef(1);
  const activePointersRef   = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef            = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const lastAutoDetectKey   = useRef('');
  const lastAutoAdjImageRef = useRef<ImageData | null>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const artboardStageRef = useRef<HTMLDivElement>(null);
  const dimTimerRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const paintDraftRef    = useRef<Uint8Array | null>(null);
  const paintDraftDimsRef = useRef({ w: 0, h: 0 });
  const isPaintingRef    = useRef(false);
  const bgPaintDraftRef     = useRef<Uint8Array | null>(null);
  const bgPaintDraftDimsRef = useRef({ w: 0, h: 0 });
  const isBgPaintingRef     = useRef(false);
  const dtgPaintDraftRef     = useRef<Uint8Array | null>(null);
  const dtgPaintDraftDimsRef = useRef({ w: 0, h: 0 });
  const isDtgPaintingRef     = useRef(false);
  const spaceHeldRef     = useRef(false);
  const undoStackRef     = useRef<Record<string, Array<Uint8Array | null>>>({});
  // Cache K-means base colors (from unadjusted image) for color-sep.
  // K-means only reruns when image / numColors / colorPriority / bg settings change.
  // Image adjustments are applied mathematically to the cached base colors — no K-means rerun.
  const csKmeansCacheRef = useRef<{
    originalImage: ImageData; numColors: number; colorPriority: number;
    bgRemovalEnabled: boolean; bgTolerance: number; bgSeedColors: string[];
    baseColors: import('../engine/colorSeparation').RGB[];
  } | null>(null);

  // Level-0 grain cache: k-means cluster detection only (NOT pattern-dependent)
  // Invalidated by: image, canvas size, numColors, bg settings
  // Pattern changes hit this as a cache HIT, skipping the expensive k-means step.
  const grainKmeansCacheRef = useRef<{
    originalImage: ImageData;
    key: string;
    bgPaintMask: Uint8Array | null;
    baseColors: import('../engine/colorSeparation').RGB[];
  } | null>(null);

  // Level-1 grain cache: pixel assignment (depends on pattern + blur + adjustments)
  // Invalidated by: level-0 miss, blur change, pattern change, adjustment change
  const grainLayersCacheRef = useRef<{
    key: string;
    bgPaintMask: Uint8Array | null;
    layers: import('../engine/imageProcessor').ProcessedLayer[];
  } | null>(null);

  // Level-2 grain cache: rendered ImageData composite (without overlays)
  // Invalidated by level-1 key + colorBlend
  // Overlay changes use this directly — zero separation work needed
  const grainBaseCompositeRef = useRef<{
    key: string;
    bgPaintMask: Uint8Array | null;
    composite: ImageData;
  } | null>(null);

  const grainOverlayImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const {
    originalImage, previewImage, layers, knockoutEnabled, underbaseEnabled, underbaseChoke, underbaseIncludeShadows, underbaseDensity, pantonePreviewActive,
    globalPattern,
    bgRemovalEnabled, bgTolerance, bgSeedColors, bgEyedropperActive, setBgRemovalEnabled, setBgSeedColors, setBgEyedropperActive,
    bgPaintMask, bgPaintMaskDims, bgPaintMode, setBgPaintMask,
    showRegistrationMarks, regMarkPadding, documentBleed,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    canvasColor, showFabricBg, setShowFabricBg, fabricTexture, fabricBlendStrength, fabricTextureDepth,
    imageAdjustments,
    documentDpi, documentWidthIn, documentHeightIn,
    separationMode, cmykLpi, cmykVisibility, cmykAngles, cmykParams, cmykViewMode,
    paletteNumColors, paletteColors, paletteVisibility, palettePattern, palettePatternScale, paletteColorMode,
    paletteDensity, paletteAngle, paletteSoftness,
    paletteAnalyzeKey,
    setPaletteColors,
    passthroughMode,
    paintMasks, paintMode, brushSize, selectedLayerId,
    processedLayers, processedLayerDims,
    isProcessing, setOriginalImage, setProcessedLayers, setProcessedLayerDims, setDitherComposite, setIsProcessing, setCanvasColor, setImageAdjustment,
    setPaintMask, setPaintMode, setBrushSize, clearPaintMask,
    soloLayerId, setCmykQuality,
    colorSepNumColors, colorSepColorPriority, colorSepPattern, colorSepPatternScale,
    colorSepPatternDensity, colorSepPatternAngle, colorSepVisibility, setColorSepColors,
    colorSepLockedColors,
    grainColorBlend, grainColorCount, grainBlur, grainOverlays,
    grainPattern, grainPatternScale, grainPatternDensity, grainPatternAngle,
    bgEdgeSoftness,
    splitView, setSplitView,
    showCanvasBorder, setShowCanvasBorder,
    proCmykSettings, setProCmykPlates,
    printSimActive, setPrintSimLoading, viewingDistance,
    dtgMethod, dtgFrequency, dtgAngle, dtgLevelsBlack, dtgLevelsWhite, dtgLevelsGamma, dtgSoftness, dtgGreyscalePreview, dtgDespeckle, dtgDespeckleRadius,
    dtgPaintMask, dtgPaintMaskDims, dtgPaintMode, setDtgPaintMask, pushHistory,
  } = useStore();

  // Raw ICC planes cache — keyed by image+profile+adjustments only.
  // Density/GCR/TAC changes skip re-separation and run applyPostIcc on these.
  const rawIccCacheRef = useRef<{ key: string; raw: RawIccPlanes } | null>(null);

  // Cached CMYK Pro pipeline output — lets halftone/visibility/sim changes rebuild
  // the composite without re-calling the expensive separateCmykPro() API.
  const cmykProCacheRef = useRef<{
    plates: import('../engine/cmykProEngine').CmykProPlates;
    bgMask: Uint8Array | null;
    artPrevW: number; artPrevH: number;
    artPrevOffX: number; artPrevOffY: number;
    docPrevW: number; docPrevH: number;
  } | null>(null);
  // Fingerprint of the settings that produced the cached plates.
  // Only separation-affecting fields (profile, GCR, densities, bg mask).
  // Halftone settings (LPI/angle/shape/gain) are client-side — they never invalidate the cache.
  const cmykProApiKeyRef = useRef('');
  // Ref mirror of printSimActive so the .then() closure always reads the live value.
  const printSimActiveRef = useRef(printSimActive);
  useEffect(() => { printSimActiveRef.current = printSimActive; }, [printSimActive]);

  // Bumped by the main async effect after it updates the cache with new dims.
  // The lightweight print-sim effect subscribes to this so it re-fires once fresh
  // plates are available (e.g. after the user clicks Adapt then switches preview mode).
  const [printSimBump, setPrintSimBump] = useState(0);

  // Always-current ref to computeDocLayout — updated synchronously each render
  // so stale-closure effects can call it to get expected canvas dims.
  const computeDocLayoutRef = useRef<((dim?: number) => ReturnType<typeof computeDocLayout>) | null>(null);

  // Increments when real texture PNGs finish loading so the processing effect reruns.
  const [textureVersion, setTextureVersion] = useState(0);

  // Fabric blend engine — cached ImageData for the current texture so the
  // per-pixel blend can run synchronously after each canvas draw.
  const fabricImgDataRef = useRef<ImageData | null>(null);
  const fabricLoadKeyRef = useRef('');
  const [fabricVersion, setFabricVersion] = useState(0);

  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart]   = useState({ x: 0, y: 0 });
  const [isDragOver, setIsDragOver] = useState(false);



  // renderDim: the effective max-dim used for the CURRENT canvas render.
  // Scales up with zoom so the canvas resolution matches the display, giving
  // sharp pixels instead of blurry upscaled bilinear interpolation.
  const [renderDim, setRenderDim] = useState(MAX_PREVIEW_DIM);

  // canvasDims: intrinsic size of the current canvas (at renderDim).
  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 });

  // renderedAtDim tracks the renderDim value that was in effect when the canvas was
  // last drawn. cssScale is derived from this — not from renderDim directly — so that
  // scale and canvas pixels change atomically in the same browser paint frame.
  const [renderedAtDim, setRenderedAtDim] = useState(MAX_PREVIEW_DIM);

  // Artwork boundary inside the document canvas for the dashed overlay.
  const [artworkBounds, setArtworkBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Brush cursor position in canvas-view container coords (display pixels).
  const [brushPos, setBrushPos] = useState<{ x: number; y: number } | null>(null);
  const [isSpacePanning, setIsSpacePanning] = useState(false);

  // Artboard preview (no-image state) driven by ResizeObserver.
  const [artboardSize, setArtboardSize] = useState({ w: 0, h: 0 });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Compute how the document + artwork map to a preview canvas at `dim` max-dim.
   * `dim` defaults to `renderDim` (zoom-aware). Pass MAX_PREVIEW_DIM explicitly
   * for layout calculations that should be zoom-independent (Fit, initial load).
   */
  function computeDocLayout(dim = renderDim, dpiOverride?: number) {
    if (!originalImage) return null;
    const ow = originalImage.width, oh = originalImage.height;
    const effectiveDpi = dpiOverride ?? documentDpi;
    const bleedPx    = Math.round(documentBleed * effectiveDpi);
    const innerDocPxW = Math.round(documentWidthIn  * effectiveDpi);
    const innerDocPxH = Math.round(documentHeightIn * effectiveDpi);
    const docPxW = innerDocPxW + 2 * bleedPx;
    const docPxH = innerDocPxH + 2 * bleedPx;
    const sf      = Math.min(innerDocPxW / ow, innerDocPxH / oh);
    const artInDocW = Math.round(ow * sf);
    const artInDocH = Math.round(oh * sf);
    const artOffX   = bleedPx + Math.round((innerDocPxW - artInDocW) / 2);
    const artOffY   = bleedPx + Math.round((innerDocPxH - artInDocH) / 2);
    // pds: scale from full-resolution document pixels → preview pixels (≤ 1.0)
    const pds = Math.min(dim / Math.max(docPxW, docPxH), 1.0);
    return {
      docPrevW: Math.round(docPxW * pds),
      docPrevH: Math.round(docPxH * pds),
      artPrevW: Math.round(artInDocW * pds),
      artPrevH: Math.round(artInDocH * pds),
      artPrevOffX: Math.round(artOffX * pds),
      artPrevOffY: Math.round(artOffY * pds),
      artScaleW: artInDocW,  // full output-resolution artwork width (DPI-dependent)
      artScaleH: artInDocH,
    };
  }

  // Keep computeDocLayoutRef current every render so stale-closure effects can use it.
  computeDocLayoutRef.current = computeDocLayout;

  // ── Effects ───────────────────────────────────────────────────────────────────

  // Load texture PNGs once on mount. If any load, bump textureVersion so the
  // processing effect reruns and picks up the real image data.
  useEffect(() => {
    loadAllTextures().then((count) => {
      if (count > 0) setTextureVersion((v) => v + 1);
    });
  }, []);

  // Load pattern texture PNGs and register them for image-based pattern types.
  useEffect(() => {
    const load = (src: string, key: string) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        const pixels = new Float32Array(c.width * c.height);
        for (let i = 0; i < pixels.length; i++) pixels[i] = data[i * 4] / 255;
        registerPatternTexture(key, c.width, c.height, pixels);
        setTextureVersion((v) => v + 1);
      };
      img.src = src;
    };
    load('/textures/Noise_Texture.png', 'noise-texture');
  }, []);

  // Load fabric texture into ImageData cache when the texture selection changes.
  // Bumps fabricVersion so the main render effect reapplies the blend.
  useEffect(() => {
    if (fabricTexture === 'none') {
      fabricImgDataRef.current = null;
      fabricLoadKeyRef.current = '';
      return;
    }
    const path = fabricTexture === 'light'
      ? '/textures/White_Fabric_ATW.png'
      : '/textures/Black_Fabric_ATW.png';
    if (fabricLoadKeyRef.current === path) return; // already loaded
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      fabricImgDataRef.current = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      fabricLoadKeyRef.current = path;
      setFabricVersion((v) => v + 1);
    };
    img.src = path;
  }, [fabricTexture]);

  // Preload grain overlay images so they're available synchronously in the render effect.
  // Checks the shared module-level cache first — if the user hovered the thumbnail
  // before clicking, the image is already loaded and this is instant.
  const [grainOverlayVersion, setGrainOverlayVersion] = useState(0);
  useEffect(() => {
    if (separationMode !== 'texture' || grainOverlays.length === 0) return;
    const paths = grainOverlays.map(o => o.path).filter(p => !grainOverlayImagesRef.current.has(p));
    if (paths.length === 0) return;
    let pending = 0;
    paths.forEach(path => {
      const cached = getCachedOverlay(path);
      if (cached) {
        grainOverlayImagesRef.current.set(path, cached);
        return;
      }
      pending++;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setCachedOverlay(path, img);
        grainOverlayImagesRef.current.set(path, img);
        pending--;
        if (pending === 0) setGrainOverlayVersion(v => v + 1);
      };
      img.onerror = () => { pending--; if (pending === 0) setGrainOverlayVersion(v => v + 1); };
      img.src = path;
    });
    // All resolved from cache — trigger re-render immediately
    if (pending === 0) setGrainOverlayVersion(v => v + 1);
  }, [grainOverlays, separationMode]);

  // Keep zoomRef in sync so pinch handlers can read current zoom without stale closures.
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Debounce zoom → renderDim.
  // When the user zooms in, wait 200 ms for them to stop, then re-render at a
  // proportionally higher resolution so each screen pixel maps to one canvas pixel.
  useEffect(() => {
    clearTimeout(dimTimerRef.current);
    dimTimerRef.current = setTimeout(() => {
      const target = Math.min(Math.round(MAX_PREVIEW_DIM * Math.max(zoom, 1)), MAX_RENDER_DIM);
      setRenderDim(target);
    }, 200);
    return () => clearTimeout(dimTimerRef.current);
  }, [zoom]);

  // 2× box-filter downscale — 4× fewer pixels for the ICC separation step.
  function downscale2x(src: ImageData): ImageData {
    const w2 = Math.max(1, src.width  >> 1);
    const h2 = Math.max(1, src.height >> 1);
    const dst = new ImageData(w2, h2);
    const sd = src.data, dd = dst.data;
    const sw = src.width;
    for (let y = 0; y < h2; y++) {
      for (let x = 0; x < w2; x++) {
        const s0 = ((y * 2)     * sw + x * 2) * 4;
        const s1 = ((y * 2)     * sw + x * 2 + 1) * 4;
        const s2 = ((y * 2 + 1) * sw + x * 2) * 4;
        const s3 = ((y * 2 + 1) * sw + x * 2 + 1) * 4;
        const d  = (y * w2 + x) * 4;
        dd[d]   = (sd[s0]   + sd[s1]   + sd[s2]   + sd[s3])   >> 2;
        dd[d+1] = (sd[s0+1] + sd[s1+1] + sd[s2+1] + sd[s3+1]) >> 2;
        dd[d+2] = (sd[s0+2] + sd[s1+2] + sd[s2+2] + sd[s3+2]) >> 2;
        dd[d+3] = (sd[s0+3] + sd[s1+3] + sd[s2+3] + sd[s3+3]) >> 2;
      }
    }
    return dst;
  }

  // Bilinear upscale of a single Uint8Array plate channel.
  function upscalePlate(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
    const dst = new Uint8Array(dw * dh);
    const xRatio = sw / dw, yRatio = sh / dh;
    for (let y = 0; y < dh; y++) {
      const ySrc = y * yRatio;
      const y0 = Math.min(sh - 1, ySrc | 0);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fy = ySrc - y0;
      for (let x = 0; x < dw; x++) {
        const xSrc = x * xRatio;
        const x0 = Math.min(sw - 1, xSrc | 0);
        const x1 = Math.min(sw - 1, x0 + 1);
        const fx = xSrc - x0;
        const v = src[y0 * sw + x0] * (1 - fx) * (1 - fy)
                + src[y0 * sw + x1] * fx        * (1 - fy)
                + src[y1 * sw + x0] * (1 - fx)  * fy
                + src[y1 * sw + x1] * fx         * fy;
        dst[y * dw + x] = v + 0.5 | 0;
      }
    }
    return dst;
  }

  // Apply the same luminance adjustment that applyAdjToImage uses, but to a single RGB triple.
  // Used to shift cached K-means cluster centers when image adjustments change.
  type RGB3 = [number, number, number];
  function applyAdjToColor([r, g, b]: RGB3, adj: ImageAdjustments): RGB3 {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const adjLum = applyGlobalAdjustments(lum, adj);
    if (lum < 1) { const v = Math.max(0, Math.min(255, adjLum)) | 0; return [v, v, v]; }
    const scale = adjLum / lum;
    return [
      Math.max(0, Math.min(255, (r * scale + 0.5))) | 0,
      Math.max(0, Math.min(255, (g * scale + 0.5))) | 0,
      Math.max(0, Math.min(255, (b * scale + 0.5))) | 0,
    ];
  }

  // Apply image adjustments to a full RGB ImageData (used by color-sep mode and DTG).
  // Applies luminance adjustments (exposure/contrast/shadows/highlights) then saturation.
  function applyAdjToImage(img: ImageData, adj: ImageAdjustments): ImageData {
    const sat = adj.saturation ?? 0;
    const isNoop = adj.adjMode === 'basic' &&
      adj.exposure === 0 && adj.contrast === 0 &&
      adj.shadows === 0 && adj.highlights === 0 && adj.blur === 0 && sat === 0;
    if (isNoop) return img;
    const { data, width, height } = img;
    const result = new ImageData(new Uint8ClampedArray(data), width, height);
    const rd = result.data;
    const n = width * height;
    const satFactor = 1 + sat / 100;
    for (let i = 0; i < n; i++) {
      if (rd[i * 4 + 3] < 128) continue;
      let r = rd[i * 4], g = rd[i * 4 + 1], b = rd[i * 4 + 2];
      // Luminance adjustments
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
      // Saturation: blend toward gray using perceived luminance
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

  // Apply the procedural fabric blend to a fully-drawn canvas element.
  // Reads fabric ImageData from the cache ref (loaded by the separate effect above)
  // and applies the per-pixel Blend If engine in-place.
  function applyFabricBlendToCanvas(canvas: HTMLCanvasElement) {
    const fabData = fabricImgDataRef.current;
    if (!fabData || fabricTexture === 'none') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const artData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hex = canvasColor.replace('#', '');
    const canvasRgb: [number, number, number] = [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
    applyFabricBlend(artData, fabData, {
      garmentType: fabricTexture,
      blendStrength: fabricBlendStrength,
      textureDepth: fabricTextureDepth,
      canvasRgb,
    });
    ctx.putImageData(artData, 0, 0);
  }

  // Auto-detect the DTG background color whenever the image changes while in DTG mode.
  // Writes into bgSeedColors (left-panel bg controls). Fabric texture is NOT set here —
  // it is only auto-selected when the user explicitly toggles Realistic View on.
  useEffect(() => {
    if (separationMode !== 'dtg' || !originalImage) return;
    const [r, g, b] = detectDtgBgColor(originalImage);
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    setBgSeedColors([hex]);
    setBgRemovalEnabled(true);
    setShowFabricBg(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalImage, separationMode]);

  // Main processing effect.
  // Runs when settings change — zoom is a pure CSS transform and never triggers a reprocess.
  // Always renders at MAX_PREVIEW_DIM; bilinear CSS upscaling gives clean results at any zoom.
  useEffect(() => {
    if (!originalImage) return;
    let cancelled = false;
    let cmykProRunning = false;
    let rafId: number | undefined;
    const delay = separationMode === 'cmyk-pro' ? 200 : separationMode === 'dtg' ? 0 : 40;
    const tid = setTimeout(() => {
      setIsProcessing(true);
      rafId = requestAnimationFrame(() => {
        // Palette mode: fix layout at 300 DPI so changing DPI doesn't resize the canvas.
        // DPI still affects pattern density via the effectiveTileSize formula below.
        const layout = separationMode === 'palette'
          ? computeDocLayout(MAX_PREVIEW_DIM, 300)
          : computeDocLayout(MAX_PREVIEW_DIM);
        if (!layout) { setIsProcessing(false); return; }
        const { docPrevW, docPrevH, artPrevW, artPrevH, artPrevOffX, artPrevOffY } = layout;

        // Single high-quality scale from original → exact slot size.
        const artScaled    = scaleImageDataExact(originalImage, artPrevW, artPrevH);
        const localBgMask = (() => {
          if (!bgRemovalEnabled) return null;
          const seeds = bgSeedColors.length > 0 ? bgSeedColors : undefined;
          if (separationMode !== 'palette') {
            return computeBackgroundMask(artScaled, bgTolerance, seeds);
          }
          // Palette mode with bg removal on: auto-pick tolerance based on background
          // luminance to handle feathered/vignette edges on light backgrounds.
          const d = artScaled.data, w = artScaled.width, h = artScaled.height;
          const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
          const bgLum = corners.reduce((s, p) => s + 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2], 0) / 4;
          const tol = bgLum > 200 ? 40 : bgTolerance;
          return computeBackgroundMask(artScaled, tol, seeds);
        })();

        // Apply user paint-fix overrides on top of the computed mask
        if (localBgMask && bgPaintMask && bgPaintMaskDims &&
            bgPaintMaskDims.w === artPrevW && bgPaintMaskDims.h === artPrevH) {
          for (let i = 0; i < localBgMask.length; i++) {
            if (bgPaintMask[i] === 1) localBgMask[i] = 0;
            else if (bgPaintMask[i] === 2) localBgMask[i] = 255;
          }
        }

        const importanceMap = buildImportanceMap(artScaled, localBgMask);

        let artComposite: ImageData;
        let underbaseLayers: import('../engine/imageProcessor').ProcessedLayer[] = [];
        if (passthroughMode) {
          // Passthrough: original image with BG removal + distressor texture, no separation
          artComposite = new ImageData(new Uint8ClampedArray(artScaled.data), artPrevW, artPrevH);
          if (localBgMask) {
            for (let i = 0; i < localBgMask.length; i++) {
              if (localBgMask[i] === 255) artComposite.data[i * 4 + 3] = 0;
            }
          }
          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (let i = 0; i < texMask.length; i++) {
              if (texMask[i] === 0) artComposite.data[i * 4 + 3] = 0;
            }
          }
          setProcessedLayers([]);
          setProcessedLayerDims({ w: artPrevW, h: artPrevH });
        } else if (separationMode === 'cmyk') {
          const visibleIds = Object.entries(cmykVisibility).filter(([, v]) => v).map(([id]) => id);
          const ALL_VIS = { 'cmyk-k': true, 'cmyk-c': true, 'cmyk-m': true, 'cmyk-y': true };

          const adjScaled = applyAdjToImage(artScaled, imageAdjustments);
          const cellSize = Math.max(3, (artPrevW / documentWidthIn * 4) / cmykLpi);
          const allLayers = cmykSeparate(adjScaled, cellSize, localBgMask, cmykAngles, 1, cmykParams);
          const visibleLayers = allLayers.filter(l => visibleIds.includes(l.id));
          setProcessedLayers(visibleLayers);

          if (cmykViewMode === 'composite') {
            // Composite view: full-color proof on garment substrate (all channels, no halftone)
            artComposite = renderCmykSmooth(adjScaled, localBgMask, ALL_VIS, cmykParams);
          } else {
            // Plates view: show halftone structure for solo channel, smooth for multi
            const isSoloPlate = visibleIds.length === 1;
            if (isSoloPlate) {
              artComposite = renderCmykComposite(visibleLayers, artPrevW, artPrevH, localBgMask);
            } else {
              artComposite = renderCmykSmooth(adjScaled, localBgMask, cmykVisibility, cmykParams);
            }
          }
          const score = computeCmykQuality(adjScaled, cmykParams);
          setCmykQuality(score);
        } else if (separationMode === 'cmyk-pro') {
          // ── CMYK Pro: three-level cache ───────────────────────────────────
          // Level 1 (fastest): plate cache — halftone/visibility changes only, rebuild composite.
          // Level 2 (fast):    raw ICC cache — density/GCR/TAC changed, run applyPostIcc sync.
          // Level 3 (slow):    full ICC separation async when image or profile changes.

          // iccKey: invalidate only when image content or profile changes.
          const iccKey = JSON.stringify([
            proCmykSettings.cmykProfile,
            artPrevW, artPrevH,
            imageAdjustments.adjMode, imageAdjustments.exposure, imageAdjustments.contrast,
            imageAdjustments.shadows, imageAdjustments.highlights, imageAdjustments.blur,
          ]);
          // plateKey: full fingerprint including post-ICC settings.
          const apiKey = JSON.stringify([
            iccKey,
            proCmykSettings.blackGeneration,
            proCmykSettings.totalInkLimit, proCmykSettings.preservePureBlack,
            proCmykSettings.densityC, proCmykSettings.densityM,
            proCmykSettings.densityY, proCmykSettings.densityK,
            proCmykSettings.grayBalance,
            bgRemovalEnabled, bgTolerance,
          ]);
          const cached = cmykProCacheRef.current;
          if (cached && cmykProApiKeyRef.current === apiKey) {
            // Separation settings unchanged — rebuild composite from cached plates.
            // This handles LPI/angle/shape/dotGain changes without an API round-trip.
            const { plates, bgMask: cachedBgMask } = cached;
            const primaries = buildNeugebauerPrimaries(proCmykSettings.cmykProfile);
            const hexVal = canvasColor.replace('#', '');
            const garmentRgb: [number, number, number] = [
              parseInt(hexVal.slice(0, 2), 16),
              parseInt(hexVal.slice(2, 4), 16),
              parseInt(hexVal.slice(4, 6), 16),
            ];
            const garmentLum = showFabricBg
              ? (garmentRgb[0] * 0.299 + garmentRgb[1] * 0.587 + garmentRgb[2] * 0.114) / 255
              : 1;
            const simActive = printSimActiveRef.current;
            const garmentMode = (simActive && garmentLum < 0.5) ? 'dark' : 'light';
            const vis = {
              c: cmykVisibility['cmyk-c'], m: cmykVisibility['cmyk-m'],
              y: cmykVisibility['cmyk-y'], k: cmykVisibility['cmyk-k'],
            };
            const previewDpi = artPrevW / documentWidthIn;
            let whitePlate: Uint8Array | undefined;
            if (underbaseEnabled) {
              const raw = generateCmykProUnderbase(plates, { density: underbaseDensity, includeShadows: underbaseIncludeShadows }, cachedBgMask);
              whitePlate = chokeWhitePlate(raw, plates.width, plates.height, underbaseChoke);
            }
            // Dot View: 150 DPI floor gives ~2.3px cells — visible rosette, clean K holes.
            // ss=2 gives 4 subsamples per cell — fast enough for interactive, quality enough for display.
            const dotViewDpi = Math.max(150, previewDpi);
            const allLayers = applyHalftoneToCmykPlates(plates, proCmykSettings, dotViewDpi, cachedBgMask, whitePlate, 2);
            const visibleIds = Object.entries(cmykVisibility).filter(([, v]) => v).map(([id]) => id);
            setProcessedLayers(allLayers.filter(l => visibleIds.includes(l.id)));
            setProcessedLayerDims({ w: artPrevW, h: artPrevH });
            let composite: ImageData;
            if (simActive) {
              // Print Sim: 2× upsample → Neugebauer composite → area-downsample (fast interactive path)
              const SCALE = 2;
              const plates2x = upsampleCmykPlates(plates, SCALE);
              const bgMask2x = cachedBgMask ? upsampleMask(cachedBgMask, artPrevW, artPrevH, SCALE) : null;
              const wp2x = whitePlate ? upsampleMask(whitePlate, plates.width, plates.height, SCALE) : undefined;
              const layers2x = applyHalftoneToCmykPlates(plates2x, proCmykSettings, previewDpi * SCALE, bgMask2x, wp2x);
              const hi = compositeHalftonePlates(layers2x, artPrevW * SCALE, artPrevH * SCALE, primaries, bgMask2x, vis, garmentMode, garmentRgb);
              composite = areaAverageDownsample(hi, artPrevW, artPrevH);
            } else {
              composite = compositeHalftonePlates(allLayers, artPrevW, artPrevH, primaries, cachedBgMask, vis, garmentMode, garmentRgb);
            }
            setDitherComposite({ data: composite, w: artPrevW, h: artPrevH });
            // Let the main effect's sync draw path render `artComposite` to the canvas.
            artComposite = composite;
          } else if (rawIccCacheRef.current?.key === iccKey) {
          // ── Level 2: raw ICC cached, only post-processing changed → sync ──
          setDitherComposite(null);
          const halfPlatesL2 = applyPostIcc(rawIccCacheRef.current.raw, proCmykSettings);
          const platesL2 = {
            C: upscalePlate(halfPlatesL2.C, halfPlatesL2.width, halfPlatesL2.height, artPrevW, artPrevH),
            M: upscalePlate(halfPlatesL2.M, halfPlatesL2.width, halfPlatesL2.height, artPrevW, artPrevH),
            Y: upscalePlate(halfPlatesL2.Y, halfPlatesL2.width, halfPlatesL2.height, artPrevW, artPrevH),
            K: upscalePlate(halfPlatesL2.K, halfPlatesL2.width, halfPlatesL2.height, artPrevW, artPrevH),
            width: artPrevW, height: artPrevH,
          };
          setProCmykPlates(platesL2);
          cmykProApiKeyRef.current = apiKey;
          cmykProCacheRef.current = { plates: platesL2, bgMask: localBgMask, artPrevW, artPrevH, artPrevOffX, artPrevOffY, docPrevW, docPrevH };
          // Re-enter the plate-cache path synchronously to build the composite
          const cachedL2 = cmykProCacheRef.current;
          {
            const { plates, bgMask: cachedBgMask } = cachedL2;
            const primariesL2 = buildNeugebauerPrimaries(proCmykSettings.cmykProfile);
            const hexL2 = canvasColor.replace('#', '');
            const gRgbL2: [number, number, number] = [parseInt(hexL2.slice(0,2),16), parseInt(hexL2.slice(2,4),16), parseInt(hexL2.slice(4,6),16)];
            const gLumL2 = showFabricBg ? (gRgbL2[0]*0.299+gRgbL2[1]*0.587+gRgbL2[2]*0.114)/255 : 1;
            const simL2 = printSimActiveRef.current;
            const gModeL2 = (simL2 && gLumL2 < 0.5) ? 'dark' : 'light';
            const visL2 = { c: cmykVisibility['cmyk-c'], m: cmykVisibility['cmyk-m'], y: cmykVisibility['cmyk-y'], k: cmykVisibility['cmyk-k'] };
            const prevDpiL2 = artPrevW / documentWidthIn;
            let wpL2: Uint8Array | undefined;
            if (underbaseEnabled) { const rL2 = generateCmykProUnderbase(plates, { density: underbaseDensity, includeShadows: underbaseIncludeShadows }, cachedBgMask); wpL2 = chokeWhitePlate(rL2, plates.width, plates.height, underbaseChoke); }
            const dotDpiL2 = Math.max(150, prevDpiL2);
            const allLayersL2 = applyHalftoneToCmykPlates(plates, proCmykSettings, dotDpiL2, cachedBgMask, wpL2, 2);
            const visIdsL2 = Object.entries(cmykVisibility).filter(([,v])=>v).map(([id])=>id);
            setProcessedLayers(allLayersL2.filter(l => visIdsL2.includes(l.id)));
            setProcessedLayerDims({ w: artPrevW, h: artPrevH });
            let compL2: ImageData;
            if (simL2) {
              const SCALE=2; const p2=upsampleCmykPlates(plates,SCALE); const bm2=cachedBgMask?upsampleMask(cachedBgMask,artPrevW,artPrevH,SCALE):null;
              const wp2=wpL2?upsampleMask(wpL2,plates.width,plates.height,SCALE):undefined;
              const l2=applyHalftoneToCmykPlates(p2,proCmykSettings,prevDpiL2*SCALE,bm2,wp2);
              const hi=compositeHalftonePlates(l2,artPrevW*SCALE,artPrevH*SCALE,primariesL2,bm2,visL2,gModeL2,gRgbL2);
              compL2=areaAverageDownsample(hi,artPrevW,artPrevH);
            } else { compL2=compositeHalftonePlates(allLayersL2,artPrevW,artPrevH,primariesL2,cachedBgMask,visL2,gModeL2,gRgbL2); }
            setDitherComposite({ data: compL2, w: artPrevW, h: artPrevH });
            artComposite = compL2;
          }
          } else {
          // ── Level 3: full ICC separation needed ───────────────────────────
          setDitherComposite(null);
          cmykProRunning = true;
          const adjScaledPro = applyAdjToImage(artScaled, imageAdjustments);
          const halfScaled = downscale2x(adjScaledPro);
          iccSeparateRaw(halfScaled, proCmykSettings.cmykProfile)
            .then((rawPlanes) => {
              if (cancelled) return;
              rawIccCacheRef.current = { key: iccKey, raw: rawPlanes };
              const halfPlates = applyPostIcc(rawPlanes, proCmykSettings);
              // Upscale plates from half-res back to full preview resolution
              const plates = {
                C: upscalePlate(halfPlates.C, halfPlates.width, halfPlates.height, artPrevW, artPrevH),
                M: upscalePlate(halfPlates.M, halfPlates.width, halfPlates.height, artPrevW, artPrevH),
                Y: upscalePlate(halfPlates.Y, halfPlates.width, halfPlates.height, artPrevW, artPrevH),
                K: upscalePlate(halfPlates.K, halfPlates.width, halfPlates.height, artPrevW, artPrevH),
                width: artPrevW, height: artPrevH,
              };
              setProCmykPlates(plates);
              cmykProApiKeyRef.current = apiKey;
              // Cache plates + layout dims for fast rebuilds on subsequent changes
              cmykProCacheRef.current = { plates, bgMask: localBgMask, artPrevW, artPrevH, artPrevOffX, artPrevOffY, docPrevW, docPrevH };
              // If print sim is active but its lightweight rebuild was skipped due to
              // stale cache (user clicked Adapt before this API call finished), re-trigger it.
              if (printSimActiveRef.current) setPrintSimBump((b) => b + 1);
              const visibleIds = Object.entries(cmykVisibility).filter(([, v]) => v).map(([id]) => id);
              const previewDpi = artPrevW / documentWidthIn;
              // Physical Neugebauer ink simulation.
              // Look up the 16-entry primary table (derived from ICC profile Lab primaries)
              // for realistic process-ink colors instead of ideal 0/255 binary values.
              const primaries = buildNeugebauerPrimaries(proCmykSettings.cmykProfile);
              const hexVal2 = canvasColor.replace('#', '');
              const garmentRgb2: [number, number, number] = [
                parseInt(hexVal2.slice(0, 2), 16),
                parseInt(hexVal2.slice(2, 4), 16),
                parseInt(hexVal2.slice(4, 6), 16),
              ];
              const garmentLum2 = showFabricBg
                ? (garmentRgb2[0] * 0.299 + garmentRgb2[1] * 0.587 + garmentRgb2[2] * 0.114) / 255
                : 1;
              // Use ref to read current printSimActive value without it being in dep array
              const simActive = printSimActiveRef.current;
              const garmentMode = (simActive && garmentLum2 < 0.5) ? 'dark' : 'light';
              const vis = {
                c: cmykVisibility['cmyk-c'], m: cmykVisibility['cmyk-m'],
                y: cmykVisibility['cmyk-y'], k: cmykVisibility['cmyk-k'],
              };
              let whitePlate2: Uint8Array | undefined;
              if (underbaseEnabled) {
                const raw2 = generateCmykProUnderbase(plates, { density: underbaseDensity, includeShadows: underbaseIncludeShadows }, localBgMask);
                whitePlate2 = chokeWhitePlate(raw2, plates.width, plates.height, underbaseChoke);
              }
              // Dot View: 150 DPI floor gives ~2.3px cells — visible rosette, clean K holes
              const dotViewDpi2 = Math.max(150, previewDpi);
              const allLayers = applyHalftoneToCmykPlates(plates, proCmykSettings, dotViewDpi2, localBgMask, whitePlate2, 4);
              const visibleLayers = allLayers.filter(l => visibleIds.includes(l.id));
              setProcessedLayers(visibleLayers);
              setProcessedLayerDims({ w: artPrevW, h: artPrevH });

              let composite: ImageData;
              if (simActive) {
                // Print Sim: 4× upsample → Neugebauer composite → area-downsample
                const SCALE = 4;
                const plates4x2   = upsampleCmykPlates(plates, SCALE);
                const bgMask4x2   = localBgMask ? upsampleMask(localBgMask, artPrevW, artPrevH, SCALE) : null;
                const wp4x2 = whitePlate2 ? upsampleMask(whitePlate2, plates.width, plates.height, SCALE) : undefined;
                const layers4x2   = applyHalftoneToCmykPlates(plates4x2, proCmykSettings, previewDpi * SCALE, bgMask4x2, wp4x2);
                const hi = compositeHalftonePlates(
                  layers4x2, artPrevW * SCALE, artPrevH * SCALE,
                  primaries, bgMask4x2, vis, garmentMode, garmentRgb2,
                );
                composite = areaAverageDownsample(hi, artPrevW, artPrevH);
              } else {
                composite = compositeHalftonePlates(
                  allLayers, artPrevW, artPrevH, primaries, localBgMask, vis, garmentMode, garmentRgb2,
                );
              }
              // Pass to MockupPreview so the shirt preview also uses physical ink colors
              setDitherComposite({ data: composite, w: artPrevW, h: artPrevH });

              // Build full docCanvas with fabric bg (mirrors the main rendering pipeline)
              const asyncDoc = document.createElement('canvas');
              asyncDoc.width = docPrevW; asyncDoc.height = docPrevH;
              const aCtx = asyncDoc.getContext('2d')!;
              if (showFabricBg) { aCtx.fillStyle = canvasColor; aCtx.fillRect(0, 0, docPrevW, docPrevH); }
              const artC = document.createElement('canvas');
              artC.width = artPrevW; artC.height = artPrevH;
              artC.getContext('2d')!.putImageData(composite, 0, 0);
              aCtx.drawImage(artC, artPrevOffX, artPrevOffY);

              const canvas = canvasRef.current;
              if (canvas) {
                canvas.width = docPrevW; canvas.height = docPrevH;
                canvas.getContext('2d')!.drawImage(asyncDoc, 0, 0);
                applyFabricBlendToCanvas(canvas);
                setCanvasDims({ w: docPrevW, h: docPrevH });
                setRenderedAtDim(MAX_PREVIEW_DIM);
                setArtworkBounds({ x: artPrevOffX, y: artPrevOffY, w: artPrevW, h: artPrevH });
              }
              setIsProcessing(false);
            })
            .catch((err) => {
              if (!cancelled && err?.name !== 'AbortError') {
                console.error('[cmyk-pro]', err);
              }
              if (!cancelled) setIsProcessing(false);
            });

          // Show original image while API call is in flight
          artComposite = artScaled;
          } // end else (API call path)

        } else if (separationMode === 'palette') {
          // ── Auto-analyze new images to find optimal exposure/contrast ─────
          // Runs once per image load. Computes p2/p98 percentile luminance of
          // non-background pixels and stretches the tonal range to [0,255] so
          // highlights don't pile up into zone k-1 (white pixel artifacts).
          if (originalImage !== lastAutoAdjImageRef.current) {
            lastAutoAdjImageRef.current = originalImage;
            const autoAdj = autoImageAdjustments(artScaled, localBgMask);
            const changed =
              autoAdj.exposure !== imageAdjustments.exposure ||
              autoAdj.contrast !== imageAdjustments.contrast ||
              imageAdjustments.shadows !== 0 || imageAdjustments.highlights !== 0;
            if (changed) {
              setImageAdjustment('exposure',   autoAdj.exposure);
              setImageAdjustment('contrast',   autoAdj.contrast);
              setImageAdjustment('shadows',    0);
              setImageAdjustment('highlights', 0);
              return; // re-fires with new adjustments applied
            }
          }

          // ── Color Match — auto-detect colors then posterize + dither ─────
          // Re-run k-means whenever the image or ink count changes so the
          // colors always match the actual image. Presets override this.
          const autoKey = `${artPrevW}x${artPrevH}-${paletteNumColors}-${paletteAnalyzeKey}`;
          if (autoKey !== lastAutoDetectKey.current) {
            lastAutoDetectKey.current = autoKey;
            const detected = kMeansColors(artScaled, paletteNumColors, 12345, localBgMask);
            setPaletteColors(detected);
            return; // colors updated → effect re-fires → separation runs below
          }

          if (paletteColors.length === 0) return; // guard for first-render edge case

          // Tile size from palettePatternScale:
          //   Error diffusion: block size in pixels (1 = full-res Floyd-Steinberg, ≥2 = block mode).
          //   Bayer ordered:   cellSize = palettePatternScale × (documentDpi / 300) pixels per Bayer cell.
          //                    Tile period = N × cellSize  (N = matrix order, e.g. 8 for Bayer 8×8).
          //                    Matrix size and cell size are fully independent.
          //   Other ordered:   cellSize treated as tile period.
          const isErrDiff = ['diffusion', 'atkinson', 'jarvis', 'stucki'].includes(palettePattern);
          const bN = bayerOrder(palettePattern);
          const cellSize = Math.max(1, Math.round(palettePatternScale * documentDpi / 300));
          const effectiveTileSize = isErrDiff
            ? Math.max(1, Math.round(palettePatternScale))
            : bN > 0
              ? bN * cellSize           // Bayer: period = N × cellSize
              : Math.max(2, cellSize);  // other ordered: period = cellSize

          const plateLayers = paletteSeparate(
            artScaled, paletteColors, localBgMask,
            palettePattern, effectiveTileSize, imageAdjustments,
            paletteDensity, paletteAngle, paletteSoftness, importanceMap,
          );
          const visiblePlateLayers = plateLayers.filter(l => paletteVisibility[l.id] !== false);
          setProcessedLayers(visiblePlateLayers);
          underbaseLayers = plateLayers; // all layers regardless of visibility

          const renderPaletteColors = pantonePreviewActive
            ? paletteColors.map(([r, g, b]) => nearestPantoneRgb(r, g, b))
            : paletteColors;
          artComposite = renderPaletteComposite(
            artScaled, renderPaletteColors, localBgMask, paletteVisibility,
            palettePattern, effectiveTileSize, imageAdjustments,
            paletteDensity, paletteAngle, paletteSoftness, importanceMap,
          );

          // Color mode: overlay original image with 'color' blend to restore original hues
          if (paletteColorMode) {
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = artPrevW; tmpCanvas.height = artPrevH;
            const tmpCtx = tmpCanvas.getContext('2d')!;
            tmpCtx.putImageData(artComposite, 0, 0);

            // Mask background pixels in the original so they don't bleed through the
            // transparent destination — 'color' onto alpha=0 produces source color at
            // source alpha, which would restore the removed background.
            const origData = new ImageData(
              new Uint8ClampedArray(artScaled.data), artPrevW, artPrevH,
            );
            if (localBgMask) {
              for (let i = 0; i < localBgMask.length; i++) {
                if (localBgMask[i] === 255) origData.data[i * 4 + 3] = 0;
              }
            }

            const origCanvas = document.createElement('canvas');
            origCanvas.width = artPrevW; origCanvas.height = artPrevH;
            origCanvas.getContext('2d')!.putImageData(origData, 0, 0);

            tmpCtx.globalCompositeOperation = 'color';
            tmpCtx.drawImage(origCanvas, 0, 0);
            artComposite = tmpCtx.getImageData(0, 0, artPrevW, artPrevH);
          }

          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (const layer of plateLayers) {
              for (let i = 0; i < layer.mask.length; i++) {
                if (texMask[i] === 0) layer.mask[i] = 0;
              }
            }
            for (let i = 0; i < texMask.length; i++) {
              if (texMask[i] === 0) artComposite.data[i * 4 + 3] = 0;
            }
          }

          // Store final composite for mockup (before split view alters it)
          setDitherComposite({ data: artComposite, w: artPrevW, h: artPrevH });
          setProcessedLayerDims({ w: artPrevW, h: artPrevH });

        } else if (separationMode === 'color-sep') {
          setDitherComposite(null);

          const adjScaled = applyAdjToImage(artScaled, imageAdjustments);
          const colorSepSettings = {
            numColors:      colorSepNumColors,
            colorPriority:  colorSepColorPriority / 100,
            pattern:        colorSepPattern,
            patternScale:   colorSepPatternScale,
            patternDensity: colorSepPatternDensity,
            patternAngle:   colorSepPatternAngle,
          };

          // K-means strategy: run once on the UNADJUSTED image, cache the base colors.
          // Image adjustments are then applied mathematically to the cached colors —
          // no K-means rerun. K-means only reruns when image/numColors/colorPriority/bg change.
          const kCache = csKmeansCacheRef.current;
          const cacheValid = !colorSepLockedColors && kCache !== null &&
            kCache.originalImage === originalImage &&
            kCache.numColors === colorSepNumColors &&
            kCache.colorPriority === colorSepColorPriority &&
            kCache.bgRemovalEnabled === bgRemovalEnabled &&
            kCache.bgTolerance === bgTolerance &&
            JSON.stringify(kCache.bgSeedColors) === JSON.stringify(bgSeedColors);

          let lockedForSep: typeof colorSepLockedColors;
          if (colorSepLockedColors) {
            lockedForSep = colorSepLockedColors;
          } else {
            if (!cacheValid) {
              // Run K-means once on unadjusted artScaled so it's adj-independent.
              const baseColors = detectColorSepColors(artScaled, colorSepNumColors, colorSepColorPriority / 100, localBgMask, importanceMap);
              csKmeansCacheRef.current = { originalImage, numColors: colorSepNumColors,
                colorPriority: colorSepColorPriority, bgRemovalEnabled, bgTolerance, bgSeedColors, baseColors };
            }
            // Shift base colors by current adjustments (fast, no K-means).
            const isAdjNoop = imageAdjustments.adjMode === 'basic' &&
              imageAdjustments.exposure === 0 && imageAdjustments.contrast === 0 &&
              imageAdjustments.shadows === 0 && imageAdjustments.highlights === 0 && imageAdjustments.blur === 0;
            lockedForSep = isAdjNoop
              ? csKmeansCacheRef.current!.baseColors
              : (csKmeansCacheRef.current!.baseColors.map(c => applyAdjToColor(c as [number,number,number], imageAdjustments)) as [number,number,number][]);
          }

          const { layers: csLayers, colors: csColors } = colorSeparate(
            adjScaled, colorSepSettings, localBgMask, lockedForSep!, importanceMap,
          );
          setColorSepColors(csColors);
          const visibleCsLayers = csLayers.filter(l => colorSepVisibility[l.id] !== false);
          setProcessedLayers(visibleCsLayers);
          underbaseLayers = csLayers; // all layers regardless of visibility

          // Use pre-computed layer masks — avoids a second colorSeparate call.
          const renderCsColors = pantonePreviewActive
            ? csColors.map(([r, g, b]) => nearestPantoneRgb(r, g, b))
            : csColors;
          artComposite = renderColorSepCompositeFromLayers(csLayers, renderCsColors, colorSepVisibility, artPrevW, artPrevH);

          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (const layer of csLayers) {
              for (let i = 0; i < layer.mask.length; i++) {
                if (texMask[i] === 0) layer.mask[i] = 0;
              }
            }
            for (let i = 0; i < texMask.length; i++) {
              if (texMask[i] === 0) artComposite.data[i * 4 + 3] = 0;
            }
          }

          setProcessedLayerDims({ w: artPrevW, h: artPrevH });

        } else if (separationMode === 'texture') {
          // ── TEXTURE: 3-level cache for fast interactive editing ───────────────
          //
          // Level-0 (slowest): k-means color detection — keyed by image/numColors/bg only
          //   Pattern changes are a cache HIT here — skips the expensive k-means step.
          // Level-1 (moderate): pixel assignment — keyed by level-0 + pattern + blur + adjustments
          // Level-2 (fast):     composite render — keyed by level-1 + colorBlend
          // Overlay compositing: pure canvas ops, zero pixel math

          // Level-0: k-means (no pattern, no blur, no adjustments — pure color clustering)
          const grainKmeansKey = JSON.stringify([
            artPrevW, artPrevH, grainColorCount,
            bgRemovalEnabled, bgTolerance, bgSeedColors,
          ]);
          // bgPaintMask reference is included in each cache hit check — a new Uint8Array
          // is created on every setBgPaintMask call, so reference inequality = mask changed.
          const kmeansHit = grainKmeansCacheRef.current !== null &&
            grainKmeansCacheRef.current.originalImage === originalImage &&
            grainKmeansCacheRef.current.key === grainKmeansKey &&
            grainKmeansCacheRef.current.bgPaintMask === bgPaintMask;

          if (!kmeansHit) {
            const baseColors = detectColorSepColors(artScaled, grainColorCount, 0.7, localBgMask, importanceMap);
            grainKmeansCacheRef.current = { originalImage, key: grainKmeansKey, bgPaintMask, baseColors };
            grainLayersCacheRef.current = null;
          }

          // Level-1: pixel assignment — uses locked colors so k-means never re-runs on pattern change
          const grainLayersKey = grainKmeansKey + '|' + JSON.stringify([
            grainBlur, grainPattern, grainPatternScale, grainPatternDensity, grainPatternAngle,
            imageAdjustments,
          ]);
          const layersHit = grainLayersCacheRef.current !== null &&
            grainLayersCacheRef.current.key === grainLayersKey &&
            grainLayersCacheRef.current.bgPaintMask === bgPaintMask;

          if (!layersHit) {
            let blurredScaled = artScaled;
            if (grainBlur > 0) {
              const srcC = document.createElement('canvas');
              srcC.width = artPrevW; srcC.height = artPrevH;
              srcC.getContext('2d')!.putImageData(artScaled, 0, 0);
              const blurC = document.createElement('canvas');
              blurC.width = artPrevW; blurC.height = artPrevH;
              const blurCtx = blurC.getContext('2d')!;
              blurCtx.filter = `blur(${grainBlur}px)`;
              blurCtx.drawImage(srcC, 0, 0);
              blurCtx.filter = 'none';
              blurredScaled = blurCtx.getImageData(0, 0, artPrevW, artPrevH);
            }
            const adjGrain = applyAdjToImage(blurredScaled, imageAdjustments);
            const grainSettings = {
              numColors: grainColorCount, colorPriority: 0.7,
              pattern: grainPattern, patternScale: grainPatternScale,
              patternDensity: grainPatternDensity, patternAngle: grainPatternAngle,
            };
            const { layers: newLayers } = colorSeparate(
              adjGrain, grainSettings, localBgMask,
              grainKmeansCacheRef.current!.baseColors, importanceMap,
            );
            grainLayersCacheRef.current = { key: grainLayersKey, bgPaintMask, layers: newLayers };
            grainBaseCompositeRef.current = null;
          }

          // Level-2: composite (overlay settings excluded — applied via canvas ops below)
          const grainCompKey = grainLayersKey + '|blend|' + grainColorBlend;
          if (!grainBaseCompositeRef.current || grainBaseCompositeRef.current.key !== grainCompKey ||
              grainBaseCompositeRef.current.bgPaintMask !== bgPaintMask) {
            const t = grainColorBlend / 100;
            const blendedColors = grainKmeansCacheRef.current!.baseColors.map(([r, g, b]): import('../engine/colorSeparation').RGB => {
              const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              return [
                Math.round(lum + (r - lum) * t),
                Math.round(lum + (g - lum) * t),
                Math.round(lum + (b - lum) * t),
              ];
            });
            const composite = renderColorSepCompositeFromLayers(grainLayersCacheRef.current!.layers, blendedColors, {}, artPrevW, artPrevH);
            if (localBgMask) {
              for (let i = 0; i < localBgMask.length; i++) {
                if (localBgMask[i] === 255) composite.data[i * 4 + 3] = 0;
              }
            }
            grainBaseCompositeRef.current = { key: grainCompKey, bgPaintMask, composite };
          }

          // Use cached base composite — overlay changes skip all separation/recomposition
          artComposite = new ImageData(
            new Uint8ClampedArray(grainBaseCompositeRef.current.composite.data),
            artPrevW, artPrevH,
          );

          // Compute soft artwork alpha for edge feathering. Gaussian-blur the BG mask
          // so edge pixels get intermediate alpha values; the pattern/texture on top
          // naturally interacts with the feathered edge without any extra screening.
          let softEdgeAlpha: Uint8Array | null = null;
          if (localBgMask && bgEdgeSoftness > 0) {
            const fw = artPrevW, fh = artPrevH;
            const mC = document.createElement('canvas');
            mC.width = fw; mC.height = fh;
            const mCtx = mC.getContext('2d')!;
            const mImg = new ImageData(fw, fh);
            for (let i = 0; i < localBgMask.length; i++) {
              const v = localBgMask[i] === 255 ? 0 : 255;
              mImg.data[i*4] = mImg.data[i*4+1] = mImg.data[i*4+2] = v;
              mImg.data[i*4+3] = 255;
            }
            mCtx.putImageData(mImg, 0, 0);
            const bC = document.createElement('canvas');
            bC.width = fw; bC.height = fh;
            const bCtx = bC.getContext('2d')!;
            bCtx.filter = `blur(${bgEdgeSoftness}px)`;
            bCtx.drawImage(mC, 0, 0);
            bCtx.filter = 'none';
            const bData = bCtx.getImageData(0, 0, fw, fh).data;
            softEdgeAlpha = new Uint8Array(localBgMask.length);
            for (let i = 0; i < softEdgeAlpha.length; i++) {
              softEdgeAlpha[i] = bData[i * 4];
            }
            // Multiply artwork alpha by the blurred mask — edges fade to transparent.
            for (let i = 0; i < softEdgeAlpha.length; i++) {
              artComposite.data[i * 4 + 3] = Math.round(artComposite.data[i * 4 + 3] * softEdgeAlpha[i] / 255);
            }
          }

          // Composite surface layers (overlays) — pure canvas ops, GPU-accelerated
          if (grainOverlays.length > 0) {
            const overlayCanvas = document.createElement('canvas');
            overlayCanvas.width = artPrevW; overlayCanvas.height = artPrevH;
            const oCtx = overlayCanvas.getContext('2d')!;
            oCtx.putImageData(artComposite, 0, 0);

            for (const ov of grainOverlays) {
              if (ov.visible === false) continue;
              const img = grainOverlayImagesRef.current.get(ov.path);
              if (!img) continue;

              const hasLevels = ov.levelsIn && (ov.levelsIn[0] !== 0 || ov.levelsIn[1] !== 255);
              const needsTemp = (ov.clipToArtwork && (localBgMask || softEdgeAlpha)) || hasLevels || ov.invert || ov.grayscale;

              if (needsTemp) {
                const tmpC = document.createElement('canvas');
                tmpC.width = artPrevW; tmpC.height = artPrevH;
                const tCtx = tmpC.getContext('2d')!;
                drawScaledOverlay(tCtx, img, artPrevW, artPrevH, ov.scale ?? 1);
                const td = tCtx.getImageData(0, 0, artPrevW, artPrevH);
                const [inBlack, inWhite] = ov.levelsIn ?? [0, 255];
                const range = Math.max(1, inWhite - inBlack);
                for (let pi = 0; pi < td.data.length; pi += 4) {
                  if (ov.invert) {
                    td.data[pi]     = 255 - td.data[pi];
                    td.data[pi + 1] = 255 - td.data[pi + 1];
                    td.data[pi + 2] = 255 - td.data[pi + 2];
                  }
                  if (ov.grayscale) {
                    const lum = Math.round(td.data[pi] * 0.299 + td.data[pi + 1] * 0.587 + td.data[pi + 2] * 0.114);
                    td.data[pi] = td.data[pi + 1] = td.data[pi + 2] = lum;
                  }
                  if (hasLevels) {
                    for (let c = 0; c < 3; c++) {
                      td.data[pi + c] = Math.round(Math.max(0, Math.min(1, (td.data[pi + c] - inBlack) / range)) * 255);
                    }
                  }
                  if (ov.clipToArtwork) {
                    if (softEdgeAlpha) {
                      td.data[pi + 3] = Math.round(td.data[pi + 3] * softEdgeAlpha[pi >> 2] / 255);
                    } else if (localBgMask && localBgMask[pi >> 2] === 255) {
                      td.data[pi + 3] = 0;
                    }
                  }
                }
                tCtx.putImageData(td, 0, 0);
                oCtx.globalAlpha = ov.opacity / 100;
                oCtx.globalCompositeOperation = ov.blendMode as GlobalCompositeOperation;
                oCtx.drawImage(tmpC, 0, 0);
              } else {
                oCtx.globalAlpha = ov.opacity / 100;
                oCtx.globalCompositeOperation = ov.blendMode as GlobalCompositeOperation;
                drawScaledOverlay(oCtx, img, artPrevW, artPrevH, ov.scale ?? 1);
              }
              oCtx.globalAlpha = 1;
              oCtx.globalCompositeOperation = 'source-over';
            }
            artComposite = oCtx.getImageData(0, 0, artPrevW, artPrevH);
          }

          // Distressed texture overlay (same as other modes)
          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (let i = 0; i < texMask.length; i++) {
              if (texMask[i] === 0) artComposite.data[i * 4 + 3] = 0;
            }
          }

          setProcessedLayers([]);
          setProcessedLayerDims({ w: artPrevW, h: artPrevH });

        } else if (separationMode === 'dtg') {
          // ── DTG/DTF: greyscale levels → halftone → alpha mask ────────────────
          // Apply pre-blur first (imageAdjustments.blur) using Canvas API,
          // which blurs the source artwork before any processing starts.
          let dtgBase = artScaled;
          if (imageAdjustments.blur > 0) {
            const srcC = document.createElement('canvas');
            srcC.width = artPrevW; srcC.height = artPrevH;
            srcC.getContext('2d')!.putImageData(artScaled, 0, 0);
            const blurC = document.createElement('canvas');
            blurC.width = artPrevW; blurC.height = artPrevH;
            const blurCtx = blurC.getContext('2d')!;
            blurCtx.filter = `blur(${imageAdjustments.blur}px)`;
            blurCtx.drawImage(srcC, 0, 0);
            blurCtx.filter = 'none';
            dtgBase = blurCtx.getImageData(0, 0, artPrevW, artPrevH);
          }
          const adjScaled = applyAdjToImage(dtgBase, imageAdjustments);
          const previewDpi = artPrevW / Math.max(0.001, documentWidthIn);

          if (dtgGreyscalePreview) {
            // Show the levels-adjusted greyscale mask so users can dial in levels
            // before seeing the final halftone. White = full dot, black = transparent.
            artComposite = renderDtgGreyscalePreview(adjScaled, dtgLevelsBlack, dtgLevelsWhite, dtgLevelsGamma, dtgSoftness);
          } else {
            // Greyscale luminance is the sole alpha driver — dark areas naturally
            // drop out (coverage=0), no separate bg mask needed.
            artComposite = applyDtgHalftone(
              adjScaled,
              {
                method: dtgMethod,
                frequency: dtgFrequency,
                angle: dtgAngle,
                levelsBlack: dtgLevelsBlack,
                levelsWhite: dtgLevelsWhite,
                levelsGamma: dtgLevelsGamma,
                softness: dtgSoftness,
                despeckle: dtgDespeckle,
                despeckleRadius: dtgDespeckleRadius,
              },
              null,
              previewDpi,
            );
          }
          // Apply DTG paint mask (erase/restore brush strokes — DTG-specific, no other mode affected).
          // val=2 (erase): force transparent. val=1 (restore): leave halftone alpha intact so
          // background pixels stay transparent even when the restore brush passes over them.
          if (dtgPaintMask && dtgPaintMaskDims &&
              dtgPaintMaskDims.w === artPrevW && dtgPaintMaskDims.h === artPrevH) {
            for (let i = 0; i < dtgPaintMask.length; i++) {
              if (dtgPaintMask[i] === 2) artComposite.data[i * 4 + 3] = 0;
            }
          }
          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (let i = 0; i < texMask.length; i++) {
              if (texMask[i] === 0) artComposite.data[i * 4 + 3] = 0;
            }
          }
          setDitherComposite({ data: artComposite, w: artPrevW, h: artPrevH });
          setProcessedLayers([]);
          setProcessedLayerDims({ w: artPrevW, h: artPrevH });

        } else {
          setDitherComposite(null);
          const resolved = resolvePatterns(layers, globalPattern);
          // Run without internal knockout so paint masks can be applied first,
          // then the external applyKnockout call below handles overlap removal.
          const processed = processImage(artScaled, resolved, false, localBgMask, imageAdjustments, 1, importanceMap);

          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (const layer of processed) {
              const [lr, lg, lb] = layer.color;
              if (isShadowColor(lr, lg, lb)) continue; // Shadow stays solid — holes would reveal lighter layers beneath
              for (let i = 0; i < layer.mask.length; i++) {
                if (texMask[i] === 0) layer.mask[i] = 0;
              }
            }
          }

          // Apply paint masks BEFORE knockout so user overrides participate in ink dropout
          for (const layer of processed) {
            const pm = paintMasks[layer.id];
            if (!pm) continue;
            for (let i = 0; i < layer.mask.length; i++) {
              if (pm[i] === 1) layer.mask[i] = 255;
              else if (pm[i] === 2) layer.mask[i] = 0;
            }
          }

          // Knockout: upper layers remove matching pixels from lower layers
          if (knockoutEnabled) applyKnockout(processed);

          // Expand extra colors: each extra color becomes a copy of the processed layer
          const expanded = processed.flatMap((pl) => {
            const cfg = layers.find((l) => l.id === pl.id);
            const extras = (cfg?.extraColors ?? []).map((ec, i) => ({
              ...pl, id: `${pl.id}:ec${i}`, color: hexToRgb(ec) as [number, number, number],
            }));
            return [pl, ...extras];
          });

          setProcessedLayers(expanded);
          underbaseLayers = expanded;
          setProcessedLayerDims({ w: artPrevW, h: artPrevH });

          // Solo mode: show only the target layer's knocked-out mask so users
          // can directly verify that knockout updates when ranges change.
          const displayLayers = soloLayerId
            ? expanded.filter((pl) => pl.id === soloLayerId || pl.id.startsWith(`${soloLayerId}:`))
            : expanded;
          const renderDisplayLayers = pantonePreviewActive
            ? displayLayers.map(pl => ({ ...pl, color: nearestPantoneRgb(...pl.color) }))
            : displayLayers;
          artComposite = renderComposite(renderDisplayLayers, artPrevW, artPrevH, true, '#ffffff', !knockoutEnabled);
        }

        // BG edge softness — Gaussian-blur the BG mask so edge pixels get intermediate
        // alpha values. The artwork pattern (halftone, threshold dots) sits on top and
        // naturally interacts with the feathered alpha — no separate edge screen needed.
        if (artComposite && localBgMask && bgEdgeSoftness > 0 && separationMode !== 'texture') {
          const fw = artPrevW, fh = artPrevH;
          const maskC = document.createElement('canvas');
          maskC.width = fw; maskC.height = fh;
          const maskCtx = maskC.getContext('2d')!;
          const maskImg = new ImageData(fw, fh);
          for (let i = 0; i < localBgMask.length; i++) {
            const v = localBgMask[i] === 255 ? 0 : 255;
            maskImg.data[i*4] = maskImg.data[i*4+1] = maskImg.data[i*4+2] = v;
            maskImg.data[i*4+3] = 255;
          }
          maskCtx.putImageData(maskImg, 0, 0);
          const blurC = document.createElement('canvas');
          blurC.width = fw; blurC.height = fh;
          const blurCtx = blurC.getContext('2d')!;
          blurCtx.filter = `blur(${bgEdgeSoftness}px)`;
          blurCtx.drawImage(maskC, 0, 0);
          blurCtx.filter = 'none';
          const softData = blurCtx.getImageData(0, 0, fw, fh).data;
          for (let i = 0; i < localBgMask.length; i++) {
            artComposite.data[i*4+3] = Math.round(artComposite.data[i*4+3] * softData[i*4] / 255);
          }
        }

        // Split view: left = original image, right = processed result (all modes)
        if (splitView) {
          const split = new ImageData(artPrevW, artPrevH);
          const halfW = Math.floor(artPrevW / 2);
          for (let y = 0; y < artPrevH; y++) {
            for (let x = 0; x < artPrevW; x++) {
              const i = (y * artPrevW + x) * 4;
              if (x < halfW) {
                const isBg = localBgMask && localBgMask[y * artPrevW + x] === 255;
                if (isBg) {
                  split.data[i+3] = 0;
                } else {
                  split.data[i]   = artScaled.data[i];
                  split.data[i+1] = artScaled.data[i+1];
                  split.data[i+2] = artScaled.data[i+2];
                  split.data[i+3] = artScaled.data[i+3];
                }
              } else {
                split.data[i]   = artComposite.data[i];
                split.data[i+1] = artComposite.data[i+1];
                split.data[i+2] = artComposite.data[i+2];
                split.data[i+3] = artComposite.data[i+3];
              }
            }
            const di = (y * artPrevW + halfW) * 4;
            split.data[di] = 255; split.data[di+1] = 255; split.data[di+2] = 255; split.data[di+3] = 200;
          }
          artComposite = split;
        }

        // Build document canvas: fabric bg + artwork at 1:1 (zero scaling = zero blur).
        const docCanvas = document.createElement('canvas');
        docCanvas.width = docPrevW; docCanvas.height = docPrevH;
        const dCtx = docCanvas.getContext('2d')!;
        if (showFabricBg) {
          // In CMYK composite view, show garment color as the substrate background
          const bgFill = (separationMode === 'cmyk' && cmykViewMode === 'composite')
            ? (() => { const [r,g,b] = garmentRgbFromParam(cmykParams.garmentColor ?? 0); return `rgb(${r},${g},${b})`; })()
            : canvasColor;
          dCtx.fillStyle = bgFill;
          dCtx.fillRect(0, 0, docPrevW, docPrevH);
        }

        // Build underbase mask (shared for both normal draw and solo view)
        const underbaseSolo = soloLayerId === '__underbase__';
        const shouldDrawUnderbase = underbaseEnabled && separationMode !== 'cmyk' && separationMode !== 'cmyk-pro'
          && (!soloLayerId || underbaseSolo);

        let ubCanvas: HTMLCanvasElement | null = null;
        if (shouldDrawUnderbase) {
          const combined = new Uint8Array(artPrevW * artPrevH);
          for (const pl of underbaseLayers) {
            const [r, g, b] = pl.color;
            if (!underbaseIncludeShadows && isShadowColor(r, g, b)) continue;
            for (let i = 0; i < pl.mask.length; i++) {
              if (pl.mask[i] === 255) combined[i] = 255;
            }
          }
          let ubMask = combined;
          if (underbaseChoke > 0) {
            ubMask = new Uint8Array(combined);
            const c = underbaseChoke;
            for (let y = 0; y < artPrevH; y++) {
              for (let x = 0; x < artPrevW; x++) {
                if (combined[y * artPrevW + x] !== 255) continue;
                let erase = false;
                outer: for (let dy = -c; dy <= c; dy++) {
                  for (let dx = -c; dx <= c; dx++) {
                    if (Math.abs(dx) + Math.abs(dy) > c) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= artPrevW || ny < 0 || ny >= artPrevH || combined[ny * artPrevW + nx] === 0) {
                      erase = true; break outer;
                    }
                  }
                }
                if (erase) ubMask[y * artPrevW + x] = 0;
              }
            }
          }
          const ubData = new ImageData(artPrevW, artPrevH);
          for (let i = 0; i < ubMask.length; i++) {
            if (ubMask[i] !== 255) continue;
            ubData.data[i * 4] = 255; ubData.data[i * 4 + 1] = 255;
            ubData.data[i * 4 + 2] = 255; ubData.data[i * 4 + 3] = 255;
          }
          ubCanvas = document.createElement('canvas');
          ubCanvas.width = artPrevW; ubCanvas.height = artPrevH;
          ubCanvas.getContext('2d')!.putImageData(ubData, 0, 0);
          if (!underbaseSolo) dCtx.drawImage(ubCanvas, artPrevOffX, artPrevOffY);
        }

        const artCanvas = document.createElement('canvas');
        artCanvas.width = artPrevW; artCanvas.height = artPrevH;
        artCanvas.getContext('2d')!.putImageData(artComposite, 0, 0);
        // In underbase solo mode, skip the color art and draw only the white underbase
        if (underbaseSolo && ubCanvas) {
          dCtx.drawImage(ubCanvas, artPrevOffX, artPrevOffY);
        } else {
          dCtx.drawImage(artCanvas, artPrevOffX, artPrevOffY); // 1:1, no blur
        }

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width  = docPrevW;
          canvas.height = docPrevH;
          canvas.getContext('2d')!.drawImage(docCanvas, 0, 0);
          applyFabricBlendToCanvas(canvas);
          setCanvasDims({ w: docPrevW, h: docPrevH });
          setRenderedAtDim(MAX_PREVIEW_DIM);
          setArtworkBounds({ x: artPrevOffX, y: artPrevOffY, w: artPrevW, h: artPrevH });
        }
        if (!cmykProRunning) setIsProcessing(false);
      });
    }, delay);
    return () => { cancelled = true; clearTimeout(tid); if (rafId !== undefined) cancelAnimationFrame(rafId); };
  }, [
    originalImage, layers, knockoutEnabled, globalPattern,
    bgRemovalEnabled, bgTolerance, bgSeedColors, bgPaintMask, passthroughMode, canvasColor, showFabricBg, imageAdjustments,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    textureVersion,
    documentWidthIn, documentHeightIn, documentDpi, documentBleed,
    separationMode, cmykLpi, cmykVisibility, cmykAngles, cmykParams, cmykViewMode,
    paletteNumColors, paletteColors, paletteVisibility, palettePattern, palettePatternScale, paletteColorMode,
    paletteDensity, paletteAngle, paletteSoftness,
    paletteAnalyzeKey,
    splitView,
    paintMasks,
    soloLayerId,
    colorSepNumColors, colorSepColorPriority, colorSepPattern, colorSepPatternScale,
    colorSepPatternDensity, colorSepPatternAngle, colorSepVisibility, colorSepLockedColors,
    grainColorBlend, grainColorCount, grainBlur, grainOverlays, grainOverlayVersion,
    grainPattern, grainPatternScale, grainPatternDensity, grainPatternAngle,
    bgEdgeSoftness,
    dtgMethod, dtgFrequency, dtgAngle, dtgLevelsBlack, dtgLevelsWhite, dtgLevelsGamma, dtgSoftness, dtgGreyscalePreview, dtgDespeckle, dtgDespeckleRadius,
    dtgPaintMask, dtgPaintMaskDims,
    underbaseEnabled, underbaseChoke, underbaseIncludeShadows, underbaseDensity, pantonePreviewActive,
    proCmykSettings,
    fabricTexture, fabricBlendStrength, fabricTextureDepth, fabricVersion,
    // printSimActive excluded — handled by separate composite-rebuild effect (no API re-call)
    // renderDim excluded — zoom is a pure CSS transform, never triggers a reprocess
  ]);

  // Lightweight composite-rebuild effect for printSimActive toggle.
  // Reuses cached plates from cmykProCacheRef — no API call.
  // Uses setTimeout to yield to the browser paint cycle first so the loading
  // indicator renders before the synchronous computation blocks the thread.
  useEffect(() => {
    if (separationMode !== 'cmyk-pro') return;
    const cached = cmykProCacheRef.current;
    if (!cached) { setPrintSimLoading(false); return; }

    let cancelled = false;
    // Capture live values before the deferred call
    const simActive = printSimActive;

    // Stale-cache guard: if cache dims don't match current layout (user clicked Adapt
    // while async was in flight), skip the rebuild entirely — the main effect will
    // finish and draw the canvas at the correct dims, then bump printSimBump to re-trigger.
    const expectedLayout = computeDocLayoutRef.current?.(1200);
    const dimsMismatch = !!expectedLayout && (
      Math.abs(cached.docPrevW - expectedLayout.docPrevW) > 2 ||
      Math.abs(cached.docPrevH - expectedLayout.docPrevH) > 2
    );
    if (dimsMismatch) {
      if (!simActive) setPrintSimLoading(false);
      return;
    }
    const { plates, bgMask: localBgMask, artPrevW, artPrevH, artPrevOffX, artPrevOffY, docPrevW, docPrevH } = cached;
    const capturedSettings = proCmykSettings;

    const tid = setTimeout(() => {
      if (cancelled) return;

      const primaries = buildNeugebauerPrimaries(capturedSettings.cmykProfile);
      const hexValSim = canvasColor.replace('#', '');
      const garmentRgbSim: [number, number, number] = [
        parseInt(hexValSim.slice(0, 2), 16),
        parseInt(hexValSim.slice(2, 4), 16),
        parseInt(hexValSim.slice(4, 6), 16),
      ];
      const garmentLum = showFabricBg
        ? (garmentRgbSim[0] * 0.299 + garmentRgbSim[1] * 0.587 + garmentRgbSim[2] * 0.114) / 255
        : 1;
      const garmentMode = (simActive && garmentLum < 0.5) ? 'dark' : 'light';
      const vis = {
        c: cmykVisibility['cmyk-c'], m: cmykVisibility['cmyk-m'],
        y: cmykVisibility['cmyk-y'], k: cmykVisibility['cmyk-k'],
      };

      const previewDpi = artPrevW / documentWidthIn;
      let whitePlateSim: Uint8Array | undefined;
      if (underbaseEnabled) {
        const rawSim = generateCmykProUnderbase(plates, { density: underbaseDensity, includeShadows: underbaseIncludeShadows });
        whitePlateSim = chokeWhitePlate(rawSim, plates.width, plates.height, underbaseChoke);
      }
      // Dot View: 150 DPI floor gives ~2.3px cells — visible rosette, clean K holes
      const dotViewDpiSim = Math.max(150, previewDpi);
      const allLayers = applyHalftoneToCmykPlates(plates, capturedSettings, dotViewDpiSim, localBgMask, whitePlateSim, 4);
      const visibleIds = Object.entries(cmykVisibility).filter(([, v]) => v).map(([id]) => id);
      setProcessedLayers(allLayers.filter(l => visibleIds.includes(l.id)));
      setProcessedLayerDims({ w: artPrevW, h: artPrevH });

      let composite: ImageData;
      if (simActive) {
        // Print Sim: 4× upsample → Neugebauer composite → area-downsample
        const SCALE = 4;
        const platesSim4x = upsampleCmykPlates(plates, SCALE);
        const bgMask4xSim = localBgMask ? upsampleMask(localBgMask, artPrevW, artPrevH, SCALE) : null;
        const wp4xSim = whitePlateSim ? upsampleMask(whitePlateSim, plates.width, plates.height, SCALE) : undefined;
        const layers4xSim = applyHalftoneToCmykPlates(platesSim4x, capturedSettings, previewDpi * SCALE, bgMask4xSim, wp4xSim);
        const hi = compositeHalftonePlates(layers4xSim, artPrevW * SCALE, artPrevH * SCALE, primaries, bgMask4xSim, vis, garmentMode, garmentRgbSim);
        composite = areaAverageDownsample(hi, artPrevW, artPrevH);
      } else {
        composite = compositeHalftonePlates(allLayers, artPrevW, artPrevH, primaries, localBgMask, vis, garmentMode, garmentRgbSim);
      }
      setDitherComposite({ data: composite, w: artPrevW, h: artPrevH });

      const asyncDoc = document.createElement('canvas');
      asyncDoc.width = docPrevW; asyncDoc.height = docPrevH;
      const aCtx = asyncDoc.getContext('2d')!;
      if (showFabricBg) { aCtx.fillStyle = canvasColor; aCtx.fillRect(0, 0, docPrevW, docPrevH); }
      const artC = document.createElement('canvas');
      artC.width = artPrevW; artC.height = artPrevH;
      artC.getContext('2d')!.putImageData(composite, 0, 0);
      aCtx.drawImage(artC, artPrevOffX, artPrevOffY);

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = docPrevW; canvas.height = docPrevH;
        canvas.getContext('2d')!.drawImage(asyncDoc, 0, 0);
        applyFabricBlendToCanvas(canvas);
        setCanvasDims({ w: docPrevW, h: docPrevH });
        setRenderedAtDim(MAX_PREVIEW_DIM);
        setArtworkBounds({ x: artPrevOffX, y: artPrevOffY, w: artPrevW, h: artPrevH });
      }
      setPrintSimLoading(false);
    }, 0);

    return () => { cancelled = true; clearTimeout(tid); };
  }, [printSimActive, printSimBump]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit-to-view on image load. Uses zoom-independent base dims.
  useEffect(() => {
    if (!previewImage || !originalImage || !containerRef.current) return;
    const layout = computeDocLayout(MAX_PREVIEW_DIM);
    if (!layout) return;
    const { clientWidth: cw, clientHeight: ch } = containerRef.current;
    const fitZoom = Math.min(1, (cw - 48) / layout.docPrevW, (ch - 48) / layout.docPrevH);
    setZoom(fitZoom);
    // Center the canvas: offset is the canvas top-left position in container space.
    // visual canvas size at fitZoom = layout.docPrevW * fitZoom (renderedAtDim = MAX_PREVIEW_DIM here)
    setOffset({ x: (cw - layout.docPrevW * fitZoom) / 2, y: (ch - layout.docPrevH * fitZoom) / 2 });
  }, [previewImage]);

  // Artboard ResizeObserver (empty-state animation).
  useEffect(() => {
    const compute = () => {
      const stage = artboardStageRef.current;
      if (!stage) return;
      const { width: cw, height: ch } = stage.getBoundingClientRect();
      if (cw === 0 || ch === 0) return;
      const ar = documentWidthIn / Math.max(0.001, documentHeightIn);
      const availW = cw - 64, availH = ch - 80;
      let w = availW * 0.92, h = w / ar;
      if (h > availH * 0.92) { h = availH * 0.92; w = h * ar; }
      setArtboardSize({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    const obs = new ResizeObserver(compute);
    const stage = artboardStageRef.current;
    if (stage) obs.observe(stage);
    return () => obs.disconnect();
  }, [documentWidthIn, documentHeightIn]);

  // Re-draw paint overlay from committed masks whenever they change.
  useEffect(() => {
    const octx = paintOverlayRef.current?.getContext('2d');
    if (!octx || canvasDims.w === 0 || !artworkBounds) return;
    octx.clearRect(0, 0, canvasDims.w, canvasDims.h);
    const { w, h, x, y } = artworkBounds;
    const layerMask = selectedLayerId ? paintMasks[selectedLayerId] : null;
    const hasBgPaint = bgPaintMode !== 'off' && !!(bgPaintMask && bgPaintMaskDims && bgPaintMaskDims.w === w && bgPaintMaskDims.h === h);
    if (!layerMask && !hasBgPaint) return;
    const imgData = new ImageData(w, h);
    // BG paint drawn first (lower z-order)
    if (hasBgPaint && bgPaintMask) {
      for (let i = 0; i < bgPaintMask.length; i++) {
        if (bgPaintMask[i] === 1) {
          imgData.data[i * 4] = 40; imgData.data[i * 4 + 1] = 140; imgData.data[i * 4 + 2] = 255; imgData.data[i * 4 + 3] = 110;
        } else if (bgPaintMask[i] === 2) {
          imgData.data[i * 4] = 255; imgData.data[i * 4 + 1] = 120; imgData.data[i * 4 + 2] = 0; imgData.data[i * 4 + 3] = 110;
        }
      }
    }
    // Layer paint drawn on top
    if (layerMask) {
      for (let i = 0; i < layerMask.length; i++) {
        if (layerMask[i] === 1) {
          imgData.data[i * 4] = 80; imgData.data[i * 4 + 1] = 200; imgData.data[i * 4 + 2] = 80; imgData.data[i * 4 + 3] = 110;
        } else if (layerMask[i] === 2) {
          imgData.data[i * 4] = 200; imgData.data[i * 4 + 1] = 60; imgData.data[i * 4 + 2] = 60; imgData.data[i * 4 + 3] = 110;
        }
      }
    }
    octx.putImageData(imgData, x, y);
  }, [paintMasks, selectedLayerId, artworkBounds, canvasDims, bgPaintMask, bgPaintMaskDims, bgPaintMode]);

  // Keep brushSizeRef in sync so the key handler always has the latest value.
  brushSizeRef.current = brushSize;

  // [ ] bracket keys to resize brush when any paint mode is active.
  useEffect(() => {
    const dtgActive = separationMode === 'dtg' && dtgPaintMode !== 'off';
    if (paintMode === 'off' && bgPaintMode === 'off' && !dtgActive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '[') setBrushSize(brushSizeRef.current - 5);
      else if (e.key === ']') setBrushSize(brushSizeRef.current + 5);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paintMode, bgPaintMode, dtgPaintMode, separationMode, setBrushSize]);

  // Spacebar: hold to temporarily pan instead of paint.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spaceHeldRef.current = true;
        setIsSpacePanning(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
        setIsSpacePanning(false);
      }
    };
    document.addEventListener('keydown', onDown);
    document.addEventListener('keyup', onUp);
    return () => {
      document.removeEventListener('keydown', onDown);
      document.removeEventListener('keyup', onUp);
    };
  }, []);

  // Ctrl/Cmd+Z: undo the last paint stroke on the selected layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (!selectedLayerId) return;
        const stack = undoStackRef.current[selectedLayerId];
        if (!stack || stack.length === 0) return;
        const prev = stack[stack.length - 1];
        undoStackRef.current[selectedLayerId] = stack.slice(0, -1);
        setPaintMask(selectedLayerId, prev ? new Uint8Array(prev) : null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedLayerId, setPaintMask]);

  // ── File loading ──────────────────────────────────────────────────────────────

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cCtx = c.getContext('2d', { colorSpace: 'srgb' }) as CanvasRenderingContext2D;
      cCtx.drawImage(img, 0, 0);
      const original = cCtx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
      const preview  = scaleImageData(original, MAX_PREVIEW_DIM);
      setOriginalImage(original, preview, file.name);
      setCanvasColor(detectBackgroundColor(preview));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [setOriginalImage, setCanvasColor]);

  // ── Interaction ────────────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    const file = e.dataTransfer.files[0]; if (file) loadFile(file);
  }, [loadFile]);

  const handleWheel = (e: React.WheelEvent) => {
    if (!originalImage) return;
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom((oldZoom) => {
      const newZoom = Math.min(8, Math.max(0.05, oldZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      const ratio = newZoom / oldZoom;
      // Keep the canvas point under the cursor fixed in screen space.
      setOffset((o) => ({ x: mx - (mx - o.x) * ratio, y: my - (my - o.y) * ratio }));
      return newZoom;
    });
  };

  // ── Paint helpers ─────────────────────────────────────────────────────────────

  function paintCircleOnMask(mask: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, val: 1 | 2) {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = Math.round(cx + dx), py = Math.round(cy + dy);
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        mask[py * w + px] = val;
      }
    }
  }

  function getArtworkCoords(e: React.MouseEvent): { cx: number; cy: number } | null {
    if (!canvasRef.current || !artworkBounds) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / cssScale;
    const canvasY = (e.clientY - rect.top) / cssScale;
    return { cx: canvasX - artworkBounds.x, cy: canvasY - artworkBounds.y };
  }

  const applyPaintPoint = (e: React.PointerEvent) => {
    const coords = getArtworkCoords(e);
    if (!coords || !isPaintingRef.current || !paintDraftRef.current) return;
    const { cx, cy } = coords;
    const { w, h } = paintDraftDimsRef.current;
    const val: 1 | 2 = paintMode === 'paint' ? 1 : 2;
    paintCircleOnMask(paintDraftRef.current, w, h, cx, cy, brushSize, val);
    const octx = paintOverlayRef.current?.getContext('2d');
    if (octx) {
      octx.beginPath();
      octx.arc(cx + (artworkBounds?.x ?? 0), cy + (artworkBounds?.y ?? 0), brushSize, 0, Math.PI * 2);
      octx.fillStyle = paintMode === 'paint' ? 'rgba(80, 200, 80, 0.45)' : 'rgba(200, 60, 60, 0.45)';
      octx.fill();
    }
  };

  const handlePaintMouseDown = (e: React.PointerEvent) => {
    if (paintMode === 'off' || !selectedLayerId || !artworkBounds) return;
    e.stopPropagation();
    isPaintingRef.current = true;
    const dims = { w: artworkBounds.w, h: artworkBounds.h };
    paintDraftDimsRef.current = dims;
    const existing = paintMasks[selectedLayerId] ?? null;
    // Save current mask to undo stack before this stroke
    const prevStack = undoStackRef.current[selectedLayerId] ?? [];
    undoStackRef.current[selectedLayerId] = [...prevStack.slice(-19), existing ? new Uint8Array(existing) : null];
    paintDraftRef.current = existing ? new Uint8Array(existing) : new Uint8Array(dims.w * dims.h);
    applyPaintPoint(e);
  };

  const handlePaintMouseMove = (e: React.PointerEvent) => {
    if (!isPaintingRef.current) return;
    applyPaintPoint(e);
  };

  const handlePaintMouseUp = () => {
    if (!isPaintingRef.current || !selectedLayerId || !paintDraftRef.current) return;
    isPaintingRef.current = false;
    // Commit to store — the overlay useEffect will redraw from the committed mask
    setPaintMask(selectedLayerId, new Uint8Array(paintDraftRef.current));
    paintDraftRef.current = null;
  };

  const handleInvertMask = () => {
    if (!selectedLayerId || !artworkBounds) return;
    const { w, h } = artworkBounds;
    const existing = paintMasks[selectedLayerId] ?? null;
    const newMask = new Uint8Array(w * h);
    if (!existing) {
      newMask.fill(2); // empty mask → invert = hide everything, paint back what you want
    } else {
      for (let i = 0; i < newMask.length; i++) {
        newMask[i] = existing[i] === 2 ? 1 : 2; // erased→shown, shown/unset→erased
      }
    }
    const prevStack = undoStackRef.current[selectedLayerId] ?? [];
    undoStackRef.current[selectedLayerId] = [...prevStack.slice(-19), existing ? new Uint8Array(existing) : null];
    setPaintMask(selectedLayerId, newMask);
  };

  // ── Eyedropper click: sample original image pixel at clicked position ──────────
  const handleEyedropperClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!bgEyedropperActive || !originalImage || !artworkBounds || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = (e.clientX - rect.left) / cssScale;
    const canvasY = (e.clientY - rect.top)  / cssScale;
    const relX = (canvasX - artworkBounds.x) / artworkBounds.w;
    const relY = (canvasY - artworkBounds.y) / artworkBounds.h;
    if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return;
    const px = Math.floor(relX * (originalImage.width  - 1));
    const py = Math.floor(relY * (originalImage.height - 1));
    const pi = (py * originalImage.width + px) * 4;
    const r = originalImage.data[pi];
    const g = originalImage.data[pi + 1];
    const b = originalImage.data[pi + 2];
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    setBgSeedColors([...bgSeedColors, hex]);
    setBgEyedropperActive(false);
  };

  // ── BG paint-fix handlers ───────────────────────────────────────────────────────
  const applyBgPaintPoint = (e: React.PointerEvent) => {
    const coords = getArtworkCoords(e);
    if (!coords || !isBgPaintingRef.current || !bgPaintDraftRef.current) return;
    const { cx, cy } = coords;
    const { w, h } = bgPaintDraftDimsRef.current;
    const val: 1 | 2 = bgPaintMode === 'restore' ? 1 : 2;
    paintCircleOnMask(bgPaintDraftRef.current, w, h, cx, cy, brushSize, val);
    const octx = paintOverlayRef.current?.getContext('2d');
    if (octx) {
      octx.beginPath();
      octx.arc(cx + (artworkBounds?.x ?? 0), cy + (artworkBounds?.y ?? 0), brushSize, 0, Math.PI * 2);
      octx.fillStyle = bgPaintMode === 'restore' ? 'rgba(40, 140, 255, 0.45)' : 'rgba(255, 120, 0, 0.45)';
      octx.fill();
    }
  };

  const handleBgPaintMouseDown = (e: React.PointerEvent) => {
    if (bgPaintMode === 'off' || !artworkBounds) return;
    e.stopPropagation();
    isBgPaintingRef.current = true;
    const dims = { w: artworkBounds.w, h: artworkBounds.h };
    bgPaintDraftDimsRef.current = dims;
    const existingMask = (bgPaintMask && bgPaintMaskDims &&
      bgPaintMaskDims.w === dims.w && bgPaintMaskDims.h === dims.h) ? bgPaintMask : null;
    bgPaintDraftRef.current = existingMask ? new Uint8Array(existingMask) : new Uint8Array(dims.w * dims.h);
    applyBgPaintPoint(e);
  };

  const handleBgPaintMouseMove = (e: React.PointerEvent) => {
    if (!isBgPaintingRef.current) return;
    applyBgPaintPoint(e);
  };

  const handleBgPaintMouseUp = () => {
    if (!isBgPaintingRef.current || !bgPaintDraftRef.current) return;
    isBgPaintingRef.current = false;
    setBgPaintMask(new Uint8Array(bgPaintDraftRef.current), { ...bgPaintDraftDimsRef.current });
    bgPaintDraftRef.current = null;
  };

  // ── DTG paint handlers ─────────────────────────────────────────────────────────
  // Completely separate from bgPaint — only active in DTG mode, only touches dtgPaintMask.
  const applyDtgPaintPoint = (e: React.PointerEvent) => {
    const coords = getArtworkCoords(e);
    if (!coords || !isDtgPaintingRef.current || !dtgPaintDraftRef.current) return;
    const { cx, cy } = coords;
    const { w, h } = dtgPaintDraftDimsRef.current;
    const val: 1 | 2 = dtgPaintMode === 'restore' ? 1 : 2;
    paintCircleOnMask(dtgPaintDraftRef.current, w, h, cx, cy, brushSize, val);
    const octx = paintOverlayRef.current?.getContext('2d');
    if (octx) {
      octx.beginPath();
      octx.arc(cx + (artworkBounds?.x ?? 0), cy + (artworkBounds?.y ?? 0), brushSize, 0, Math.PI * 2);
      octx.fillStyle = dtgPaintMode === 'restore' ? 'rgba(40, 200, 120, 0.45)' : 'rgba(220, 60, 30, 0.45)';
      octx.fill();
    }
  };

  const handleDtgPaintMouseDown = (e: React.PointerEvent) => {
    if (dtgPaintMode === 'off' || !artworkBounds) return;
    e.stopPropagation();
    pushHistory();
    isDtgPaintingRef.current = true;
    const dims = { w: artworkBounds.w, h: artworkBounds.h };
    dtgPaintDraftDimsRef.current = dims;
    const existingMask = (dtgPaintMask && dtgPaintMaskDims &&
      dtgPaintMaskDims.w === dims.w && dtgPaintMaskDims.h === dims.h) ? dtgPaintMask : null;
    dtgPaintDraftRef.current = existingMask ? new Uint8Array(existingMask) : new Uint8Array(dims.w * dims.h);
    applyDtgPaintPoint(e);
  };

  const handleDtgPaintMouseMove = (e: React.PointerEvent) => {
    if (!isDtgPaintingRef.current) return;
    applyDtgPaintPoint(e);
  };

  const handleDtgPaintMouseUp = () => {
    if (!isDtgPaintingRef.current || !dtgPaintDraftRef.current) return;
    isDtgPaintingRef.current = false;
    setDtgPaintMask(new Uint8Array(dtgPaintDraftRef.current), { ...dtgPaintDraftDimsRef.current });
    dtgPaintDraftRef.current = null;
  };

  // ── Derived values ─────────────────────────────────────────────────────────────

  const [cr, cg, cb] = hexToRgb(canvasColor);
  const fabricLum    = (0.299 * cr + 0.587 * cg + 0.114 * cb) / 255;
  const ink          = fabricLum > 0.55 ? 'rgba(0,0,0,' : 'rgba(255,255,255,';
  const artTextColor = showFabricBg ? ink + '0.65)' : 'var(--text-muted)';
  const artDimColor  = showFabricBg ? ink + '0.30)' : 'var(--text-dim)';

  const docPxW = Math.round(documentWidthIn * documentDpi);
  const docPxH = Math.round(documentHeightIn * documentDpi);
  const mR     = Math.min(regMarkPadding * 0.38, 0.22);

  // Registration marks in document-canvas coordinates.
  const regMarkData = (() => {
    if (canvasDims.w === 0) return { positions: [] as { x: number; y: number }[], markSize: 16 };
    const totalDocW = documentWidthIn + 2 * documentBleed;
    const totalDocH = documentHeightIn + 2 * documentBleed;
    const padH = regMarkPadding * (canvasDims.w / totalDocW);
    const padV = regMarkPadding * (canvasDims.h / totalDocH);
    return {
      markSize: Math.min(padH * 0.65, 0.22 * (canvasDims.w / totalDocW)),
      positions: [
        { x: padH,               y: padV },
        { x: canvasDims.w - padH, y: padV },
        { x: padH,               y: canvasDims.h - padV },
        { x: canvasDims.w - padH, y: canvasDims.h - padV },
        { x: canvasDims.w / 2,   y: padV },
        { x: canvasDims.w / 2,   y: canvasDims.h - padV },
      ],
    };
  })();

  // cssScale: how much the browser visually scales the canvas.
  // Uses renderedAtDim (not renderDim) so it only changes when the canvas was
  // actually redrawn — preventing the jump where scale changes before pixels do.
  //   renderedAtDim = MAX_PREVIEW_DIM → cssScale = zoom  (normal, canvas CSS-upscales)
  //   renderedAtDim = MAX_PREVIEW_DIM * zoom → cssScale = 1  (1:1, sharp)
  //   renderedAtDim = MAX_RENDER_DIM (cap hit) → cssScale > 1  (nearest-neighbor)
  const cssScale    = zoom * MAX_PREVIEW_DIM / renderedAtDim;
  // Dither/palette mode uses nearest-neighbor: bilinear blends adjacent ink dots
  // (e.g. red + blue → purple). All other modes use smooth bilinear upscaling so
  // zooming in doesn't produce visible pixel blocks on the 1200px canvas.
  const isPixelated = separationMode === 'palette' || viewingDistance === 'raw';

  // Viewing distance blur — CSS filter applied to the canvas display.
  // Simulates optical dot blending at distance without altering print data.
  // sigma = (distanceFt / 6) × one_dot_css_px; dots at 45 LPI on a 12" print
  // fully blend optically at ~6 ft, so 6ft gives ~1 dot-width sigma.
  const canvasBlur = (() => {
    if (viewingDistance === 'raw' || separationMode !== 'cmyk-pro') return 0;
    const distFt = viewingDistance === '1ft' ? 1 : viewingDistance === '3ft' ? 3 : 6;
    const lpi = proCmykSettings.halftoneC?.lpi ?? 45;
    const dotSizePx = (canvasDims.w * cssScale) / (documentWidthIn * lpi);
    return Math.max(0.2, (distFt / 6) * dotSizePx);
  })();

  // Artboard box style for empty state.
  const artboardBoxStyle: React.CSSProperties = artboardSize.w > 0
    ? {
        width: artboardSize.w, height: artboardSize.h,
        backgroundColor: showFabricBg ? canvasColor : 'transparent',
        transition: [
          'width  0.42s cubic-bezier(0.34,1.56,0.64,1)',
          'height 0.42s cubic-bezier(0.34,1.56,0.64,1)',
          'background-color 0.3s ease',
        ].join(', '),
      }
    : {
        aspectRatio: `${documentWidthIn} / ${documentHeightIn}`,
        maxWidth: '90%', maxHeight: '88%',
        backgroundColor: showFabricBg ? canvasColor : 'transparent',
      };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="canvas-view"
      data-tutorial="tutorial-canvas"
      onWheel={handleWheel}
      onPointerDown={(e) => {
        // Don't intercept clicks on toolbar buttons or interactive children
        if ((e.target as Element).closest('.canvas-toolbar, button, input[type="range"]')) return;

        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Two fingers → start pinch, cancel any drag/paint
        if (activePointersRef.current.size === 2) {
          e.currentTarget.setPointerCapture(e.pointerId);
          const pts = [...activePointersRef.current.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const rect = containerRef.current!.getBoundingClientRect();
          pinchRef.current = {
            dist,
            midX: (pts[0].x + pts[1].x) / 2 - rect.left,
            midY: (pts[0].y + pts[1].y) / 2 - rect.top,
          };
          if (isDtgPaintingRef.current) handleDtgPaintMouseUp();
          if (isBgPaintingRef.current) handleBgPaintMouseUp();
          if (isPaintingRef.current) handlePaintMouseUp();
          setIsDragging(false);
          return;
        }

        if (separationMode === 'dtg' && dtgPaintMode !== 'off' && !spaceHeldRef.current) {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleDtgPaintMouseDown(e);
          return;
        }
        if (bgPaintMode !== 'off' && !spaceHeldRef.current) {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleBgPaintMouseDown(e);
          return;
        }
        if (paintMode !== 'off' && !spaceHeldRef.current) {
          e.currentTarget.setPointerCapture(e.pointerId);
          handlePaintMouseDown(e);
          return;
        }
        if (!originalImage) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      }}
      onPointerMove={(e) => {
        activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Two-finger pinch
        if (activePointersRef.current.size === 2 && pinchRef.current) {
          const pts = [...activePointersRef.current.values()];
          const rect = containerRef.current!.getBoundingClientRect();
          const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const newMidX = (pts[0].x + pts[1].x) / 2 - rect.left;
          const newMidY = (pts[0].y + pts[1].y) / 2 - rect.top;
          const { dist: prevDist, midX: prevMidX, midY: prevMidY } = pinchRef.current;
          const factor = newDist / prevDist;
          const oldZoom = zoomRef.current;
          const newZoom = Math.min(8, Math.max(0.05, oldZoom * factor));
          zoomRef.current = newZoom;
          const ratio = newZoom / oldZoom;
          setZoom(newZoom);
          setOffset((o) => ({
            x: newMidX - (newMidX - o.x) * ratio + (newMidX - prevMidX),
            y: newMidY - (newMidY - o.y) * ratio + (newMidY - prevMidY),
          }));
          pinchRef.current = { dist: newDist, midX: newMidX, midY: newMidY };
          return;
        }

        if (separationMode === 'dtg' && dtgPaintMode !== 'off' && !spaceHeldRef.current) {
          handleDtgPaintMouseMove(e);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) setBrushPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          return;
        }
        if (bgPaintMode !== 'off' && !spaceHeldRef.current) {
          handleBgPaintMouseMove(e);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) setBrushPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          return;
        }
        if (paintMode !== 'off' && !spaceHeldRef.current) {
          handlePaintMouseMove(e);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) setBrushPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          return;
        }
        setBrushPos(null);
        if (isDragging) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }}
      onPointerUp={(e) => {
        activePointersRef.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (activePointersRef.current.size < 2) pinchRef.current = null;
        if (isDtgPaintingRef.current) handleDtgPaintMouseUp();
        if (isBgPaintingRef.current) handleBgPaintMouseUp();
        if (isPaintingRef.current) handlePaintMouseUp();
        setIsDragging(false);
      }}
      onPointerCancel={(e) => {
        activePointersRef.current.delete(e.pointerId);
        e.currentTarget.releasePointerCapture(e.pointerId);
        pinchRef.current = null;
        if (isDtgPaintingRef.current) handleDtgPaintMouseUp();
        if (isBgPaintingRef.current) handleBgPaintMouseUp();
        if (isPaintingRef.current) handlePaintMouseUp();
        setBrushPos(null);
        setIsDragging(false);
      }}
      onPointerLeave={() => {
        if (!isPaintingRef.current && !isBgPaintingRef.current && !isDtgPaintingRef.current) setBrushPos(null);
      }}
      onClick={bgEyedropperActive ? handleEyedropperClick : undefined}
      style={{
        cursor: bgEyedropperActive
          ? 'crosshair'
          : (bgPaintMode !== 'off' || paintMode !== 'off' || (separationMode === 'dtg' && dtgPaintMode !== 'off')) && !isSpacePanning
          ? 'none'
          : isDragging ? 'grabbing'
          : (isSpacePanning || originalImage) ? 'grab'
          : 'default',
        touchAction: 'none',
      }}
    >
      {!originalImage ? (
        <div
          ref={artboardStageRef}
          className="artboard-stage"
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="artboard-label">
            {documentWidthIn}" × {documentHeightIn}" &nbsp;·&nbsp; {documentDpi} DPI
          </div>

          <div
            className={`artboard-box${isDragOver ? ' drag-over' : ''}${!showFabricBg ? ' no-bg' : ''}`}
            style={artboardBoxStyle}
            onClick={() => fileInputRef.current?.click()}
          >
            {showRegistrationMarks && artboardSize.w > 0 && (
              <svg
                viewBox={`0 0 ${documentWidthIn} ${documentHeightIn}`}
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              >
                {[
                  [regMarkPadding,                   regMarkPadding],
                  [documentWidthIn - regMarkPadding, regMarkPadding],
                  [regMarkPadding,                   documentHeightIn - regMarkPadding],
                  [documentWidthIn - regMarkPadding, documentHeightIn - regMarkPadding],
                  [documentWidthIn / 2,              regMarkPadding],
                  [documentWidthIn / 2,              documentHeightIn - regMarkPadding],
                ].map(([mx, my], i) => (
                  <g key={i} stroke={artTextColor} fill={artTextColor} strokeWidth={mR / 10}>
                    <circle cx={mx} cy={my} r={mR} fill="none" />
                    <line x1={mx - mR * 1.7} y1={my} x2={mx + mR * 1.7} y2={my} />
                    <line x1={mx} y1={my - mR * 1.7} x2={mx} y2={my + mR * 1.7} />
                    <circle cx={mx} cy={my} r={mR * 0.13} />
                  </g>
                ))}
              </svg>
            )}
            <div className="artboard-upload-inner">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={artTextColor} strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18"/>
                <polyline points="8 12 12 8 16 12"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
              </svg>
              <div className="artboard-upload-title" style={{ color: artTextColor }}>Drop artwork here</div>
              <div className="artboard-upload-sub"  style={{ color: artTextColor }}>PNG · JPG · TIFF · WebP</div>
            </div>
            <div className="artboard-dims-label" style={{ color: artDimColor }}>
              {docPxW.toLocaleString()} × {docPxH.toLocaleString()} px
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
        </div>
      ) : (
        <>
          <div
            className={`canvas-wrap${!showFabricBg ? ' no-bg' : ''}`}
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${cssScale})` }}
          >
            {/* Fabric blend is applied procedurally in-canvas via applyFabricBlendToCanvas —
                no CSS mix-blend-mode or separate fabric div needed. */}
            <canvas ref={canvasRef} style={{
              imageRendering: isPixelated ? 'pixelated' : 'auto',
              filter: canvasBlur > 0 ? `blur(${canvasBlur.toFixed(2)}px)` : undefined,
            }} />
            <canvas
              ref={paintOverlayRef}
              width={canvasDims.w || 1}
              height={canvasDims.h || 1}
              style={{
                position: 'absolute', top: 0, left: 0, zIndex: 2,
                pointerEvents: 'none',
                opacity: 0.85,
              }}
            />

            {canvasDims.w > 0 && (artworkBounds || showRegistrationMarks) && (
              <svg style={{
                position: 'absolute', overflow: 'visible', top: 0, left: 0,
                width: canvasDims.w, height: canvasDims.h,
                pointerEvents: 'none', color: contrastColor(canvasColor),
              }}>
                {artworkBounds && showCanvasBorder && (
                  <rect
                    x={artworkBounds.x} y={artworkBounds.y}
                    width={artworkBounds.w} height={artworkBounds.h}
                    fill="none" stroke="var(--accent)"
                    strokeWidth={1.5} strokeDasharray="6 4" opacity={0.5}
                  />
                )}
                {showRegistrationMarks && regMarkData.positions.map((pos, i) => (
                  <RegMark key={i} x={pos.x} y={pos.y} size={regMarkData.markSize} />
                ))}
              </svg>
            )}

          </div>

          {/* CMYK Inspect Grid — 2×2 channel overlay for Inspect mode */}
          {separationMode === 'cmyk-pro' && !printSimActive && viewingDistance !== 'raw' && processedLayers.length >= 4 && processedLayerDims && (
            <CmykInspectGrid />
          )}

          {isProcessing && (
            <div className="processing-overlay">
              <div className="processing-label">Processing…</div>
            </div>
          )}

          {/* Brush cursor — follows mouse, sized to match brush radius in display pixels */}
          {(paintMode !== 'off' || bgPaintMode !== 'off' || (separationMode === 'dtg' && dtgPaintMode !== 'off')) && brushPos && !isSpacePanning && (
            <svg style={{
              position: 'absolute',
              left: brushPos.x - brushSize * cssScale,
              top: brushPos.y - brushSize * cssScale,
              width: brushSize * cssScale * 2,
              height: brushSize * cssScale * 2,
              pointerEvents: 'none',
              overflow: 'visible',
              zIndex: 20,
            }}>
              <circle
                cx={brushSize * cssScale}
                cy={brushSize * cssScale}
                r={Math.max(1, brushSize * cssScale - 1)}
                fill={
                  separationMode === 'dtg' && dtgPaintMode === 'restore' ? 'rgba(40,200,120,0.08)' :
                  separationMode === 'dtg' && dtgPaintMode === 'erase'   ? 'rgba(220,60,30,0.08)' :
                  bgPaintMode === 'restore' ? 'rgba(40,140,255,0.08)' :
                  bgPaintMode === 'remove'  ? 'rgba(255,120,0,0.08)' :
                  paintMode === 'paint' ? 'rgba(80,200,80,0.08)' : 'rgba(200,60,60,0.08)'
                }
                stroke={
                  separationMode === 'dtg' && dtgPaintMode === 'restore' ? '#28c878' :
                  separationMode === 'dtg' && dtgPaintMode === 'erase'   ? '#dc3c1e' :
                  bgPaintMode === 'restore' ? '#288cff' :
                  bgPaintMode === 'remove'  ? '#ff7800' :
                  paintMode === 'paint' ? '#50c878' : '#e05050'
                }
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <line
                x1={brushSize * cssScale} y1={brushSize * cssScale - 5}
                x2={brushSize * cssScale} y2={brushSize * cssScale + 5}
                stroke={
                  separationMode === 'dtg' && dtgPaintMode === 'restore' ? '#28c878' :
                  separationMode === 'dtg' && dtgPaintMode === 'erase'   ? '#dc3c1e' :
                  bgPaintMode === 'restore' ? '#288cff' :
                  bgPaintMode === 'remove'  ? '#ff7800' :
                  paintMode === 'paint' ? '#50c878' : '#e05050'
                }
                strokeWidth={1}
              />
              <line
                x1={brushSize * cssScale - 5} y1={brushSize * cssScale}
                x2={brushSize * cssScale + 5} y2={brushSize * cssScale}
                stroke={
                  separationMode === 'dtg' && dtgPaintMode === 'restore' ? '#28c878' :
                  separationMode === 'dtg' && dtgPaintMode === 'erase'   ? '#dc3c1e' :
                  bgPaintMode === 'restore' ? '#288cff' :
                  bgPaintMode === 'remove'  ? '#ff7800' :
                  paintMode === 'paint' ? '#50c878' : '#e05050'
                }
                strokeWidth={1}
              />
            </svg>
          )}

          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.06em', padding: '3px 10px',
            pointerEvents: 'none', textTransform: 'uppercase',
            background: showFabricBg
              ? (contrastColor(canvasColor) === '#000000' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)')
              : 'var(--surface)',
            color: showFabricBg ? contrastColor(canvasColor) : 'var(--text-dim)',
            border: showFabricBg
              ? `1px solid ${contrastColor(canvasColor) === '#000000' ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)'}`
              : '1px solid var(--border)',
          }}>
            {documentWidthIn}" × {documentHeightIn}" · {documentDpi} DPI
          </div>

          <div className="canvas-toolbar">
            <button className="btn btn-ghost btn-icon" onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <span className="canvas-zoom-label">{Math.round(zoom * 100)}%</span>
            <button className="btn btn-ghost btn-icon" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
              </svg>
            </button>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '0 8px' }}
              onClick={() => {
                if (!originalImage || !containerRef.current) return;
                const layout = computeDocLayout(MAX_PREVIEW_DIM);
                if (!layout) return;
                const { clientWidth: cw, clientHeight: ch } = containerRef.current;
                const fitZoom = Math.min(1, (cw - 48) / layout.docPrevW, (ch - 48) / layout.docPrevH);
                setZoom(fitZoom);
                setOffset({ x: (cw - layout.docPrevW * fitZoom) / 2, y: (ch - layout.docPrevH * fitZoom) / 2 });
              }}
            >Fit</button>
            {originalImage && (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
                <button
                  className="btn btn-ghost"
                  style={{
                    fontSize: 10, padding: '0 8px', height: 26, gap: 4,
                    color: splitView ? 'var(--accent)' : 'var(--text-muted)',
                    background: splitView ? 'var(--accent-dim)' : undefined,
                    border: splitView ? '1px solid var(--accent)' : '1px solid transparent',
                  }}
                  title="Split view — original left, processed right"
                  onClick={() => setSplitView(!splitView)}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3 }}>
                    <rect x="3" y="3" width="18" height="18"/><line x1="12" y1="3" x2="12" y2="21"/>
                  </svg>
                  Split
                </button>
              </>
            )}
            {originalImage && separationMode === 'threshold' && (
              <>
                <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
                {/* Paint button */}
                <button
                  className="btn btn-ghost"
                  style={{
                    fontSize: 10, padding: '0 8px', height: 26, gap: 4,
                    color: paintMode === 'paint' ? '#50c878' : 'var(--text-muted)',
                    background: paintMode === 'paint' ? 'rgba(80,200,80,0.12)' : undefined,
                    border: paintMode === 'paint' ? '1px solid rgba(80,200,80,0.3)' : '1px solid transparent',
                  }}
                  title="Paint — add pixels to the selected layer  ·  hold Space to pan"
                  onClick={() => setPaintMode(paintMode === 'paint' ? 'off' : 'paint')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3 }}>
                    <path d="M2 22l7-7"/><path d="M12.5 2.5l9 9-7 7-9-9z"/>
                  </svg>
                  Paint
                </button>
                {/* Erase button */}
                <button
                  className="btn btn-ghost"
                  style={{
                    fontSize: 10, padding: '0 8px', height: 26, gap: 4,
                    color: paintMode === 'erase' ? '#e05050' : 'var(--text-muted)',
                    background: paintMode === 'erase' ? 'rgba(200,60,60,0.12)' : undefined,
                    border: paintMode === 'erase' ? '1px solid rgba(200,60,60,0.3)' : '1px solid transparent',
                  }}
                  title="Erase — remove pixels from the selected layer  ·  hold Space to pan"
                  onClick={() => setPaintMode(paintMode === 'erase' ? 'off' : 'erase')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 3 }}>
                    <path d="M20 20H7L3 16l11-11 7 7-1 8z"/><line x1="6" y1="14" x2="14" y2="6"/>
                  </svg>
                  Erase
                </button>
                {paintMode !== 'off' && (
                  <>
                    <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
                    <input
                      type="range" min={2} max={120} value={brushSize}
                      style={{ width: 60 }}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      title={`Brush: ${brushSize}px  ·  [ to shrink  ] to grow`}
                    />
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', minWidth: 20 }}
                      title="Use [ and ] keys to resize">
                      {brushSize}
                    </span>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', opacity: 0.5 }}
                      title="[ to shrink, ] to grow">
                      [ ]
                    </span>
                    <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
                    {selectedLayerId && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 10, padding: '0 7px', height: 26, color: 'var(--text-dim)' }}
                        title="Invert mask — hides entire layer so you can paint back the areas you want  ·  ⌘Z / Ctrl+Z to undo"
                        onClick={handleInvertMask}
                      >Invert</button>
                    )}
                    {selectedLayerId && paintMasks[selectedLayerId] && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 10, padding: '0 7px', height: 26, color: 'var(--text-dim)' }}
                        title="Clear all paint on this layer  ·  ⌘Z / Ctrl+Z to undo"
                        onClick={() => {
                          const existing = paintMasks[selectedLayerId] ?? null;
                          const prevStack = undoStackRef.current[selectedLayerId] ?? [];
                          undoStackRef.current[selectedLayerId] = [...prevStack.slice(-19), existing ? new Uint8Array(existing) : null];
                          clearPaintMask(selectedLayerId);
                        }}
                      >Clear</button>
                    )}
                  </>
                )}
              </>
            )}
            {/* Canvas border toggle — pushed to far right */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
              <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />
              <button
                className="btn btn-ghost btn-icon"
                title={showCanvasBorder ? 'Hide canvas border' : 'Show canvas border'}
                style={{
                  width: 26, height: 26,
                  color: showCanvasBorder ? 'var(--accent)' : 'var(--text-muted)',
                  border: showCanvasBorder ? '1px solid var(--accent)' : '1px solid transparent',
                  background: showCanvasBorder ? 'var(--accent-dim)' : undefined,
                }}
                onClick={() => setShowCanvasBorder(!showCanvasBorder)}
              >
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2">
                  <rect x="1" y="1" width="18" height="18"/>
                </svg>
              </button>
            </div>
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
        </>
      )}
    </div>
  );
}
