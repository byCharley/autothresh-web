import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { renderComposite } from '../engine/imageProcessor';
import { MOCKUPS } from '../config/mockups';

type BlendMode = 'auto' | 'multiply' | 'screen' | 'overlay' | 'normal';

export function MockupPreview({ onClose }: { onClose: () => void }) {
  const { processedLayers, processedLayerDims, ditherComposite, separationMode } = useStore();

  const [mockupId, setMockupId]   = useState(MOCKUPS[0]?.id ?? '');
  const [artPos, setArtPos]       = useState({ x: 50, y: 38 });
  const [artScale, setArtScale]   = useState(55);
  const [blendMode, setBlendMode] = useState<BlendMode>('auto');
  const [isDragging, setIsDragging] = useState(false);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const availableMockups = MOCKUPS.filter(m => !imgErrors[m.id]);

  const dragRef     = useRef({ active: false, mx: 0, my: 0, ax: 0, ay: 0 });
  const contentRef  = useRef<HTMLDivElement>(null);
  const artCanvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef      = useRef<HTMLImageElement>(null);

  const mockup = availableMockups.find(m => m.id === mockupId) ?? availableMockups[0] ?? MOCKUPS[0];
  const effectiveBlend: string = blendMode === 'auto'
    ? (mockup.isDark ? 'screen' : 'multiply')
    : blendMode;

  useEffect(() => {
    const canvas = artCanvasRef.current;
    if (!canvas) return;

    if (separationMode === 'palette' && ditherComposite) {
      // Use the final rendered composite (includes color mode blend, bg removal, etc.)
      const { data, w, h } = ditherComposite;
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d')!.putImageData(data, 0, 0);
      return;
    }

    if (!processedLayers.length || !processedLayerDims) return;
    const { w, h } = processedLayerDims;
    canvas.width  = w;
    canvas.height = h;
    const composite = renderComposite(processedLayers, w, h, true, '#ffffff', false);
    canvas.getContext('2d')!.putImageData(composite, 0, 0);
  }, [processedLayers, processedLayerDims, ditherComposite, separationMode]);

  const onPreviewMouseDown = (e: React.MouseEvent) => {
    if (!hasArt) return;
    e.preventDefault();
    dragRef.current = { active: true, mx: e.clientX, my: e.clientY, ax: artPos.x, ay: artPos.y };
    setIsDragging(true);
  };

  const onPreviewMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d.active || !contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    const dx = ((e.clientX - d.mx) / rect.width)  * 100;
    const dy = ((e.clientY - d.my) / rect.height) * 100;
    setArtPos({ x: d.ax + dx, y: d.ay + dy });
  };

  const onPreviewMouseUp = () => {
    dragRef.current.active = false;
    setIsDragging(false);
  };

  const downloadPreview = () => {
    const imgEl    = imgRef.current;
    const artCanvas = artCanvasRef.current;
    if (!imgEl || !artCanvas || !imgEl.complete || imgEl.naturalWidth === 0) return;

    const natW = imgEl.naturalWidth;
    const natH = imgEl.naturalHeight;
    const renderedW = imgEl.offsetWidth;
    const renderedH = imgEl.offsetHeight;
    if (!renderedW || !renderedH) return;

    const out = document.createElement('canvas');
    out.width  = natW;
    out.height = natH;
    const ctx = out.getContext('2d')!;

    // Draw mockup
    ctx.drawImage(imgEl, 0, 0, natW, natH);

    // Map artwork position/size from rendered → natural image coordinates
    const scaleX      = natW / renderedW;
    const scaleY      = natH / renderedH;
    const artRW       = (artScale / 100) * renderedW;
    const artAspect   = artCanvas.height / artCanvas.width;
    const artRH       = artRW * artAspect;
    const artNatX     = ((artPos.x / 100) * renderedW - artRW / 2) * scaleX;
    const artNatY     = ((artPos.y / 100) * renderedH - artRH / 2) * scaleY;
    const artNatW     = artRW * scaleX;
    const artNatH     = artRH * scaleY;

    ctx.globalCompositeOperation = (effectiveBlend === 'normal' ? 'source-over' : effectiveBlend) as GlobalCompositeOperation;
    ctx.drawImage(artCanvas, artNatX, artNatY, artNatW, artNatH);

    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `mockup-${mockup.name.toLowerCase().replace(/\s+/g, '-')}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const hasArt = separationMode === 'palette'
    ? !!ditherComposite
    : processedLayers.length > 0 && !!processedLayerDims;

  const blendLabel = (m: BlendMode) => {
    if (m === 'auto') return `Auto (${mockup.isDark ? 'Screen' : 'Multiply'})`;
    return m.charAt(0).toUpperCase() + m.slice(1);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          width: '98vw', height: '94vh',
          display: 'flex', flexDirection: 'column', zIndex: 51,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            Mockup Preview
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Mockup area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

            {/* Drag / preview region */}
            <div
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#0d0d0d', overflow: 'hidden', position: 'relative',
                cursor: !hasArt ? 'default' : isDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
                minHeight: 0,
                padding: 12,
              }}
              onMouseDown={onPreviewMouseDown}
              onMouseMove={onPreviewMouseMove}
              onMouseUp={onPreviewMouseUp}
              onMouseLeave={onPreviewMouseUp}
            >
              {!hasArt ? (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#444' }}>
                  Load artwork to preview on mockup
                </span>
              ) : (
                // contentRef must wrap the image exactly so % positions map to the shirt
                <div ref={contentRef} style={{ position: 'relative', lineHeight: 0, flexShrink: 0 }}>
                  <img
                    ref={imgRef}
                    key={mockup.id}
                    src={mockup.file}
                    // Both axes constrained so the full shirt (including sleeves) is always visible
                    style={{
                      display: 'block',
                      height: 'auto',
                      width: 'auto',
                      maxHeight: 'calc(94vh - 44px - 32px - 24px)',
                      maxWidth: 'calc(98vw - 260px - 24px)',
                      pointerEvents: 'none',
                    }}
                    alt={mockup.name}
                    onError={() => setImgErrors((prev) => ({ ...prev, [mockup.id]: true }))}
                    draggable={false}
                  />
                  <canvas
                    ref={artCanvasRef}
                    style={{
                      position: 'absolute',
                      left: `${artPos.x}%`,
                      top: `${artPos.y}%`,
                      width: `${artScale}%`,
                      height: 'auto',
                      transform: 'translate(-50%, -50%)',
                      mixBlendMode: effectiveBlend as React.CSSProperties['mixBlendMode'],
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Tooltip bar */}
            <div style={{
              height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderTop: '1px solid var(--border)', gap: 6, flexShrink: 0,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
              </svg>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.04em' }}>
                Click and drag your artwork anywhere — resize with the scale slider
              </span>
            </div>
          </div>

          {/* Right: controls */}
          <div style={{ width: 260, borderLeft: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 20, flexShrink: 0, overflowY: 'auto' }}>

            {/* Garment selector */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Garment
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {availableMockups.map((m) => {
                  const active = m.id === mockup?.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMockupId(m.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px', background: 'none', border: 'none',
                        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                        cursor: 'pointer',
                        color: active ? 'var(--accent)' : 'var(--text)',
                        backgroundColor: active ? 'var(--accent-dim)' : 'transparent',
                        textAlign: 'left', width: '100%',
                      }}
                    >
                      <div style={{ width: 16, height: 16, flexShrink: 0, borderRadius: 2, background: m.color, border: '1px solid var(--border-2)' }} />
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{m.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scale */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Scale</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{artScale}%</span>
              </div>
              <input type="range" min={5} max={100} value={artScale} style={{ width: '100%' }}
                onChange={(e) => setArtScale(Number(e.target.value))} />
            </div>

            {/* Blend mode */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                Blend Mode
              </div>
              <select className="at-select" value={blendMode} onChange={(e) => setBlendMode(e.target.value as BlendMode)}>
                {(['auto', 'multiply', 'screen', 'overlay', 'normal'] as BlendMode[]).map((m) => (
                  <option key={m} value={m}>{blendLabel(m)}</option>
                ))}
              </select>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.6 }}>
                {effectiveBlend === 'screen'   && 'Light ink on dark fabric'}
                {effectiveBlend === 'multiply' && 'Ink blends with fabric texture'}
                {effectiveBlend === 'overlay'  && 'High-contrast blend'}
                {effectiveBlend === 'normal'   && 'Flat ink, no blend'}
              </div>
            </div>

            {/* Download */}
            <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
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
