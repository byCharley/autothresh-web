import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { DTF_PRESETS, SUBLIMATION_PRESETS, calcLayout, displayVal, cmToIn, inToCm } from '../engine/sheetEngine';

interface Props {
  onClose: () => void;
  onGenerate: () => Promise<void>;
  generating: boolean;
}

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

const chipBtnStyle = (active: boolean): React.CSSProperties => ({
  flex: 1, height: 30, fontSize: 10, ...MONO, letterSpacing: '0.04em',
  border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
  borderRadius: 4, cursor: 'pointer',
  background: active ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)',
  color: active ? 'var(--accent)' : 'var(--text-dim)',
  transition: 'all 0.12s', whiteSpace: 'nowrap' as const,
});

const nudgeBtnStyle: React.CSSProperties = {
  width: 26, height: 28, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--surface-2)', border: '1px solid var(--border-2)',
  color: 'var(--text-dim)', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
};

const numInputStyle: React.CSSProperties = {
  width: 54, height: 28, textAlign: 'center', fontSize: 12,
  background: 'var(--surface-2)', border: '1px solid var(--border-2)',
  color: 'var(--text)', borderRadius: 4, ...MONO,
};

function NumStepper({ value, step = 0.1, min = 0.1, onUp, onDown, onChange, unit }: {
  value: number; step?: number; min?: number;
  onUp: () => void; onDown: () => void;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button style={nudgeBtnStyle} onClick={onDown}>&minus;</button>
      <input type="number" step={step} value={value} style={numInputStyle}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= min) onChange(v); }} />
      <button style={nudgeBtnStyle} onClick={onUp}>+</button>
      {unit && <span style={{ fontSize: 10, color: 'var(--text-dim)', ...MONO, marginLeft: 2 }}>{unit}</span>}
    </div>
  );
}

