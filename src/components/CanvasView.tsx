import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '../store/useStore';
import {
  processImage, renderComposite, scaleImageData, scaleImageDataExact,
  computeBackgroundMask, detectBackgroundColor, hexToRgb,
} from '../engine/imageProcessor';
import type { LayerConfig, PatternConfig } from '../engine/imageProcessor';
import { generateTextureMask } from '../engine/textureGenerator';
import { loadAllTextures } from '../engine/textureLoader';

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
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const containerRef     = useRef<HTMLDivElement>(null);
  const fileInputRef     = useRef<HTMLInputElement>(null);
  const artboardStageRef = useRef<HTMLDivElement>(null);
  const dimTimerRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const {
    originalImage, previewImage, layers, knockoutEnabled,
    globalPattern,
    bgRemovalEnabled, bgTolerance,
    showRegistrationMarks, regMarkPadding,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    canvasColor, showFabricBg,
    imageAdjustments,
    documentDpi, documentWidthIn, documentHeightIn,
    isProcessing, setOriginalImage, setProcessedLayers, setIsProcessing, setCanvasColor,
  } = useStore();

  // Increments when real texture PNGs finish loading so the processing effect reruns.
  const [textureVersion, setTextureVersion] = useState(0);

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

  // Artboard preview (no-image state) driven by ResizeObserver.
  const [artboardSize, setArtboardSize] = useState({ w: 0, h: 0 });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Compute how the document + artwork map to a preview canvas at `dim` max-dim.
   * `dim` defaults to `renderDim` (zoom-aware). Pass MAX_PREVIEW_DIM explicitly
   * for layout calculations that should be zoom-independent (Fit, initial load).
   */
  function computeDocLayout(dim = renderDim) {
    if (!originalImage) return null;
    const ow = originalImage.width, oh = originalImage.height;
    const docPxW = Math.round(documentWidthIn * documentDpi);
    const docPxH = Math.round(documentHeightIn * documentDpi);
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

  // Main processing effect.
  // Runs only when settings change — never on zoom. Zoom is a pure CSS transform.
  // Always processes at MAX_PREVIEW_DIM so the rendered canvas is stable across
  // all zoom levels (same as Photoshop's magnifier: zooming in shows bigger pixels,
  // not a re-render at higher resolution).
  useEffect(() => {
    if (!originalImage) return;
    const tid = setTimeout(() => {
      setIsProcessing(true);
      requestAnimationFrame(() => {
        // Always use the fixed base resolution — never zoom-scaled.
        const layout = computeDocLayout(MAX_PREVIEW_DIM);
        if (!layout) { setIsProcessing(false); return; }
        const { docPrevW, docPrevH, artPrevW, artPrevH, artPrevOffX, artPrevOffY } = layout;

        // Single high-quality scale from original → exact slot size.
        const artScaled    = scaleImageDataExact(originalImage, artPrevW, artPrevH);
        const localBgMask  = bgRemovalEnabled ? computeBackgroundMask(artScaled, bgTolerance) : null;
        const resolved     = resolvePatterns(layers, globalPattern);
        const processed    = processImage(artScaled, resolved, knockoutEnabled, localBgMask, imageAdjustments);

        if (textureEnabled) {
          const texMask = generateTextureMask(artPrevW, artPrevH, textureType, textureIntensity, textureScale, textureWidth, textureSeed);
          for (const layer of processed) {
            for (let i = 0; i < layer.mask.length; i++) {
              if (texMask[i] === 0) layer.mask[i] = 0;
            }
          }
        }

        setProcessedLayers(processed);

        const artComposite = renderComposite(processed, artPrevW, artPrevH, true, '#ffffff', !knockoutEnabled);

        // Build document canvas: fabric bg + artwork at 1:1 (zero scaling = zero blur).
        const docCanvas = document.createElement('canvas');
        docCanvas.width = docPrevW; docCanvas.height = docPrevH;
        const dCtx = docCanvas.getContext('2d')!;
        if (showFabricBg) { dCtx.fillStyle = canvasColor; dCtx.fillRect(0, 0, docPrevW, docPrevH); }

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
          // Always fixed — cssScale = zoom * MAX_PREVIEW_DIM / MAX_PREVIEW_DIM = zoom
          setRenderedAtDim(MAX_PREVIEW_DIM);
          setArtworkBounds({ x: artPrevOffX, y: artPrevOffY, w: artPrevW, h: artPrevH });
        }
        setIsProcessing(false);
      });
    }, 40);
    return () => clearTimeout(tid);
  }, [
    originalImage, layers, knockoutEnabled, globalPattern,
    bgRemovalEnabled, bgTolerance, canvasColor, showFabricBg, imageAdjustments,
    textureEnabled, textureType, textureIntensity, textureScale, textureWidth, textureSeed,
    textureVersion,
    documentWidthIn, documentHeightIn, documentDpi,
    // renderDim intentionally excluded — zoom must never trigger a reprocess
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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!originalImage) return;
    setIsDragging(true);
    // Store anchor as (clientX - current offset) so move can recompute offset = clientX - anchor.
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
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
  const isPixelated = cssScale > 1.02;

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
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => { if (isDragging) setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }}
      onMouseUp={() => setIsDragging(false)}
      onMouseLeave={() => setIsDragging(false)}
      style={{ cursor: isDragging ? 'grabbing' : originalImage ? 'grab' : 'default' }}
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

            {canvasDims.w > 0 && (artworkBounds || showRegistrationMarks) && (
              <svg style={{
                position: 'absolute', overflow: 'visible', top: 0, left: 0,
                width: canvasDims.w, height: canvasDims.h,
                pointerEvents: 'none', color: 'var(--text)',
              }}>
                {artworkBounds && (
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

          {isProcessing && (
            <div className="processing-overlay">
              <div className="processing-label">Processing…</div>
            </div>
          )}

          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)',
            letterSpacing: '0.06em', background: 'var(--surface)',
            padding: '3px 10px', border: '1px solid var(--border)',
            pointerEvents: 'none', textTransform: 'uppercase',
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
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }} />
        </>
      )}
    </div>
  );
}
