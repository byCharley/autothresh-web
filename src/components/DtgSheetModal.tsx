import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import {
  DTF_PRESETS, SUBLIMATION_PRESETS, calcLayout, displayVal, cmToIn, inToCm,
} from '../engine/sheetEngine';

interface Props {
  onClose: () => void;
  onGenerate: () => Promise<void>;
  generating: boolean;
}

const MONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const LABEL: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
  color: 'var(--text-muted)', ...MONO, marginBottom: 6, display: 'block',
};
const SECTION: React.CSSProperties = {
  borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12,
};

function NumField({ value, unit, onUp, onDown, onChange, step = 0.1 }: {
  value: number; unit: string;
  onUp: () => void; onDown: () => void;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button onClick={onDown} style={btnStyle}>&minus;</button>
      <input
        type="number"
        value={value}
        step={step}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onChange(v); }}
        style={{
          width: 64, height: 30, textAlign: 'center', fontSize: 12,
          background: 'var(--surface-2)', border: '1px solid var(--border-2)',
          color: 'var(--text)', borderRadius: 4, ...MONO,
        }}
      />
      <button onClick={onUp} style={btnStyle}>+</button>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', ...MONO }}>{unit}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: 28, height: 30, fontSize: 16, lineHeight: 1,
  background: 'var(--surface-2)', border: '1px solid var(--border-2)',
  color: 'var(--text-dim)', borderRadius: 4, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export function DtgSheetModal({ onClose, onGenerate, generating }: Props) {
  const { sheetSettings, updateSheetSettings, originalImage } = useStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, generating]);

  const { unit, sheetWidthIn, sheetHeightIn, designWidthIn, quantity, spacingIn, cutLines, dpi } = sheetSettings;
  const aspect = originalImage ? originalImage.height / originalImage.width : 1;
  const layout = calcLayout(sheetSettings, aspect);
  const designHeightIn = designWidthIn * aspect;

  function setUnit(newUnit: 'in' | 'cm') {
    updateSheetSettings({ unit: newUnit });
  }

  function setSheetWidth(displayValue: number) {
    updateSheetSettings({ sheetWidthIn: unit === 'cm' ? cmToIn(displayValue) : displayValue });
  }
  function setSheetHeight(displayValue: number) {
    updateSheetSettings({ sheetHeightIn: unit === 'cm' ? cmToIn(displayValue) : displayValue });
  }
  function setDesignWidth(displayValue: number) {
    updateSheetSettings({ designWidthIn: unit === 'cm' ? cmToIn(displayValue) : displayValue });
  }
  function setSpacing(displayValue: number) {
    updateSheetSettings({ spacingIn: unit === 'cm' ? cmToIn(displayValue) : displayValue });
  }

  const dispSheetW = displayVal(sheetWidthIn, unit);
  const dispSheetH = displayVal(sheetHeightIn, unit);
  const dispDesignW = displayVal(designWidthIn, unit);
  const dispDesignH = displayVal(designHeightIn, unit);
  const dispSpacing = displayVal(spacingIn, unit);
  const unitStep = unit === 'cm' ? 0.5 : 0.1;

  const presetBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, height: 28, fontSize: 10, ...MONO, letterSpacing: '0.04em',
    border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
    borderRadius: 4, cursor: 'pointer',
    background: active
      ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))'
      : 'var(--surface-2)',
    color: active ? 'var(--accent)' : 'var(--text-dim)',
    transition: 'all 0.12s',
  });

  const unitBtnStyle = (active: boolean): React.CSSProperties => ({
    ...presetBtnStyle(active), flex: 'none', width: 36,
  });

  const fitsOnSheet = layout.perSheet > 0;
  const sheetsNeeded = layout.sheets;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget && !generating) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        width: '100%', maxWidth: 460, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', borderRadius: 4,
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', ...MONO }}>
              DTF Sheet Builder
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button onClick={setUnit.bind(null, 'in')} style={unitBtnStyle(unit === 'in')}>in</button>
            <button onClick={setUnit.bind(null, 'cm')} style={unitBtnStyle(unit === 'cm')}>cm</button>
            <button
              onClick={onClose}
              disabled={generating}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, marginLeft: 4 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '14px 18px' }}>

          {/* Preset sizes */}
          <div style={{ ...SECTION, borderTop: 'none', paddingTop: 0, marginBottom: 12 }}>
            <span style={LABEL}>DTF Film</span>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {DTF_PRESETS.map(p => {
                const active = Math.abs(sheetWidthIn - p.widthIn) < 0.1;
                return (
                  <button key={p.label} style={presetBtnStyle(active)}
                    onClick={() => updateSheetSettings({ sheetWidthIn: p.widthIn, sheetHeightIn: p.heightIn })}>
                    {unit === 'cm' ? `${inToCm(p.widthIn).toFixed(1)}cm` : p.label}
                  </button>
                );
              })}
            </div>
            <span style={LABEL}>Sublimation</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {SUBLIMATION_PRESETS.map(p => {
                const active = Math.abs(sheetWidthIn - p.widthIn) < 0.1 && Math.abs(sheetHeightIn - p.heightIn) < 0.1;
                return (
                  <button key={p.label} style={presetBtnStyle(active)}
                    onClick={() => updateSheetSettings({ sheetWidthIn: p.widthIn, sheetHeightIn: p.heightIn })}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sheet size */}
          <div style={SECTION}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <span style={LABEL}>Sheet Width</span>
                <NumField
                  value={dispSheetW} unit={unit} step={unitStep}
                  onUp={() => setSheetWidth(parseFloat((dispSheetW + unitStep).toFixed(2)))}
                  onDown={() => setSheetWidth(parseFloat((Math.max(unitStep, dispSheetW - unitStep)).toFixed(2)))}
                  onChange={setSheetWidth}
                />
              </div>
              <div>
                <span style={LABEL}>Sheet Height</span>
                <NumField
                  value={dispSheetH} unit={unit} step={unitStep}
                  onUp={() => setSheetHeight(parseFloat((dispSheetH + unitStep).toFixed(2)))}
                  onDown={() => setSheetHeight(parseFloat((Math.max(unitStep, dispSheetH - unitStep)).toFixed(2)))}
                  onChange={setSheetHeight}
                />
              </div>
            </div>
          </div>

          {/* Design print size */}
          <div style={SECTION}>
            <span style={LABEL}>Design Print Size</span>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <span style={{ ...LABEL, marginBottom: 4 }}>Width</span>
                <NumField
                  value={dispDesignW} unit={unit} step={unitStep}
                  onUp={() => setDesignWidth(parseFloat((dispDesignW + unitStep).toFixed(2)))}
                  onDown={() => setDesignWidth(parseFloat((Math.max(unitStep, dispDesignW - unitStep)).toFixed(2)))}
                  onChange={setDesignWidth}
                />
              </div>
              <div style={{ paddingTop: 18, fontSize: 11, color: 'var(--text-dim)', ...MONO }}>
                H: {dispDesignH.toFixed(2)}{unit}
                <span style={{ fontSize: 9, color: 'var(--text-dim)', display: 'block', marginTop: 2 }}>
                  aspect-locked
                </span>
              </div>
            </div>
          </div>

          {/* Quantity + Spacing */}
          <div style={SECTION}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <span style={LABEL}>Quantity</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button onClick={() => updateSheetSettings({ quantity: Math.max(1, quantity - 1) })} style={btnStyle}>&minus;</button>
                  <input
                    type="number" min={1}
                    value={quantity}
                    onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) updateSheetSettings({ quantity: v }); }}
                    style={{
                      width: 50, height: 30, textAlign: 'center', fontSize: 12,
                      background: 'var(--surface-2)', border: '1px solid var(--border-2)',
                      color: 'var(--text)', borderRadius: 4, ...MONO,
                    }}
                  />
                  <button onClick={() => updateSheetSettings({ quantity: quantity + 1 })} style={btnStyle}>+</button>
                </div>
              </div>
              <div>
                <span style={LABEL}>Spacing</span>
                <NumField
                  value={dispSpacing} unit={unit} step={unitStep}
                  onUp={() => setSpacing(parseFloat((dispSpacing + unitStep).toFixed(2)))}
                  onDown={() => setSpacing(parseFloat((Math.max(0, dispSpacing - unitStep)).toFixed(2)))}
                  onChange={setSpacing}
                />
              </div>
            </div>
          </div>

          {/* Cut lines */}
          <div style={{ ...SECTION, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={cutLines}
                onChange={e => updateSheetSettings({ cutLines: e.target.checked })}
                style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
              />
              <span style={{ fontSize: 11, ...MONO, color: 'var(--text-dim)' }}>Draw cut lines</span>
            </label>
          </div>

          {/* Output DPI */}
          <div style={SECTION}>
            <span style={LABEL}>Output Resolution</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {([150, 300] as const).map(d => (
                <button key={d} style={presetBtnStyle(dpi === d)}
                  onClick={() => updateSheetSettings({ dpi: d })}>
                  {d} DPI
                </button>
              ))}
            </div>
            {dpi === 300 && (
              <div style={{ fontSize: 9, color: 'var(--text-dim)', ...MONO, marginTop: 6 }}>
                300 DPI can produce very large files for big sheets.
              </div>
            )}
          </div>

          {/* Layout summary */}
          <div style={{
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '12px 14px', marginBottom: 4,
          }}>
            {fitsOnSheet ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  ['Layout', `${layout.cols} × ${layout.rows} per sheet`],
                  ['Per Sheet', `${layout.perSheet} copies`],
                  ['Quantity', `${quantity}`],
                  ['Sheets Needed', sheetsNeeded > 1 ? `${sheetsNeeded} sheets` : '1 sheet'],
                  ['Used Area', `${layout.usedAreaIn2.toFixed(1)} in²`],
                  ['Wasted Area', `${layout.wastedAreaIn2.toFixed(1)} in²`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontSize: 8, ...MONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, ...MONO, color: 'var(--text)' }}>{v}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: '#ff4d4f', ...MONO, textAlign: 'center' }}>
                Design doesn't fit on this sheet — reduce print size or increase sheet dimensions.
              </div>
            )}
          </div>
          {sheetsNeeded > 1 && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', ...MONO, marginBottom: 4 }}>
              Only the first sheet is exported. Run again to export subsequent sheets.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 8, flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            disabled={generating}
            style={{
              flex: 1, height: 36, fontSize: 10, ...MONO, letterSpacing: '0.06em',
              border: '1px solid var(--border-2)', borderRadius: 4, cursor: 'pointer',
              background: 'var(--surface-2)', color: 'var(--text-dim)',
              textTransform: 'uppercase',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onGenerate}
            disabled={generating || !fitsOnSheet || !originalImage}
            style={{
              flex: 2, height: 36, fontSize: 10, ...MONO, letterSpacing: '0.06em',
              border: 'none', borderRadius: 4,
              cursor: generating || !fitsOnSheet || !originalImage ? 'not-allowed' : 'pointer',
              background: generating || !fitsOnSheet || !originalImage ? 'var(--surface-2)' : 'var(--accent)',
              color: generating || !fitsOnSheet || !originalImage ? 'var(--text-muted)' : '#fff',
              textTransform: 'uppercase', fontWeight: 700,
              transition: 'background 0.15s',
            }}
          >
            {generating ? 'Generating…' : 'Generate Sheet PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}