export function DtgSheetModal({ onClose, onGenerate, generating }: Props) {
  const { sheetSettings, updateSheetSettings, originalImage } = useStore();
  const [showPreview, setShowPreview] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, generating]);

  const { unit, sheetWidthIn, sheetHeightIn, quantity, spacingIn, cutLines, dpi, rotateDesign } = sheetSettings;
  const artAspect = originalImage ? originalImage.height / originalImage.width : 1;
  const layout = calcLayout(sheetSettings, artAspect);

  // Draw preview canvas
  useEffect(() => {
    if (!showPreview || !canvasRef.current) return;
    const c = canvasRef.current;
    const ctx = c.getContext('2d')!;

    const MAX_W = 420, MAX_H = 240;
    const scale = Math.min(MAX_W / sheetWidthIn, MAX_H / sheetHeightIn);
    c.width = Math.max(1, Math.round(sheetWidthIn * scale));
    c.height = Math.max(1, Math.round(sheetHeightIn * scale));

    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);

    // Slot dimensions in preview px
    const slotW = Math.max(1, (sheetWidthIn - (layout.cols + 1) * spacingIn) / layout.cols * scale);
    const slotH = Math.max(1, (sheetHeightIn - (layout.rows + 1) * spacingIn) / layout.rows * scale);
    const sPx = spacingIn * scale;

    // Design footprint (may be rotated)
    const srcW = layout.designWidthIn * scale;
    const srcH = layout.designHeightIn * scale;
    const fpW = rotateDesign ? srcH : srcW;
    const fpH = rotateDesign ? srcW : srcH;

    // Center each design within its slot
    const offX = (slotW - fpW) / 2;
    const offY = (slotH - fpH) / 2;

    let artCanvas: HTMLCanvasElement | null = null;
    if (originalImage) {
      artCanvas = document.createElement('canvas');
      artCanvas.width = originalImage.width;
      artCanvas.height = originalImage.height;
      artCanvas.getContext('2d')!.putImageData(originalImage, 0, 0);
    }

    let placed = 0;
    outer: for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        if (placed >= quantity) break outer;
        const sx = sPx + col * (slotW + sPx) + offX;
        const sy = sPx + row * (slotH + sPx) + offY;

        if (artCanvas) {
          if (rotateDesign) {
            ctx.save();
            ctx.translate(sx + fpW, sy);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(artCanvas, 0, 0, srcW, srcH);
            ctx.restore();
          } else {
            ctx.drawImage(artCanvas, sx, sy, fpW, fpH);
          }
        } else {
          ctx.fillStyle = 'rgba(100,100,100,0.2)';
          ctx.fillRect(sx, sy, fpW, fpH);
        }

        if (cutLines) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,0,0,0.5)';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(sx + 0.5, sy + 0.5, fpW - 1, fpH - 1);
          ctx.restore();
        }
        placed++;
      }
    }
  }, [showPreview, sheetSettings, originalImage, artAspect, layout, sheetWidthIn, sheetHeightIn, spacingIn, cutLines, rotateDesign, quantity]);

  const u = unit;
  const step = u === 'cm' ? 0.5 : 0.1;
  const dispW = displayVal(sheetWidthIn, u);
  const dispH = displayVal(sheetHeightIn, u);
  const dispS = displayVal(spacingIn, u);

  function setSheetW(v: number) { updateSheetSettings({ sheetWidthIn: u === 'cm' ? cmToIn(v) : v }); }
  function setSheetH(v: number) { updateSheetSettings({ sheetHeightIn: u === 'cm' ? cmToIn(v) : v }); }
  function setSpacing(v: number) { updateSheetSettings({ spacingIn: u === 'cm' ? cmToIn(v) : v }); }

  const copySize = `${displayVal(layout.designWidthIn, u).toFixed(2)} × ${displayVal(layout.designHeightIn, u).toFixed(2)} ${u}`;
  const canGenerate = layout.perSheet > 0 && !!originalImage;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '12px' }}
      onClick={e => { if (e.target === e.currentTarget && !generating) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: '100%', maxWidth: 440, maxHeight: '92vh',
        display: 'flex', flexDirection: 'column', borderRadius: 4,
      }}>

        {/* Header */}
        <div style={{
          padding: '12px 16px 10px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', ...MONO }}>DTF Sheet Builder</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {(['in', 'cm'] as const).map(v => (
              <button key={v} onClick={() => updateSheetSettings({ unit: v })} style={{ ...chipBtnStyle(u === v), flex: 'none', width: 32, height: 26, fontSize: 9 }}>{v}</button>
            ))}
            <button onClick={onClose} disabled={generating}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '2px 4px', marginLeft: 2 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Presets */}
          <div>
            <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>DTF Film</div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
              {DTF_PRESETS.map(p => (
                <button key={p.label} style={chipBtnStyle(Math.abs(sheetWidthIn - p.widthIn) < 0.1)}
                  onClick={() => updateSheetSettings({ sheetWidthIn: p.widthIn, sheetHeightIn: p.heightIn })}>
                  {u === 'cm' ? `${inToCm(p.widthIn).toFixed(0)}cm` : p.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Sublimation</div>
            <div style={{ display: 'flex', gap: 5 }}>
              {SUBLIMATION_PRESETS.map(p => {
                const active = Math.abs(sheetWidthIn - p.widthIn) < 0.1 && Math.abs(sheetHeightIn - p.heightIn) < 0.1;
                return (
                  <button key={p.label} style={chipBtnStyle(active)}
                    onClick={() => updateSheetSettings({ sheetWidthIn: p.widthIn, sheetHeightIn: p.heightIn })}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sheet size + Quantity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Sheet Width</div>
              <NumStepper value={dispW} step={step} onUp={() => setSheetW(parseFloat((dispW + step).toFixed(2)))} onDown={() => setSheetW(parseFloat((Math.max(step, dispW - step)).toFixed(2)))} onChange={setSheetW} unit={u} />
            </div>
            <div>
              <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Sheet Height</div>
              <NumStepper value={dispH} step={step} onUp={() => setSheetH(parseFloat((dispH + step).toFixed(2)))} onDown={() => setSheetH(parseFloat((Math.max(step, dispH - step)).toFixed(2)))} onChange={setSheetH} unit={u} />
            </div>
            <div>
              <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Copies</div>
              <NumStepper value={quantity} step={1} min={1}
                onUp={() => updateSheetSettings({ quantity: quantity + 1 })}
                onDown={() => updateSheetSettings({ quantity: Math.max(1, quantity - 1) })}
                onChange={v => updateSheetSettings({ quantity: Math.max(1, Math.round(v)) })} />
            </div>
            <div>
              <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Spacing</div>
              <NumStepper value={dispS} step={step} min={0}
                onUp={() => setSpacing(parseFloat((dispS + step).toFixed(2)))}
                onDown={() => setSpacing(parseFloat((Math.max(0, dispS - step)).toFixed(2)))}
                onChange={setSpacing} unit={u} />
            </div>
          </div>

          {/* Options row */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
            {/* Cut lines */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 10, ...MONO, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={cutLines} onChange={e => updateSheetSettings({ cutLines: e.target.checked })}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
              Cut lines
            </label>
            {/* Rotate */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 10, ...MONO, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={rotateDesign} onChange={e => updateSheetSettings({ rotateDesign: e.target.checked })}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13 }} />
              Rotate 90°
            </label>
            {/* DPI */}
            <div style={{ display: 'flex', gap: 5, marginLeft: 'auto' }}>
              {([150, 300] as const).map(d => (
                <button key={d} onClick={() => updateSheetSettings({ dpi: d })}
                  style={{ ...chipBtnStyle(dpi === d), flex: 'none', padding: '0 10px', height: 26, fontSize: 9 }}>
                  {d} DPI
                </button>
              ))}
            </div>
          </div>

          {/* Layout info */}
          <div style={{
            background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 4,
            padding: '10px 12px',
          }}>
            {layout.perSheet > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  ['Grid', `${layout.cols}×${layout.rows}`],
                  ['Per Sheet', `${layout.perSheet}`],
                  ['Sheets', `${layout.sheets}`],
                  ['Copy Size', copySize],
                  ['Used', `${layout.usedAreaIn2.toFixed(0)} in²`],
                  ['Waste', `${layout.wastedAreaIn2.toFixed(0)} in²`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, ...MONO, color: 'var(--text)' }}>{v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#ff4d4f', ...MONO, textAlign: 'center' }}>
                Doesn't fit — reduce copies or increase sheet size.
              </div>
            )}
          </div>

          {/* Preview canvas */}
          {showPreview && layout.perSheet > 0 && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#e8e8e8' }}>
              <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 6, flexShrink: 0,
        }}>
          <button onClick={onClose} disabled={generating}
            style={{ flex: 1, height: 34, fontSize: 9, ...MONO, letterSpacing: '0.06em', border: '1px solid var(--border-2)', borderRadius: 4, cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
            Cancel
          </button>
          <button
            onClick={() => setShowPreview(p => !p)} disabled={!canGenerate}
            style={{
              flex: 1, height: 34, fontSize: 9, ...MONO, letterSpacing: '0.06em', borderRadius: 4,
              cursor: !canGenerate ? 'not-allowed' : 'pointer',
              border: showPreview ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
              background: showPreview ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)',
              color: showPreview ? 'var(--accent)' : 'var(--text-dim)',
              textTransform: 'uppercase', transition: 'all 0.12s',
            }}>
            {showPreview ? 'Hide' : 'Preview'}
          </button>
          <button
            onClick={onGenerate} disabled={generating || !canGenerate}
            style={{
              flex: 2, height: 34, fontSize: 9, ...MONO, letterSpacing: '0.06em', border: 'none', borderRadius: 4,
              cursor: generating || !canGenerate ? 'not-allowed' : 'pointer',
              background: generating || !canGenerate ? 'var(--surface-2)' : 'var(--accent)',
              color: generating || !canGenerate ? 'var(--text-muted)' : '#fff',
              textTransform: 'uppercase', fontWeight: 700, transition: 'background 0.15s',
            }}>
            {generating ? 'Generating…' : 'Generate Sheet PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}
