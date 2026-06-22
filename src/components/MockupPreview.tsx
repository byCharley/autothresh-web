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

  // Only list mockups that haven't errored — recalculated whenever imgErrors changes
  const availableMockups = MOCKUPS.filter(m => !imgErrors[m.id]);

  // Use refs for drag math so the mousemove handler never captures stale state
  const dragRef    = useRef({ active: false, mx: 0, my: 0, ax: 0, ay: 0 });
  const contentRef = useRef<HTMLDivElement>(null); // wraps img or placeholder
  const artCanvasRef = useRef<HTMLCanvasElement>(null);

  // If the selected mockup errored, fall back to first available
  const mockup = availableMockups.find(m => m.id === mockupId) ?? availableMockups[0] ?? MOCKUPS[0];
  const effectiveBlend: string = blendMode === 'auto'
    ? (mockup.isDark ? 'screen' : 'multiply')
    : blendMode;

  // Re-render composite when processed layers change
  useEffect(() => {
    const canvas = artCanvasRef.current;
    if (!canvas || !processedLayers.length || !processedLayerDims) return;
    const { w, h } = processedLayerDims;
    canvas.width  = w;
    canvas.height = h;
    const composite = renderComposite(processedLayers, w, h, true, '#ffffff', false);
    canvas.getContext('2d')!.putImageData(composite, 0, 0);
  }, [processedLayers, processedLayerDims]);

  // ── Drag handlers (attached to the whole preview area) ─────────────────────

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
    // No hard bounds — let artwork move anywhere (pocket, sleeve, back-pocket, etc.)
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
        {/* ── Header ─────────────────────────────────────────────────────────── */}
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

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Left: mockup selector */}
          <div style={{ width: 160, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '8px 0', flexShrink: 0 }}>
            <div style={{ padding: '4px 12px 8px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Garment
            </div>
            {availableMockups.map((m) => {
              const active = m.id === mockup?.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMockupId(m.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', background: 'none', border: 'none',
                    borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    cursor: 'pointer',
                    color: active ? 'var(--accent)' : 'var(--text)',
                    backgroundColor: active ? 'var(--accent-dim)' : 'transparent',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 2, background: m.color, border: '1px solid var(--border-2)' }} />
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>{m.name}</span>
                </button>
              );
            })}
          </div>

          {/* Center: preview — drag from anywhere here */}
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
                    maxHeight: 'calc(88vh - 44px)',
                    maxWidth: 'calc(92vw - 160px - 200px)',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                  }}
                  alt={mockup.name}
                  onError={() => setImgErrors((prev) => ({ ...prev, [mockup.id]: true }))}
                  draggable={false}
                />

                {/* Artwork canvas — positioned over mockup, blended */}
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
                    pointerEvents: 'none', // outer div handles drag
                  }}
                />
              </div>
            )}
          </div>

          {/* Right: controls */}
          <div style={{ width: 200, borderLeft: '1px solid var(--border)', padding: 14, display: 'flex', flexDirection: 'column', gap: 18, flexShrink: 0, overflowY: 'auto' }}>

            {/* Scale */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Scale</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{artScale}%</span>
              </div>
              <input type="range" min={5} max={100} value={artScale} style={{ width: '100%' }}
                onChange={(e) => setArtScale(Number(e.target.value))} />
            </div>

            {/* Blend mode */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Blend Mode
              </div>
              <select className="at-select" value={blendMode} onChange={(e) => setBlendMode(e.target.value as BlendMode)}>
                {(['auto', 'multiply', 'screen', 'overlay', 'normal'] as BlendMode[]).map((m) => (
                  <option key={m} value={m}>{blendLabel(m)}</option>
                ))}
              </select>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
                {effectiveBlend === 'screen'   && 'Light ink on dark fabric'}
                {effectiveBlend === 'multiply' && 'Ink blends with fabric texture'}
                {effectiveBlend === 'overlay'  && 'High-contrast blend'}
                {effectiveBlend === 'normal'   && 'Flat ink, no blend'}
              </div>
            </div>

            {/* Pocket presets */}
            <div>
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Presets
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button className="btn btn-ghost" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', height: 26, justifyContent: 'flex-start', paddingLeft: 8 }}
                  onClick={() => { setArtPos({ x: 50, y: 38 }); setArtScale(55); }}>
                  Full Front
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', height: 26, justifyContent: 'flex-start', paddingLeft: 8 }}
                  onClick={() => { setArtPos({ x: 27, y: 28 }); setArtScale(18); }}>
                  Left Chest
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', height: 26, justifyContent: 'flex-start', paddingLeft: 8 }}
                  onClick={() => { setArtPos({ x: 50, y: 22 }); setArtScale(28); }}>
                  Center Chest
                </button>
                <button className="btn btn-ghost" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', height: 26, justifyContent: 'flex-start', paddingLeft: 8 }}
                  onClick={() => { setArtPos({ x: 50, y: 65 }); setArtScale(55); }}>
                  Full Back
                </button>
              </div>
            </div>

            {/* Tips */}
            <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.7 }}>
                Click anywhere on the<br />
                mockup and drag to<br />
                reposition artwork.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
