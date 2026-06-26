import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  processImage, applyKnockout, renderComposite, scaleImageData, scaleImageDataExact,
  computeBackgroundMask, detectBackgroundColor, hexToRgb, registerPatternTexture,
  cmykSeparate, renderCmykComposite, renderCmykSmooth, computeCmykQuality,
  garmentRgbFromParam, contrastColor, autoImageAdjustments, applyGlobalAdjustments,
} from '../engine/imageProcessor';
import { kMeansColors, paletteSeparate, renderPaletteComposite, bayerOrder } from '../engine/colorSeparation';
import { colorSeparate, renderColorSepComposite } from '../engine/colorSeparator';
import type { LayerConfig, PatternConfig, ImageAdjustments } from '../engine/imageProcessor';
import { generateTextureMask } from '../engine/textureGenerator';
import { buildImportanceMap } from '../engine/analysisPass';
import { loadAllTextures } from '../engine/textureLoader';
import { traceImageToSVG } from '../engine/vectorTracer';

function resolvePatterns(layers: LayerConfig[], global: PatternConfig): LayerConfig[] {
  return layers.map((l) =>
    l.useGlobalPattern
      ? { ...l, pattern: global.pattern, patternScale: global.patternScale, patternAngle: global.patternAngle, patternDensity: global.patternDensity }
      : l
  );
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
  const lastAutoDetectKey   = useRef('');
  const lastAutoAdjImageRef = useRef<ImageData | null>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const artboardStageRef = useRef<HTMLDivElement>(null);
  const dimTimerRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const paintDraftRef    = useRef<Uint8Array | null>(null);
  const paintDraftDimsRef = useRef({ w: 0, h: 0 });
  const isPaintingRef    = useRef(false);
  const spaceHeldRef     = useRef(false);
  const undoStackRef     = useRef<Record<string, Array<Uint8Array | null>>>({});

  const {
    originalImage, previewImage, layers, knockoutEnabled,
    globalPattern,
    bgRemovalEnabled, bgTolerance,
    showRegistrationMarks, regMarkPadding,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    canvasColor, showFabricBg,
    imageAdjustments,
    documentDpi, documentWidthIn, documentHeightIn,
    separationMode, cmykLpi, cmykVisibility, cmykAngles, cmykParams, cmykViewMode,
    paletteNumColors, paletteColors, paletteVisibility, palettePattern, palettePatternScale, paletteColorMode,
    paletteDensity, paletteAngle, paletteSoftness,
    paletteAnalyzeKey,
    setPaletteColors,
    paintMasks, paintMode, brushSize, selectedLayerId,
    isProcessing, setOriginalImage, setProcessedLayers, setProcessedLayerDims, setDitherComposite, setIsProcessing, setCanvasColor, setImageAdjustment,
    setPaintMask, setPaintMode, setBrushSize, clearPaintMask,
    soloLayerId, setCmykQuality,
    vectorNumColors, vectorDetail, vectorSmooth, vectorInkColor, vectorPathMode, vectorMinSpeckle, vectorSvg, setVectorSvg, setVectorColors,
    colorSepNumColors, colorSepColorPriority, colorSepPattern, colorSepPatternScale,
    colorSepPatternDensity, colorSepPatternAngle, colorSepVisibility, setColorSepColors,
    colorSepLockedColors,
  } = useStore();

  // Increments when real texture PNGs finish loading so the processing effect reruns.
  const [textureVersion, setTextureVersion] = useState(0);

  const [zoom, setZoom]         = useState(1);
  const [offset, setOffset]     = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart]   = useState({ x: 0, y: 0 });
  const [isDragOver, setIsDragOver] = useState(false);

  const [splitView, setSplitView] = useState(false);

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
    const docPxW = Math.round(documentWidthIn * effectiveDpi);
    const docPxH = Math.round(documentHeightIn * effectiveDpi);
    const sf     = Math.min(docPxW / ow, docPxH / oh);
    const artInDocW = Math.round(ow * sf);
    const artInDocH = Math.round(oh * sf);
    const artOffX   = Math.round((docPxW - artInDocW) / 2);
    const artOffY   = Math.round((docPxH - artInDocH) / 2);
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

  // Apply image adjustments to a full RGB ImageData (used by color-sep mode).
  // Adjusts each pixel's luminance proportionally, preserving hue/saturation.
  function applyAdjToImage(img: ImageData, adj: ImageAdjustments): ImageData {
    const isNoop = adj.adjMode === 'basic' &&
      adj.exposure === 0 && adj.contrast === 0 &&
      adj.shadows === 0 && adj.highlights === 0 && adj.blur === 0;
    if (isNoop) return img;
    const { data, width, height } = img;
    const result = new ImageData(new Uint8ClampedArray(data), width, height);
    const rd = result.data;
    const n = width * height;
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

  // Main processing effect.
  // Runs when settings change — zoom is a pure CSS transform and never triggers a reprocess.
  // Always renders at MAX_PREVIEW_DIM; bilinear CSS upscaling gives clean results at any zoom.
  useEffect(() => {
    if (!originalImage) return;
    let cancelled = false;
    let vectorTraceRunning = false;
    let rafId: number | undefined;
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
          if (separationMode !== 'palette') {
            return computeBackgroundMask(artScaled, bgTolerance);
          }
          // Palette mode with bg removal on: auto-pick tolerance based on background
          // luminance to handle feathered/vignette edges on light backgrounds.
          const d = artScaled.data, w = artScaled.width, h = artScaled.height;
          const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
          const bgLum = corners.reduce((s, p) => s + 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2], 0) / 4;
          const tol = bgLum > 200 ? 40 : bgTolerance;
          return computeBackgroundMask(artScaled, tol);
        })();

        const importanceMap = buildImportanceMap(artScaled, localBgMask);

        let artComposite: ImageData;
        if (separationMode === 'cmyk') {
          const visibleIds = Object.entries(cmykVisibility).filter(([, v]) => v).map(([id]) => id);
          const ALL_VIS = { 'cmyk-k': true, 'cmyk-c': true, 'cmyk-m': true, 'cmyk-y': true };

          const cellSize = Math.max(3, documentDpi / cmykLpi);
          const allLayers = cmykSeparate(artScaled, cellSize, localBgMask, cmykAngles, 1, cmykParams);
          const visibleLayers = allLayers.filter(l => visibleIds.includes(l.id));
          setProcessedLayers(visibleLayers);

          if (cmykViewMode === 'composite') {
            // Composite view: full-color proof on garment substrate (all channels, no halftone)
            artComposite = renderCmykSmooth(artScaled, localBgMask, ALL_VIS, cmykParams);
          } else {
            // Plates view: show halftone structure for solo channel, smooth for multi
            const isSoloPlate = visibleIds.length === 1;
            if (isSoloPlate) {
              artComposite = renderCmykComposite(visibleLayers, artPrevW, artPrevH, localBgMask);
            } else {
              artComposite = renderCmykSmooth(artScaled, localBgMask, cmykVisibility, cmykParams);
            }
          }
          const score = computeCmykQuality(artScaled, cmykParams);
          setCmykQuality(score);
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
          setProcessedLayers(plateLayers.filter(l => paletteVisibility[l.id] !== false));

          artComposite = renderPaletteComposite(
            artScaled, paletteColors, localBgMask, paletteVisibility,
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
          const { layers: csLayers, colors: csColors } = colorSeparate(
            adjScaled, colorSepSettings, localBgMask,
            colorSepLockedColors ?? undefined, importanceMap,
          );
          setColorSepColors(csColors);
          setProcessedLayers(csLayers.filter(l => colorSepVisibility[l.id] !== false));

          artComposite = renderColorSepComposite(
            adjScaled, csColors, colorSepVisibility, colorSepSettings, localBgMask, importanceMap,
          );

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

        } else if (separationMode === 'vector') {
          setDitherComposite(null);

          // Build pre-processed imageData with bg pixels made transparent
          const traceData = new ImageData(
            new Uint8ClampedArray(artScaled.data), artPrevW, artPrevH,
          );
          if (localBgMask) {
            for (let i = 0; i < localBgMask.length; i++) {
              if (localBgMask[i] === 255) traceData.data[i * 4 + 3] = 0;
            }
          }

          // Keep the processing spinner up until VTracer finishes.
          // setIsProcessing(false) is skipped at the end of the RAF for this mode.
          vectorTraceRunning = true;
          traceImageToSVG(traceData, {
            numColors: vectorNumColors,
            detail: vectorDetail,
            smooth: vectorSmooth,
            inkColor: vectorInkColor,
            pathMode: vectorPathMode,
            minSpeckle: vectorMinSpeckle,
          }).then(result => {
            if (!cancelled) {
              setVectorSvg(result.svgString);
              setVectorColors(result.colors);
              setIsProcessing(false);
            }
          }).catch(err => {
            console.error('[VTracer] trace failed:', err);
            if (!cancelled) setIsProcessing(false);
          });

          // Show the original image while tracing so the canvas is never blank.
          // The SVG overlay renders on top once VTracer finishes.
          artComposite = traceData;

        } else {
          if (vectorSvg !== null) { setVectorSvg(null); setVectorColors([]); }
          setDitherComposite(null);
          const resolved = resolvePatterns(layers, globalPattern);
          // Run without internal knockout so paint masks can be applied first,
          // then the external applyKnockout call below handles overlap removal.
          const processed = processImage(artScaled, resolved, false, localBgMask, imageAdjustments, 1, importanceMap);

          if (textureEnabled) {
            const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
            for (const layer of processed) {
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
          setProcessedLayerDims({ w: artPrevW, h: artPrevH });

          // Solo mode: show only the target layer's knocked-out mask so users
          // can directly verify that knockout updates when ranges change.
          const displayLayers = soloLayerId
            ? expanded.filter((pl) => pl.id === soloLayerId || pl.id.startsWith(`${soloLayerId}:`))
            : expanded;
          artComposite = renderComposite(displayLayers, artPrevW, artPrevH, true, '#ffffff', !knockoutEnabled);
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

        const artCanvas = document.createElement('canvas');
        artCanvas.width = artPrevW; artCanvas.height = artPrevH;
        artCanvas.getContext('2d')!.putImageData(artComposite, 0, 0);
        dCtx.drawImage(artCanvas, artPrevOffX, artPrevOffY); // 1:1, no blur

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width  = docPrevW;
          canvas.height = docPrevH;
          canvas.getContext('2d')!.drawImage(docCanvas, 0, 0);
          setCanvasDims({ w: docPrevW, h: docPrevH });
          setRenderedAtDim(MAX_PREVIEW_DIM);
          setArtworkBounds({ x: artPrevOffX, y: artPrevOffY, w: artPrevW, h: artPrevH });
        }
        if (!vectorTraceRunning) setIsProcessing(false);
      });
    }, 40);
    return () => { cancelled = true; clearTimeout(tid); if (rafId !== undefined) cancelAnimationFrame(rafId); };
  }, [
    originalImage, layers, knockoutEnabled, globalPattern,
    bgRemovalEnabled, bgTolerance, canvasColor, showFabricBg, imageAdjustments,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    textureVersion,
    documentWidthIn, documentHeightIn, documentDpi,
    separationMode, cmykLpi, cmykVisibility, cmykAngles, cmykParams, cmykViewMode,
    paletteNumColors, paletteColors, paletteVisibility, palettePattern, palettePatternScale, paletteColorMode,
    paletteDensity, paletteAngle, paletteSoftness,
    paletteAnalyzeKey,
    splitView,
    paintMasks,
    soloLayerId,
    vectorNumColors, vectorDetail, vectorSmooth, vectorInkColor, vectorPathMode, vectorMinSpeckle,
    colorSepNumColors, colorSepColorPriority, colorSepPattern, colorSepPatternScale,
    colorSepPatternDensity, colorSepPatternAngle, colorSepVisibility, colorSepLockedColors,
    // renderDim excluded — zoom is a pure CSS transform, never triggers a reprocess
  ]);

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

  // Re-draw paint overlay from committed mask whenever the mask or selected layer changes.
  // This keeps the overlay in sync with the store without clearing on mouseup.
  useEffect(() => {
    const octx = paintOverlayRef.current?.getContext('2d');
    if (!octx || canvasDims.w === 0 || !artworkBounds) return;
    octx.clearRect(0, 0, canvasDims.w, canvasDims.h);
    const mask = selectedLayerId ? paintMasks[selectedLayerId] : null;
    if (!mask) return;
    const { w, h } = artworkBounds;
    const imgData = new ImageData(w, h);
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) {
        imgData.data[i * 4] = 80; imgData.data[i * 4 + 1] = 200; imgData.data[i * 4 + 2] = 80; imgData.data[i * 4 + 3] = 110;
      } else if (mask[i] === 2) {
        imgData.data[i * 4] = 200; imgData.data[i * 4 + 1] = 60; imgData.data[i * 4 + 2] = 60; imgData.data[i * 4 + 3] = 110;
      }
    }
    octx.putImageData(imgData, artworkBounds.x, artworkBounds.y);
  }, [paintMasks, selectedLayerId, artworkBounds, canvasDims]);

  // Keep brushSizeRef in sync so the key handler always has the latest value.
  brushSizeRef.current = brushSize;

  // [ ] bracket keys to resize brush when paint mode is active.
  useEffect(() => {
    if (paintMode === 'off') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '[') setBrushSize(brushSizeRef.current - 5);
      else if (e.key === ']') setBrushSize(brushSizeRef.current + 5);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paintMode, setBrushSize]);

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
      c.getContext('2d')!.drawImage(img, 0, 0);
      const original = c.getContext('2d')!.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
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

  const applyPaintPoint = (e: React.MouseEvent) => {
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

  const handlePaintMouseDown = (e: React.MouseEvent) => {
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

  const handlePaintMouseMove = (e: React.MouseEvent) => {
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
    const padH = regMarkPadding * (canvasDims.w / documentWidthIn);
    const padV = regMarkPadding * (canvasDims.h / documentHeightIn);
    return {
      markSize: Math.max(10, Math.min(36, padH * 0.65)),
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
  const isPixelated = separationMode === 'palette';

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
      onWheel={handleWheel}
      onMouseDown={(e) => {
        if (paintMode !== 'off' && !spaceHeldRef.current) { handlePaintMouseDown(e); return; }
        if (!originalImage) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      }}
      onMouseMove={(e) => {
        if (paintMode !== 'off' && !spaceHeldRef.current) {
          handlePaintMouseMove(e);
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) setBrushPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          return;
        }
        setBrushPos(null);
        if (isDragging) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
      }}
      onMouseUp={() => {
        if (isPaintingRef.current) handlePaintMouseUp();
        setIsDragging(false);
      }}
      onMouseLeave={() => {
        if (isPaintingRef.current) handlePaintMouseUp();
        setBrushPos(null);
        setIsDragging(false);
      }}
      style={{
        cursor: paintMode !== 'off' && !isSpacePanning
          ? 'none'
          : isDragging ? 'grabbing'
          : (isSpacePanning || originalImage) ? 'grab'
          : 'default',
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
            {/* image-rendering: auto when canvas size ≥ display (downscale or 1:1 = smooth/sharp).
                image-rendering: pixelated when canvas is CSS-upscaled past MAX_RENDER_DIM (nearest-neighbor). */}
            <canvas ref={canvasRef} style={{ imageRendering: isPixelated ? 'pixelated' : 'auto' }} />
            <canvas
              ref={paintOverlayRef}
              width={canvasDims.w || 1}
              height={canvasDims.h || 1}
              style={{
                position: 'absolute', top: 0, left: 0,
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
                {artworkBounds && (
                  <rect
                    x={artworkBounds.x} y={artworkBounds.y}
                    width={artworkBounds.w} height={artworkBounds.h}
                    fill="none" stroke="var(--accent)"
                    strokeWidth={1.5} strokeDasharray="6 4" opacity={0.5}
                  />
                )}
                {showRegistrationMarks && separationMode !== 'vector' && regMarkData.positions.map((pos, i) => (
                  <RegMark key={i} x={pos.x} y={pos.y} size={regMarkData.markSize} />
                ))}
              </svg>
            )}

            {/* Vector SVG overlay — absolutely positioned over artworkBounds, inherits pan/zoom */}
            {separationMode === 'vector' && vectorSvg && artworkBounds && (
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(vectorSvg)}`}
                style={{
                  position: 'absolute',
                  top: artworkBounds.y,
                  left: artworkBounds.x,
                  width: artworkBounds.w,
                  height: artworkBounds.h,
                  pointerEvents: 'none',
                  display: 'block',
                  imageRendering: 'auto',
                }}
              />
            )}
          </div>

          {isProcessing && (
            <div className="processing-overlay">
              <div className="processing-label">Processing…</div>
            </div>
          )}

          {/* Brush cursor — follows mouse, sized to match brush radius in display pixels */}
          {paintMode !== 'off' && brushPos && !isSpacePanning && (
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
                fill={paintMode === 'paint' ? 'rgba(80,200,80,0.08)' : 'rgba(200,60,60,0.08)'}
                stroke={paintMode === 'paint' ? '#50c878' : '#e05050'}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <line
                x1={brushSize * cssScale} y1={brushSize * cssScale - 5}
                x2={brushSize * cssScale} y2={brushSize * cssScale + 5}
                stroke={paintMode === 'paint' ? '#50c878' : '#e05050'}
                strokeWidth={1}
              />
              <line
                x1={brushSize * cssScale - 5} y1={brushSize * cssScale}
                x2={brushSize * cssScale + 5} y2={brushSize * cssScale}
                stroke={paintMode === 'paint' ? '#50c878' : '#e05050'}
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
                  onClick={() => setSplitView((v) => !v)}
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
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
        </>
      )}
    </div>
  );
}
