import { useRef, useEffect, useCallback, useState } from 'react';
import type { LevelsAdjustment, CurvePoint, AdjMode } from '../engine/imageProcessor';
import { buildCurvesLUT } from '../engine/adjustments';

// ─── Shared ───────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function fmt(v: number, dec = 0) { return v.toFixed(dec); }

// ─── Levels Editor ────────────────────────────────────────────────────────────

// Gamma handle screen position (0–1 fraction of bar width) given the current settings.
function gammaFraction(lv: LevelsAdjustment): number {
  // The midtone input value that maps to output=128: midInput = inBlack + 0.5^gamma*(inWhite-inBlack)
  // Expressed as a fraction of the full 0-255 bar width:
  return (lv.inBlack + Math.pow(0.5, lv.inGamma) * (lv.inWhite - lv.inBlack)) / 255;
}

// Derive inGamma when gamma handle is dragged to fraction `f` of full bar
function fractionToGamma(f: number, lv: LevelsAdjustment): number {
  const inputVal = f * 255;
  const range    = lv.inWhite - lv.inBlack;
  if (range < 1) return 1;
  const t = Math.max(0.001, Math.min(0.999, (inputVal - lv.inBlack) / range));
  // t = 0.5^gamma  =>  gamma = log(t)/log(0.5)
  const gamma = Math.log(t) / Math.log(0.5);
  return Math.max(0.10, Math.min(5.00, gamma));
}

type LevelsHandle = 'inBlack' | 'inGamma' | 'inWhite' | 'outBlack' | 'outWhite';

interface LevelsBarProps {
  lv: LevelsAdjustment;
  onChange: (lv: LevelsAdjustment) => void;
}

