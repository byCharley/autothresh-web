import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { renderComposite } from '../engine/imageProcessor';
import { MOCKUPS } from '../config/mockups';

type BlendMode = 'auto' | 'multiply' | 'screen' | 'overlay' | 'normal';

export function MockupPreview({ onClose }: { onClose: () => void }) {
  const { processedLayers, processedLayerDims } = useStore();

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

  const mockup = availableMockups.find(m => m.id === mockupId) ?? availableMockups[0] ?? MOCKUPS[0];
  const effectiveBlend: string = blendMode === 'auto'
    ? (mockup.isDark ? 'screen' : 'multiply')
    : blendMode;

  useEffect(() => {
    const canvas = artCanvasRef.current;
    if (!canvas || !processedLayers.length || !processedLayerDims) return;
    const { w, h } = processedLayerDims;
    canvas.width  = w;
    canvas.height = h;
    const composite = renderComposite(processedLayers, w, h, true, '#ffffff', false);
    canvas.getContext('2d')!.putImageData(composite, 0, 0);
  }, [processedLayers, processedLayerDims]);

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

  const hasArt = processedLayers.length > 0 && !!processedLayerDims;

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
          width: '92vw', maxWidth: 1160, height: '88vh',
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
            <div
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#0d0d0d', overflow: 'hidden', position: 'relative',
                cursor: !hasArt ? 'default' : isDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
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
                <div ref={contentRef} style={{ position: 'relative', lineHeight: 0, maxHeight: '100%' }}>
                  <img
                    key={mockup.id}
                    src={mockup.file}
                    style={{
                      display: 'block',
                      maxHeight: 'calc(88vh - 44px - 32px)',
                      maxWidth: 'calc(92vw - 220px)',
                      objectFit: 'contain',
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

            {/* Tooltip below mockup */}
            <div style={{
              height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderTop: '1px solid var(--border)',
              gap: 6,
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
          <div style={{ width: 220, borderLeft: '1px solid var(--border)', padding: 16, display: 'flex', flexDirection: 'column', gap: 20, flexShrink: 0, overflowY: 'auto' }}>

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

          </div>
        </div>
      </div>
    </div>
  );
}
