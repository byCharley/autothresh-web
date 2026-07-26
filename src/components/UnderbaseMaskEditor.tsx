import { useRef, useLayoutEffect, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';

interface Props {
  onClose: () => void;
}

export default function UnderbaseMaskEditor({ onClose }: Props) {
  const { previewImage, underbasePreviewImage, underbaseMaskData, setUnderbaseMaskData } = useStore(s => ({
    previewImage:           s.previewImage as ImageData | null,
    underbasePreviewImage:  s.underbasePreviewImage,
    underbaseMaskData:      s.underbaseMaskData,
    setUnderbaseMaskData:   s.setUnderbaseMaskData,
  }));

  const artCanvasRef  = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef  = useRef(false);
  const lastPosRef    = useRef<{ x: number; y: number } | null>(null);

  const [brushMode, setBrushMode] = useState<'exclude' | 'include'>('exclude');
  const [brushSize, setBrushSize] = useState(24);
  const [canvasW, setCanvasW]     = useState(0);
  const [canvasH, setCanvasH]     = useState(0);
  const [cursor, setCursor]       = useState<{ x: number; y: number } | null>(null);

  // Draw art + underbase synchronously before first paint
  useLayoutEffect(() => {
    if (!artCanvasRef.current || !maskCanvasRef.current) return;

    const srcImage = underbasePreviewImage ?? previewImage;
    if (!srcImage) return;

    const maxW  = Math.min(window.innerWidth  * 0.86, 880);
    const maxH  = Math.min(window.innerHeight * 0.65, 640);
    const scale = Math.min(maxW / srcImage.width, maxH / srcImage.height, 1);
    const w     = Math.max(1, Math.round(srcImage.width  * scale));
    const h     = Math.max(1, Math.round(srcImage.height * scale));

    const artC   = artCanvasRef.current;
    artC.width   = w;
    artC.height  = h;
    const artCtx = artC.getContext('2d')!;

    // Dark background so the white underbase pops
    artCtx.fillStyle = '#111';
    artCtx.fillRect(0, 0, w, h);

    // Art at reduced opacity for context
    if (previewImage) {
      const artTmp    = document.createElement('canvas');
      artTmp.width    = previewImage.width;
      artTmp.height   = previewImage.height;
      artTmp.getContext('2d')!.putImageData(previewImage, 0, 0);
      artCtx.globalAlpha = 0.35;
      artCtx.drawImage(artTmp, 0, 0, w, h);
      artCtx.globalAlpha = 1;
    }

    // Underbase as solid white on top
    if (underbasePreviewImage) {
      const ubTmp    = document.createElement('canvas');
      ubTmp.width    = underbasePreviewImage.width;
      ubTmp.height   = underbasePreviewImage.height;
      ubTmp.getContext('2d')!.putImageData(underbasePreviewImage, 0, 0);
      artCtx.drawImage(ubTmp, 0, 0, w, h);
    }

    const maskC   = maskCanvasRef.current;
    maskC.width   = w;
    maskC.height  = h;
    maskC.getContext('2d')!.clearRect(0, 0, w, h);

    setCanvasW(w);
    setCanvasH(h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing mask exclusions as red overlay (runs after canvasW is set)
  useEffect(() => {
    if (!underbaseMaskData || !maskCanvasRef.current || canvasW === 0) return;
    const w       = canvasW;
    const h       = canvasH;
    const maskCtx = maskCanvasRef.current.getContext('2d')!;
    const maskImg = new Image();
    maskImg.onload = () => {
      try {
        const tmp2    = document.createElement('canvas');
        tmp2.width    = maskImg.width;
        tmp2.height   = maskImg.height;
        tmp2.getContext('2d')!.drawImage(maskImg, 0, 0);
        const src     = tmp2.getContext('2d')!.getImageData(0, 0, maskImg.width, maskImg.height);
        const out     = new ImageData(w, h);
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const mx  = Math.round(px / Math.max(1, w - 1) * (maskImg.width  - 1));
            const my  = Math.round(py / Math.max(1, h - 1) * (maskImg.height - 1));
            if (src.data[(my * maskImg.width + mx) * 4] < 128) {
              const oi = (py * w + px) * 4;
              out.data[oi] = 220; out.data[oi + 1] = 50; out.data[oi + 2] = 50; out.data[oi + 3] = 185;
            }
          }
        }
        maskCtx.putImageData(out, 0, 0);
      } catch { /* ignore */ }
    };
    maskImg.src = underbaseMaskData;
  }, [canvasW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Painting ─────────────────────────────────────────────────────────────────

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return null;
    const rect   = canvas.getBoundingClientRect();
    const cx     = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const cy     = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (cx == null) return null;
    return {
      x: (cx - rect.left) * (canvas.width  / rect.width),
      y: (cy - rect.top)  * (canvas.height / rect.height),
    };
  }, []);

  const paint = useCallback((pos: { x: number; y: number }, last: { x: number; y: number } | null) => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx    = canvas.getContext('2d')!;
    const r      = brushSize / 2;

    ctx.globalCompositeOperation = brushMode === 'exclude' ? 'source-over' : 'destination-out';
    ctx.fillStyle                = brushMode === 'exclude' ? 'rgba(220,50,50,0.65)' : 'rgba(0,0,0,1)';

    const pts: { x: number; y: number }[] = [];
    if (last) {
      const steps = Math.max(1, Math.ceil(Math.hypot(pos.x - last.x, pos.y - last.y) / Math.max(1, r / 3)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push({ x: last.x + (pos.x - last.x) * t, y: last.y + (pos.y - last.y) * t });
      }
    } else {
      pts.push(pos);
    }
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [brushMode, brushSize]);

  const onDown  = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); e.stopPropagation();
    const pos = getPos(e);
    if (!pos) return;
    isDrawingRef.current = true;
    lastPosRef.current   = pos;
    paint(pos, null);
  }, [getPos, paint]);

  const onMove  = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const pos = getPos(e);
    if (!pos) return;
    setCursor(pos);
    if (!isDrawingRef.current) return;
    paint(pos, lastPosRef.current);
    lastPosRef.current = pos;
  }, [getPos, paint]);

  const onUp    = useCallback(() => {
    isDrawingRef.current = false;
    lastPosRef.current   = null;
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleClear = () => {
    const c = maskCanvasRef.current;
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  };

  const handleDone = () => {
    const c = maskCanvasRef.current;
    if (!c) { onClose(); return; }
    const ctx  = c.getContext('2d')!;
    const data = ctx.getImageData(0, 0, c.width, c.height);

    let hasExclusions = false;
    for (let i = 3; i < data.data.length; i += 4) {
      if (data.data[i] > 30) { hasExclusions = true; break; }
    }

    if (!hasExclusions) {
      setUnderbaseMaskData(null);
      onClose();
      return;
    }

    const out    = document.createElement('canvas');
    out.width    = c.width;
    out.height   = c.height;
    const outCtx = out.getContext('2d')!;
    const outImg = outCtx.createImageData(c.width, c.height);
    for (let i = 0; i < c.width * c.height; i++) {
      const v = data.data[i * 4 + 3] > 30 ? 0 : 255;
      outImg.data[i * 4] = outImg.data[i * 4 + 1] = outImg.data[i * 4 + 2] = v;
      outImg.data[i * 4 + 3] = 255;
    }
    outCtx.putImageData(outImg, 0, 0);
    setUnderbaseMaskData(out.toDataURL('image/png'));
    onClose();
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const noImage = !previewImage && !underbasePreviewImage;

  const content = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 99990, background: 'rgba(8,8,8,0.93)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 32, paddingBottom: 24, overflowY: 'auto' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div style={{ marginBottom: 16, textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Underbase Mask Editor
        </div>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)', marginTop: 4, letterSpacing: '0.04em' }}>
          Paint <span style={{ color: 'rgba(230,80,80,0.95)' }}>red</span> over white areas to remove underbase · <span style={{ color: 'rgba(80,210,100,0.9)' }}>RESTORE</span> to bring it back
        </div>
      </div>

      {/* No image fallback */}
      {noImage && (
        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontFamily: 'var(--font-mono)', padding: 40, flexShrink: 0 }}>
          No underbase computed — enable underbase and load an image first
        </div>
      )}

      {/* Canvas area — always in DOM so refs are available for useLayoutEffect */}
      <div
        style={{ position: 'relative', display: canvasW > 0 ? 'inline-block' : 'none', cursor: 'none', userSelect: 'none', flexShrink: 0, marginBottom: 16 }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => { onUp(); setCursor(null); }}
        onTouchStart={onDown}
        onTouchMove={onMove}
        onTouchEnd={onUp}
      >
        <canvas ref={artCanvasRef}  style={{ display: 'block', borderRadius: 4 }} />
        <canvas ref={maskCanvasRef} style={{ position: 'absolute', inset: 0, borderRadius: 4, pointerEvents: 'none' }} />

        {/* Brush cursor ring */}
        {cursor && (() => {
          const artC = artCanvasRef.current;
          if (!artC) return null;
          const r     = artC.getBoundingClientRect();
          const sx    = r.width  / canvasW;
          const sy    = r.height / canvasH;
          return (
            <div style={{
              position: 'absolute', pointerEvents: 'none', borderRadius: '50%',
              left:   cursor.x * sx - brushSize * sx / 2,
              top:    cursor.y * sy - brushSize * sy / 2,
              width:  brushSize * sx, height: brushSize * sy,
              border: `1.5px solid ${brushMode === 'exclude' ? 'rgba(230,80,80,0.9)' : 'rgba(80,210,100,0.9)'}`,
            }} />
          );
        })()}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center', flexShrink: 0 }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.14)' }}>
          {(['exclude', 'include'] as const).map((m) => (
            <button key={m} onClick={() => setBrushMode(m)}
              style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', letterSpacing: '0.06em',
                background: brushMode === m
                  ? (m === 'exclude' ? 'rgba(210,50,50,0.7)' : 'rgba(60,180,80,0.5)')
                  : 'rgba(255,255,255,0.06)' }}>
              {m === 'exclude' ? 'REMOVE' : 'RESTORE'}
            </button>
          ))}
        </div>

        {/* Brush size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.05)', padding: '5px 10px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)' }}>Size</span>
          <input type="range" min={4} max={80} step={2} value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            style={{ width: 80, accentColor: 'var(--accent)' }} />
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.65)', minWidth: 26 }}>{brushSize}px</span>
        </div>

        <button onClick={handleClear}
          style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em' }}>
          CLEAR
        </button>

        <button onClick={onClose}
          style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 5, cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em' }}>
          CANCEL
        </button>

        <button onClick={handleDone}
          style={{ padding: '6px 18px', background: 'var(--accent)', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>
          DONE
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em', flexShrink: 0 }}>
        ESC to cancel
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