function LevelsBar({ lv, onChange }: LevelsBarProps) {
  const barRef   = useRef<HTMLDivElement>(null);
  const dragging = useRef<LevelsHandle | null>(null);

  const xToFrac = useCallback((clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  }, []);

  const onMove = useCallback((e: PointerEvent) => {
    const h = dragging.current;
    if (!h) return;
    const frac = xToFrac(e.clientX);
    const val  = Math.round(frac * 255);
    onChange({
      ...lv,
      inBlack:  h === 'inBlack'  ? Math.min(val, lv.inWhite - 1) : lv.inBlack,
      inGamma:  h === 'inGamma'  ? fractionToGamma(frac, lv)      : lv.inGamma,
      inWhite:  h === 'inWhite'  ? Math.max(val, lv.inBlack + 1)  : lv.inWhite,
      outBlack: h === 'outBlack' ? Math.min(val, lv.outWhite - 1) : lv.outBlack,
      outWhite: h === 'outWhite' ? Math.max(val, lv.outBlack + 1) : lv.outWhite,
    });
  }, [lv, onChange, xToFrac]);

  const onUp = useCallback(() => { dragging.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
  }, [onMove, onUp]);

  const H = (id: LevelsHandle, frac: number, label: string, shape: 'down' | 'up' | 'diamond') => {
    const left = `${(frac * 100).toFixed(2)}%`;
    const color = id === 'inBlack' || id === 'outBlack' ? '#e0e0e0'
                : id === 'inWhite' || id === 'outWhite' ? '#ffffff'
                : 'var(--accent)';
    const s: React.CSSProperties = {
      position: 'absolute', left, transform: 'translateX(-50%)',
      cursor: 'ew-resize', userSelect: 'none', touchAction: 'none',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    };
    const marker =
      shape === 'down'    ? <svg width="10" height="9"><polygon points="5,9 0,0 10,0" fill={color} /></svg>
      : shape === 'up'    ? <svg width="10" height="9"><polygon points="5,0 0,9 10,9" fill={color} /></svg>
      : /* diamond */       <svg width="10" height="10"><polygon points="5,0 10,5 5,10 0,5" fill={color} /></svg>;
    return (
      <div key={id} style={s} onPointerDown={(e) => { e.preventDefault(); dragging.current = id; e.currentTarget.setPointerCapture(e.pointerId); }}>
        {marker}
        <span style={{ ...MONO, fontSize: 8, color: 'var(--text-dim)', lineHeight: 1 }}>{label}</span>
      </div>
    );
  };

  const barStyle: React.CSSProperties = {
    height: 12, borderRadius: 1, border: '1px solid var(--border-2)',
    position: 'relative',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Input */}
      <div>
        <div style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Input</div>
        <div ref={barRef} style={{ ...barStyle, background: 'linear-gradient(to right, #000, #fff)', marginBottom: 18 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            {H('inBlack',  lv.inBlack / 255,   fmt(lv.inBlack),    'down')}
            {H('inGamma',  gammaFraction(lv),   fmt(lv.inGamma, 2), 'diamond')}
            {H('inWhite',  lv.inWhite / 255,   fmt(lv.inWhite),    'down')}
          </div>
        </div>
      </div>
      {/* Output */}
      <div>
        <div style={{ ...MONO, fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Output</div>
        <div style={{ ...barStyle, background: `linear-gradient(to right, #${lv.outBlack.toString(16).padStart(2,'0').repeat(3)}, #fff)`, marginBottom: 18 }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            {H('outBlack', lv.outBlack / 255, fmt(lv.outBlack), 'up')}
            {H('outWhite', lv.outWhite / 255, fmt(lv.outWhite), 'up')}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LevelsEditor({ lv, onChange }: { lv: LevelsAdjustment; onChange: (lv: LevelsAdjustment) => void }) {
  return (
    <div style={{ padding: '2px 0' }}>
      <LevelsBar lv={lv} onChange={onChange} />
    </div>
  );
}

// ─── Curves Editor ────────────────────────────────────────────────────────────

const CANVAS_SIZE = 180;
const POINT_RADIUS = 5;
const HIT_RADIUS   = 12;

function ptToCanvas(x: number, y: number): [number, number] {
  return [(x / 255) * CANVAS_SIZE, (1 - y / 255) * CANVAS_SIZE];
}
function canvasToPt(cx: number, cy: number): [number, number] {
  return [
    Math.max(0, Math.min(255, Math.round((cx / CANVAS_SIZE) * 255))),
    Math.max(0, Math.min(255, Math.round((1 - cy / CANVAS_SIZE) * 255))),
  ];
}

function drawCurveCanvas(
  canvas: HTMLCanvasElement,
  points: CurvePoint[],
  hoveredIdx: number,
  activeIdx: number,
) {
  const ctx = canvas.getContext('2d')!;
  const S   = CANVAS_SIZE;
  ctx.clearRect(0, 0, S, S);

  // Background
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, S, S);

  // Grid
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const p = (i / 4) * S;
    ctx.beginPath(); ctx.moveTo(p, 0);  ctx.lineTo(p, S);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p);  ctx.lineTo(S, p);  ctx.stroke();
  }

  // Identity diagonal
  ctx.strokeStyle = '#333';
  ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.moveTo(0, S); ctx.lineTo(S, 0); ctx.stroke();
  ctx.setLineDash([]);

  // Curve (evaluate LUT for smooth draw)
  const lut = buildCurvesLUT(points);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x < 256; x++) {
    const [cx, cy] = ptToCanvas(x, lut[x]);
    x === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
  }
  ctx.stroke();

  // Control points
  for (let i = 0; i < points.length; i++) {
    const [cx, cy] = ptToCanvas(points[i][0], points[i][1]);
    const isActive  = i === activeIdx;
    const isHovered = i === hoveredIdx;
    ctx.beginPath();
    ctx.arc(cx, cy, isActive ? POINT_RADIUS + 1 : POINT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle   = isActive ? 'var(--accent)' : isHovered ? '#ddd' : '#fff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 1;
    ctx.fill();
    ctx.stroke();
  }
}

export function CurvesEditor({ points, onChange }: { points: CurvePoint[]; onChange: (pts: CurvePoint[]) => void }) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const activeIdx    = useRef<number>(-1);
  const [hovered, setHovered] = useState(-1);
  const [active, setActive]   = useState(-1);

  const redraw = useCallback((pts: CurvePoint[], hi: number, ai: number) => {
    if (canvasRef.current) drawCurveCanvas(canvasRef.current, pts, hi, ai);
  }, []);

  useEffect(() => { redraw(points, hovered, active); }, [points, hovered, active, redraw]);

  const nearestPoint = useCallback((cx: number, cy: number, pts: CurvePoint[]): number => {
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = ptToCanvas(pts[i][0], pts[i][1]);
      if (Math.hypot(cx - px, cy - py) <= HIT_RADIUS) return i;
    }
    return -1;
  }, []);

  const getCanvasXY = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width)  * CANVAS_SIZE,
      ((e.clientY - r.top)  / r.height) * CANVAS_SIZE,
    ];
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const [cx, cy] = getCanvasXY(e);
    let idx = nearestPoint(cx, cy, points);
    if (idx === -1) {
      // Add new point
      const [nx, ny] = canvasToPt(cx, cy);
      const next = [...points, [nx, ny] as CurvePoint].sort((a, b) => a[0] - b[0]);
      idx = next.findIndex(p => p[0] === nx && p[1] === ny);
      onChange(next);
      activeIdx.current = idx;
      setActive(idx);
    } else {
      activeIdx.current = idx;
      setActive(idx);
    }
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }, [points, onChange, nearestPoint]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const [cx, cy] = getCanvasXY(e);
    if (activeIdx.current === -1) {
      setHovered(nearestPoint(cx, cy, points));
      return;
    }
    const idx  = activeIdx.current;
    const [nx, ny] = canvasToPt(cx, cy);
    const next = points.map((p, i): CurvePoint => {
      if (i !== idx) return p;
      // Clamp x so it doesn't cross adjacent points
      const minX = i === 0               ? 0   : points[i - 1][0] + 1;
      const maxX = i === points.length-1 ? 255 : points[i + 1][0] - 1;
      return [Math.max(minX, Math.min(maxX, nx)), ny];
    });
    onChange(next);
  }, [points, onChange, nearestPoint]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const [cx, cy] = getCanvasXY(e);
    const idx = activeIdx.current;
    if (idx !== -1) {
      const outside = cx < -8 || cx > CANVAS_SIZE + 8 || cy < -8 || cy > CANVAS_SIZE + 8;
      // Remove point if dragged outside, but keep at least 2 points and never remove the endpoints
      if (outside && points.length > 2 && idx > 0 && idx < points.length - 1) {
        onChange(points.filter((_, i) => i !== idx));
      }
    }
    activeIdx.current = -1;
    setActive(-1);
  }, [points, onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          width: CANVAS_SIZE, height: CANVAS_SIZE,
          cursor: 'crosshair', border: '1px solid var(--border)',
          imageRendering: 'pixelated',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHovered(-1)}
      />
      <div style={{ ...MONO, fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.5 }}>
        Click to add points · Drag to adjust · Drag off to remove
      </div>
    </div>
  );
}

