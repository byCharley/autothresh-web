import { useState, useRef, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { renderComposite } from '../engine/imageProcessor';
import { MOCKUPS } from '../config/mockups';

type BlendMode = 'auto' | 'multiply' | 'screen' | 'overlay' | 'normal';

function hexLuminance(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function closestVariantName(variants: { name: string; hex: string }[], targetHex: string): string {
  const tr = parseInt(targetHex.slice(1, 3), 16);
  const tg = parseInt(targetHex.slice(3, 5), 16);
  const tb = parseInt(targetHex.slice(5, 7), 16);
  let best = variants[0]?.name ?? '';
  let bestDist = Infinity;
  for (const v of variants) {
    const h = v.hex.replace('#', '');
    const dr = parseInt(h.slice(0, 2), 16) - tr;
    const dg = parseInt(h.slice(2, 4), 16) - tg;
    const db = parseInt(h.slice(4, 6), 16) - tb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; best = v.name; }
  }
  return best;
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)',
  letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--text-dim)', marginBottom: 8,
};

export function MockupPreview({ onClose }: { onClose: () => void }) {
  const { processedLayers, processedLayerDims, ditherComposite, separationMode, canvasColor } = useStore();

  const [mockupId, setMockupId]     = useState(MOCKUPS[0]?.id ?? '');
  const [colorName, setColorName]   = useState(() =>
    closestVariantName(MOCKUPS[0]?.variants ?? [], canvasColor)
  );
  const [artPos, setArtPos]         = useState({ x: 50, y: 38 });
  const [artScale, setArtScale]     = useState(55);
  const [blendMode, setBlendMode]   = useState<BlendMode>('auto');
  const [isDragging, setIsDragging] = useState(false);
  const [search, setSearch]         = useState('');
  const [galleryOpen, setGalleryOpen] = useState(true);
  const [showColors, setShowColors]   = useState(true);

  const dragRef      = useRef({ active: false, mx: 0, my: 0, ax: 0, ay: 0 });
  const contentRef   = useRef<HTMLDivElement>(null);
  const artCanvasRef = useRef<HTMLCanvasElement>(null);
  const pointersRef  = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistRef = useRef<number | null>(null);

  const mockup  = MOCKUPS.find(m => m.id === mockupId) ?? MOCKUPS[0];
  const variant = mockup?.variants.find(v => v.name === colorName) ?? mockup?.variants[0];

  // Preload every variant image so switching is instant after first open
  useEffect(() => {
    MOCKUPS.forEach(m => m.variants.forEach(v => {
      const img = new Image();
      img.src = v.file;
    }));
  }, []);

  // When switching mockups, pick the variant closest to the user's canvas color
  useEffect(() => {
    if (mockup) setColorName(closestVariantName(mockup.variants, canvasColor));
  }, [mockupId]);

  const isDark = hexLuminance(variant?.hex ?? '#FFFFFF') < 0.45;
  const effectiveBlend = blendMode === 'auto' ? (isDark ? 'screen' : 'multiply') : blendMode;

  // ── Render artwork composite ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = artCanvasRef.current;
    if (!canvas) return;
    if (ditherComposite) {
      const { data, w, h } = ditherComposite;
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.putImageData(data, 0, 0);
      return;
    }
    if (!processedLayers.length || !processedLayerDims) return;
    const { w, h } = processedLayerDims;
    canvas.width = w; canvas.height = h;
    const composite = renderComposite(processedLayers, w, h, true, '#ffffff', false);
    canvas.getContext('2d')!.putImageData(composite, 0, 0);
  }, [processedLayers, processedLayerDims, ditherComposite, separationMode]);

  // ── Filtered gallery list ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return MOCKUPS;
    return MOCKUPS.filter(m =>
      m.brand.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.view.toLowerCase().includes(q)
    );
  }, [search]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof MOCKUPS>();
    for (const m of filtered) {
      const key = `${m.brand} ${m.model}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return [...map.entries()];
  }, [filtered]);

  // ── Pointer handlers (artwork drag + pinch-to-scale) ─────────────────────
  const onPreviewPointerDown = (e: React.PointerEvent) => {
    if (!hasArt) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      pinchDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      dragRef.current.active = false;
      setIsDragging(false);
      return;
    }
    dragRef.current = { active: true, mx: e.clientX, my: e.clientY, ax: artPos.x, ay: artPos.y };
    setIsDragging(true);
  };
  const onPreviewPointerMove = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchDistRef.current !== null) {
      const pts = [...pointersRef.current.values()];
      const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const factor = newDist / pinchDistRef.current;
      pinchDistRef.current = newDist;
      setArtScale(prev => Math.min(100, Math.max(5, Math.round(prev * factor))));
      return;
    }
    const d = dragRef.current;
    if (!d.active || !contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    setArtPos({ x: d.ax + ((e.clientX - d.mx) / rect.width) * 100, y: d.ay + ((e.clientY - d.my) / rect.height) * 100 });
  };
  const onPreviewPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    pinchDistRef.current = null;
    dragRef.current.active = false;
    setIsDragging(false);
  };

  // ── Download ──────────────────────────────────────────────────────────────
  const downloadPreview = () => {
    const artCanvas = artCanvasRef.current;
    if (!artCanvas || !variant) return;
    const img = new Image();
    img.onload = () => {
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const displayEl = contentRef.current?.querySelector('img') as HTMLImageElement | null;
      const renderedW = displayEl?.offsetWidth ?? natW;
      const renderedH = displayEl?.offsetHeight ?? natH;
      const out = document.createElement('canvas');
      out.width = natW; out.height = natH;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(img, 0, 0, natW, natH);
      const scaleX = natW / renderedW, scaleY = natH / renderedH;
      const artRW = (artScale / 100) * renderedW;
      const artRH = artRW * (artCanvas.height / artCanvas.width);
      ctx.globalCompositeOperation = (effectiveBlend === 'normal' ? 'source-over' : effectiveBlend) as GlobalCompositeOperation;
      ctx.drawImage(artCanvas,
        ((artPos.x / 100) * renderedW - artRW / 2) * scaleX,
        ((artPos.y / 100) * renderedH - artRH / 2) * scaleY,
        artRW * scaleX, artRH * scaleY,
      );
      out.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mockup-${mockup.brand}-${mockup.model}-${mockup.view}-${variant.name}.png`
          .toLowerCase().replace(/\s+/g, '-');
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = variant.file;
  };

  const hasArt = (separationMode === 'palette' || separationMode === 'cmyk-pro')
    ? !!ditherComposite
    : processedLayers.length > 0 && !!processedLayerDims;

  const blendLabel = (m: BlendMode) => m === 'auto' ? `Auto (${isDark ? 'Screen' : 'Multiply'})` : m.charAt(0).toUpperCase() + m.slice(1);

  const isMobile = window.innerWidth < 768;

  // ── Mobile layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          height: 52, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', flex: 1, marginRight: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Mockup Preview
            </span>
            {mockup && variant && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mockup.brand} {mockup.model} · {mockup.view} · {variant.name}
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Preview area — fills all remaining space */}
        <div
          style={{
            flex: 1, minHeight: 0, position: 'relative',
            background: '#111', overflow: 'hidden',
            cursor: !hasArt ? 'default' : isDragging ? 'grabbing' : 'grab',
            userSelect: 'none', touchAction: 'none',
          }}
          onPointerDown={onPreviewPointerDown}
          onPointerMove={onPreviewPointerMove}
          onPointerUp={onPreviewPointerUp}
          onPointerCancel={onPreviewPointerUp}
        >
          {/* Centered mockup content */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {!hasArt ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                {variant && (
                  <img
                    src={variant.file}
                    alt={mockup?.name}
                    style={{ maxHeight: '100%', maxWidth: '100%', opacity: 0.5, pointerEvents: 'none' }}
                  />
                )}
                <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#555', marginTop: 10 }}>
                  Load artwork first
                </div>
              </div>
            ) : (
              <div ref={contentRef} style={{ position: 'relative', lineHeight: 0, flexShrink: 0 }}>
                <img
                  src={variant?.file}
                  style={{
                    display: 'block', width: 'auto', height: 'auto',
                    maxWidth: '100vw', maxHeight: '100%',
                    pointerEvents: 'none',
                    transition: 'opacity 0.15s ease',
                  }}
                  alt={mockup?.name}
                  draggable={false}
                />
                <canvas
                  ref={artCanvasRef}
                  style={{
                    position: 'absolute',
                    left: `${artPos.x}%`, top: `${artPos.y}%`,
                    width: `${artScale}%`, height: 'auto',
                    transform: 'translate(-50%, -50%)',
                    mixBlendMode: effectiveBlend as React.CSSProperties['mixBlendMode'],
                    pointerEvents: 'none',
                  }}
                />
              </div>
            )}
          </div>

          {/* Color toggle button — top-right of preview */}
          {mockup && mockup.variants.length > 1 && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setShowColors(v => !v)}
              title={showColors ? 'Hide colors' : 'Show colors'}
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 5,
                width: 30, height: 30,
                background: showColors ? 'var(--accent)' : 'rgba(18,18,18,0.85)',
                border: `1px solid ${showColors ? 'var(--accent)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: 4, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
              } as React.CSSProperties}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={showColors ? '#000' : 'var(--text-muted)'} strokeWidth="2">
                <circle cx="12" cy="12" r="3"/><circle cx="6.5" cy="7" r="2.5"/><circle cx="17.5" cy="7" r="2.5"/>
                <circle cx="6.5" cy="17" r="2.5"/><circle cx="17.5" cy="17" r="2.5"/>
              </svg>
            </button>
          )}

          {/* Floating vertical color swatches */}
          {showColors && mockup && mockup.variants.length > 1 && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', right: 8, top: 46, zIndex: 4,
                display: 'flex', flexDirection: 'column', gap: 6,
                background: 'rgba(12,12,12,0.88)',
                padding: '8px 6px', borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.1)',
                maxHeight: 'calc(100% - 62px)', overflowY: 'auto',
                scrollbarWidth: 'none',
              } as React.CSSProperties}
            >
              {mockup.variants.map((v) => {
                const active = colorName === v.name;
                return (
                  <button
                    key={v.name}
                    title={v.name}
                    onClick={() => setColorName(v.name)}
                    style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: v.hex,
                      border: active ? '2.5px solid var(--accent)' : '1.5px solid rgba(255,255,255,0.2)',
                      cursor: 'pointer', padding: 0, position: 'relative',
                      boxShadow: active ? '0 0 0 1px var(--accent)' : '0 1px 3px rgba(0,0,0,0.6)',
                      WebkitTapHighlightColor: 'transparent',
                    } as React.CSSProperties}
                  >
                    {active && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                        stroke={hexLuminance(v.hex) < 0.5 ? '#fff' : '#000'}
                        strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div style={{ flexShrink: 0, background: 'var(--surface)', borderTop: '2px solid var(--accent)' }}>

          {/* Garment gallery — collapsible */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setGalleryOpen(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px',
              background: 'none', border: 'none',
              borderBottom: galleryOpen ? '1px solid var(--border)' : 'none',
              cursor: 'pointer', textAlign: 'left',
              WebkitTapHighlightColor: 'transparent',
            } as React.CSSProperties}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', flexShrink: 0 }}>
                Garment
              </span>
              {mockup && (
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mockup.brand} {mockup.model} · {mockup.view}
                </span>
              )}
            </div>
            <svg
              width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ color: 'var(--text-dim)', transform: galleryOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', flexShrink: 0, marginLeft: 6 }}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>

          {galleryOpen && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 14px 12px', scrollbarWidth: 'none' } as React.CSSProperties}>
              {groups.map(([, items]) =>
                items.map((m) => {
                  const active = m.id === mockupId;
                  const thumb = m.variants.find(v => v.name === colorName) ?? m.variants[0];
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMockupId(m.id)}
                      style={{
                        flexShrink: 0, width: 68,
                        background: active ? 'color-mix(in srgb, var(--accent) 10%, var(--surface-2))' : 'var(--surface-2)',
                        border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        borderRadius: 2, cursor: 'pointer', padding: 0, overflow: 'hidden',
                        WebkitTapHighlightColor: 'transparent',
                      } as React.CSSProperties}
                    >
                      <div style={{ background: '#f0f0f0', height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        <img src={thumb.file} alt={`${m.brand} ${m.view}`} style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
                      </div>
                      <div style={{ padding: '3px 4px 4px', borderTop: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
                        <div style={{ fontSize: 7, fontFamily: 'var(--font-mono)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: active ? 'var(--accent)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.view}
                        </div>
                        <div style={{ fontSize: 6, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                          {m.model}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Scale + Download */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', paddingBottom: 'max(16px, calc(env(safe-area-inset-bottom, 0px) + 12px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', flexShrink: 0 }}>Scale</span>
              <input type="range" min={5} max={100} value={artScale} style={{ flex: 1 }}
                onChange={(e) => setArtScale(Number(e.target.value))} />
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{artScale}%</span>
            </div>
            <button
              className="btn btn-primary"
              onClick={downloadPreview}
              disabled={!hasArt}
              style={{ width: '100%', height: 40, opacity: hasArt ? 1 : 0.4, color: '#1a1a1a', fontSize: 12, fontFamily: 'var(--font-mono)', gap: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Save Mockup PNG
            </button>
          </div>

        </div>
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '98vw', height: '94vh', display: 'flex', flexDirection: 'column', zIndex: 51 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              Mockup Preview
            </span>
            {mockup && (
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                {mockup.brand} {mockup.model} · {mockup.view} · {variant?.name}
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* ── Left: Gallery ── */}
          <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search garments..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%', height: 30, paddingLeft: 28, paddingRight: 8,
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
              {groups.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', textAlign: 'center', paddingTop: 24 }}>
                  No garments found
                </div>
              )}
              {groups.map(([groupKey, items]) => (
                <div key={groupKey} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>
                    {items[0].brand} · {items[0].model}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-sans)', color: 'var(--text-muted)', marginBottom: 8, marginTop: -4 }}>
                    {items[0].name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {items.map((m) => {
                      const active = m.id === mockupId;
                      const thumb = m.variants.find(v => v.name === colorName) ?? m.variants[0];
                      return (
                        <button
                          key={m.id}
                          onClick={() => setMockupId(m.id)}
                          style={{
                            background: active ? 'var(--accent-dim, rgba(255,200,0,0.08))' : 'var(--surface-2)',
                            border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 3, cursor: 'pointer', padding: 0, overflow: 'hidden',
                            transition: 'border-color 0.15s',
                          }}
                        >
                          <div style={{ background: '#f0f0f0', height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            <img
                              src={thumb.file}
                              alt={`${m.brand} ${m.model} ${m.view}`}
                              style={{ height: '100%', width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }}
                            />
                          </div>
                          <div style={{ padding: '5px 6px', borderTop: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-dim, rgba(255,200,0,0.06))' : 'transparent' }}>
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: active ? 'var(--accent)' : 'var(--text)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                              {m.view}
                            </div>
                            <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 1 }}>
                              {m.category}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div style={{ marginTop: 8, padding: '10px 8px', borderTop: '1px solid var(--border)', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.04em', textAlign: 'center' }}>
                More garments coming soon
              </div>
            </div>
          </div>

          {/* ── Center: Preview ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <div
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#111', overflow: 'hidden', position: 'relative',
                cursor: !hasArt ? 'default' : isDragging ? 'grabbing' : 'grab',
                userSelect: 'none', minHeight: 0, padding: 16, touchAction: 'none',
              }}
              onPointerDown={onPreviewPointerDown}
              onPointerMove={onPreviewPointerMove}
              onPointerUp={onPreviewPointerUp}
              onPointerCancel={onPreviewPointerUp}
            >
              {!hasArt ? (
                <div style={{ textAlign: 'center' }}>
                  {variant && (
                    <img
                      src={variant.file}
                      alt={mockup?.name}
                      style={{ maxHeight: 'calc(94vh - 44px - 32px - 32px)', maxWidth: '100%', opacity: 0.5, pointerEvents: 'none' }}
                    />
                  )}
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#555', marginTop: 12 }}>
                    Load artwork to preview on mockup
                  </div>
                </div>
              ) : (
                <div ref={contentRef} style={{ position: 'relative', lineHeight: 0, flexShrink: 0 }}>
                  <img
                    src={variant?.file}
                    style={{
                      display: 'block', height: 'auto', width: 'auto',
                      maxHeight: 'calc(94vh - 44px - 32px - 32px)',
                      maxWidth: 'calc(98vw - 260px - 220px - 32px)',
                      pointerEvents: 'none',
                      transition: 'opacity 0.15s ease',
                    }}
                    alt={mockup?.name}
                    draggable={false}
                  />
                  <canvas
                    ref={artCanvasRef}
                    style={{
                      position: 'absolute',
                      left: `${artPos.x}%`, top: `${artPos.y}%`,
                      width: `${artScale}%`, height: 'auto',
                      transform: 'translate(-50%, -50%)',
                      mixBlendMode: effectiveBlend as React.CSSProperties['mixBlendMode'],
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid var(--border)', gap: 6, flexShrink: 0 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
              </svg>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                Drag artwork to reposition — resize with the scale slider
              </span>
            </div>
          </div>

          {/* ── Right: Controls ── */}
          <div style={{ width: 220, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
            <div style={{ padding: '14px 14px 0' }}>

              {/* Color picker */}
              <div style={{ marginBottom: 18 }}>
                <div style={SECTION_LABEL}>Garment Color</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {mockup?.variants.map((v) => {
                    const active = colorName === v.name;
                    return (
                      <button
                        key={v.name}
                        title={v.name}
                        onClick={() => setColorName(v.name)}
                        style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: v.hex,
                          border: active ? '2.5px solid var(--accent)' : '1.5px solid var(--border-2)',
                          cursor: 'pointer', padding: 0,
                          boxShadow: active ? '0 0 0 1px var(--accent)' : 'none',
                          transition: 'box-shadow 0.12s, border-color 0.12s',
                          position: 'relative',
                        }}
                      >
                        {active && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                            stroke={hexLuminance(v.hex) < 0.5 ? '#fff' : '#000'}
                            strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                            style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
                {variant && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: variant.hex, border: '1px solid var(--border-2)', flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{variant.name}</span>
                  </div>
                )}
              </div>

              {/* Scale */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ ...SECTION_LABEL, marginBottom: 0 }}>Scale</span>
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{artScale}%</span>
                </div>
                <input type="range" min={5} max={100} value={artScale} style={{ width: '100%' }}
                  onChange={(e) => setArtScale(Number(e.target.value))} />
              </div>

              {/* Blend mode */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ ...SECTION_LABEL, marginBottom: 6 }}>Blend Mode</div>
                <select className="at-select" value={blendMode} onChange={(e) => setBlendMode(e.target.value as BlendMode)}>
                  {(['auto', 'multiply', 'screen', 'overlay', 'normal'] as BlendMode[]).map((m) => (
                    <option key={m} value={m}>{blendLabel(m)}</option>
                  ))}
                </select>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 5, lineHeight: 1.6 }}>
                  {effectiveBlend === 'screen'   && 'Light ink on dark fabric'}
                  {effectiveBlend === 'multiply' && 'Ink blends with fabric texture'}
                  {effectiveBlend === 'overlay'  && 'High-contrast blend'}
                  {effectiveBlend === 'normal'   && 'Flat ink, no blend'}
                </div>
              </div>
            </div>

            {/* Download */}
            <div style={{ marginTop: 'auto', padding: '14px', borderTop: '1px solid var(--border)' }}>
              <button
                className="btn btn-primary"
                onClick={downloadPreview}
                disabled={!hasArt}
                style={{ width: '100%', height: 32, opacity: hasArt ? 1 : 0.4, color: '#1a1a1a', fontSize: 11, fontFamily: 'var(--font-mono)', gap: 6 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Save PNG
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