// ─── Tabbed wrapper (used by ControlPanel) ────────────────────────────────────

interface Props {
  adj: import('../engine/imageProcessor').ImageAdjustments;
  onAdjMode:  (m: AdjMode)          => void;
  onLevels:   (lv: LevelsAdjustment) => void;
  onCurves:   (pts: CurvePoint[])    => void;
  onReset:    () => void;
  onBasic:    (key: string, v: number) => void;
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '4px 0',
        background: active ? 'var(--accent)' : 'var(--surface-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        color: active ? '#000' : 'var(--text-muted)',
        fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
        textTransform: 'uppercase', cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {label}
    </button>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="field">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
        <span style={{ ...MONO, fontSize: 10, color: 'var(--text-dim)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function ImageAdjustPanel({ adj, onAdjMode, onLevels, onCurves, onReset, onBasic }: Props) {
  const mode    = adj.adjMode ?? 'basic';
  const isDirty = mode !== 'basic'
    ? true
    : adj.exposure !== 0 || adj.contrast !== 0 || adj.shadows !== 0 || adj.highlights !== 0 || adj.blur !== 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        <TabBtn label="Basic"  active={mode === 'basic'}  onClick={() => onAdjMode('basic')}  />
        <TabBtn label="Levels" active={mode === 'levels'} onClick={() => onAdjMode('levels')} />
        <TabBtn label="Curves" active={mode === 'curves'} onClick={() => onAdjMode('curves')} />
      </div>

      {/* Reset */}
      {isDirty && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" style={{ fontSize: 9, padding: '2px 8px', height: 20 }}
            onClick={onReset}>Reset</button>
        </div>
      )}

      {/* Basic */}
      {mode === 'basic' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Slider label="Exposure"   value={adj.exposure}   min={-100} max={100} onChange={v => onBasic('exposure', v)} />
          <Slider label="Contrast"   value={adj.contrast}   min={-100} max={100} onChange={v => onBasic('contrast', v)} />
          <Slider label="Shadows"    value={adj.shadows}    min={-100} max={100} onChange={v => onBasic('shadows', v)} />
          <Slider label="Highlights" value={adj.highlights} min={-100} max={100} onChange={v => onBasic('highlights', v)} />
        </div>
      )}

      {/* Levels */}
      {mode === 'levels' && (
        <LevelsEditor lv={adj.levels ?? { inBlack: 0, inGamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 }} onChange={onLevels} />
      )}

      {/* Curves */}
      {mode === 'curves' && (
        <CurvesEditor points={adj.curves ?? [[0, 0], [255, 255]]} onChange={onCurves} />
      )}

      {/* Pre-blur always visible */}
      <Slider label="Pre-blur" value={adj.blur} min={0} max={15} onChange={v => onBasic('blur', v)} />
    </div>
  );
}
