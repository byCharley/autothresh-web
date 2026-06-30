import { useState } from 'react';
import { useStore } from '../store/useStore';

export type ExportFormat = 'png' | 'psd' | 'pdf' | 'tiff' | 'svg';

export interface ExportConfig {
  mode:             'screen' | 'dtg';
  format:           ExportFormat;
  fileName:         string;
  includeColorInfo: boolean;
  usePantoneNames:  boolean;
  underbase:        boolean;
  underbaseChoke:   0 | 1 | 2;
}

interface Props {
  onClose:         () => void;
  onExport:        (config: ExportConfig) => Promise<void>;
  defaultFileName: string;
  separationMode?: string;
}

const FORMATS_ALL: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'png',  label: 'PNG',  ext: '.png'  },
  { value: 'psd',  label: 'PSD',  ext: '.psd'  },
  { value: 'pdf',  label: 'PDF',  ext: '.pdf'  },
  { value: 'tiff', label: 'TIFF', ext: '.tiff' },
];

const FORMATS_DITHER: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'png', label: 'PNG', ext: '.png' },
  { value: 'psd', label: 'PSD', ext: '.psd' },
  { value: 'pdf', label: 'PDF', ext: '.pdf' },
];

function details(mode: 'screen' | 'dtg', format: ExportFormat, isDither: boolean) {
  if (format === 'svg') {
    return { pkg: 'Single file', layers: 'Scalable vector paths', bg: 'Transparent', marks: 'Not included' };
  }
  if (isDither) {
    switch (format) {
      case 'png': return { pkg: 'Single file', layers: 'Dithered composite image', bg: 'White', marks: 'Not included' };
      case 'psd': return { pkg: 'Single file', layers: 'One colored layer per ink zone', bg: 'White', marks: 'Not included' };
      case 'pdf': return { pkg: 'Single file', layers: 'Dithered composite page', bg: 'White', marks: 'Not included' };
      case 'tiff': return { pkg: 'Single file', layers: 'Dithered composite image', bg: 'White', marks: 'Not included' };
    }
  }
  if (mode === 'screen') {
    switch (format) {
      case 'png':  return { pkg: 'ZIP archive',   layers: 'One PNG per separation + composite',    bg: 'Transparent', marks: 'Included' };
      case 'psd':  return { pkg: 'Single file',   layers: 'One Photoshop layer per separation',    bg: 'Transparent', marks: 'Included' };
      case 'pdf':  return { pkg: 'Single file',   layers: 'One page per separation',               bg: 'Transparent', marks: 'Included' };
      case 'tiff': return { pkg: 'ZIP archive',   layers: 'One TIFF per separation + composite',   bg: 'Transparent', marks: 'Included' };
    }
  } else {
    switch (format) {
      case 'png':  return { pkg: 'Single file',   layers: 'All colors composited',   bg: 'Transparent', marks: 'Not included' };
      case 'psd':  return { pkg: 'Single file',   layers: 'All colors composited',   bg: 'Transparent', marks: 'Not included' };
      case 'pdf':  return { pkg: 'Single file',   layers: 'All colors composited',   bg: 'Transparent', marks: 'Not included' };
      case 'tiff': return { pkg: 'Single file',   layers: 'All colors composited',   bg: 'Transparent', marks: 'Not included' };
    }
  }
}

export function ExportModal({ onClose, onExport, defaultFileName, separationMode }: Props) {
  const isDither  = separationMode === 'palette';
  const isVector  = separationMode === 'vector';
  const isCmyk    = separationMode === 'cmyk';
  const isCmykPro = separationMode === 'cmyk-pro';
  const FORMATS  = isVector ? [{ value: 'svg' as ExportFormat, label: 'SVG', ext: '.svg' }] : isDither ? FORMATS_DITHER : FORMATS_ALL;

  const [mode,             setMode]             = useState<'screen' | 'dtg'>(isDither ? 'dtg' : 'screen');
  const [format,           setFormat]           = useState<ExportFormat>(isVector ? 'svg' : 'png');
  const [fileName,         setFileName]         = useState(defaultFileName);
  const { underbaseEnabled, underbaseChoke: storeChoke, setUnderbaseEnabled, setUnderbaseChoke } = useStore();
  const [exporting,        setExporting]        = useState(false);
  const [exportError,      setExportError]      = useState<string | null>(null);
  const [includeColorInfo, setIncludeColorInfo] = useState(false);
  const [usePantoneNames,  setUsePantoneNames]  = useState(false);
  const includeUnderbase = underbaseEnabled;
  const undChoke         = storeChoke;
  const setIncludeUnderbase = setUnderbaseEnabled;
  const setUndChoke         = setUnderbaseChoke;

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    await new Promise(r => setTimeout(r, 60));
    try {
      await onExport({ mode: isDither ? 'dtg' : mode, format, fileName: fileName.trim() || defaultFileName, includeColorInfo, usePantoneNames, underbase: includeUnderbase, underbaseChoke: undChoke });
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const d = details(mode, format, isDither);
  const fmt = FORMATS.find(f => f.value === format) ?? FORMATS[0];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          width: 480, maxWidth: '92vw', zIndex: 41,
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 24px)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            {isVector ? 'Export — Vector' : isDither ? 'Export — Dither' : isCmykPro ? 'Export — CMYK Pro' : 'Export'}
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Mode selector — hidden for Dither, Vector, and CMYK Pro */}
        {!isDither && !isVector && !isCmykPro && (
          <div style={{ padding: '14px 16px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
              Export Mode
            </div>
            <div style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
              {(['screen', 'dtg'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1, padding: '12px 12px',
                    border: `1px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`,
                    background: mode === m ? 'var(--accent-dim)' : 'var(--surface-2)',
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: mode === m ? 'var(--accent)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                    {m === 'screen' ? 'Screen Print' : 'DTG'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
                    {m === 'screen' ? 'Separated layers, one file per color.' : 'Single composited image, transparent bg.'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Format selector */}
        <div style={{ padding: '14px 16px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
            File Format
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 14 }}>
            {FORMATS.map(({ value, label, ext }) => (
              <button
                key={value}
                onClick={() => setFormat(value)}
                style={{
                  flex: 1, padding: '10px 8px',
                  border: `1px solid ${format === value ? 'var(--accent)' : 'var(--border)'}`,
                  background: format === value ? 'var(--accent-dim)' : 'var(--surface-2)',
                  cursor: 'pointer', textAlign: 'center', transition: 'all 0.1s',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: format === value ? 'var(--accent)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {label}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                  {ext}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <DetailRow label="Package"    value={d.pkg}    />
            <DetailRow label="Layers"     value={d.layers} />
            <DetailRow label="Background" value={d.bg}     />
            <DetailRow label="Reg Marks"  value={d.marks}  />
          </div>
        </div>

        {/* File name */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
            File Name
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="filename"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                padding: '7px 10px', fontSize: 12, color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <span style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
              {fmt.ext}
            </span>
          </div>
        </div>

        {/* Color info toggle — not applicable for vector */}
        {!isVector && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Color Reference
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                Include a color swatch sheet with hex codes
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={includeColorInfo}
                onChange={e => setIncludeColorInfo(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {includeColorInfo ? 'On' : 'Off'}
              </span>
            </label>
          </div>
        )}

        {/* Pantone names toggle — not applicable for vector or CMYK */}
        {!isVector && !isCmyk && !isCmykPro && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Pantone Names
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                Convert layer names to nearest PMS Coated code
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0 }}>
              <input
                type="checkbox"
                checked={usePantoneNames}
                onChange={e => setUsePantoneNames(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {usePantoneNames ? 'On' : 'Off'}
              </span>
            </label>
          </div>
        )}

        {/* Underbase — not for vector mode */}
        {!isVector && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: includeUnderbase ? 10 : 0 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  White Underbase
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                  All inks flattened to white · exported as bottom layer
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flexShrink: 0, marginLeft: 12 }}>
                <input
                  type="checkbox"
                  checked={includeUnderbase}
                  onChange={e => setIncludeUnderbase(e.target.checked)}
                  style={{ accentColor: 'var(--accent)', width: 13, height: 13, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {includeUnderbase ? 'On' : 'Off'}
                </span>
              </label>
            </div>
            {includeUnderbase && (
              <div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Choke (shrink inward)
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([0, 1, 2] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setUndChoke(n)}
                      style={{
                        flex: 1, padding: '8px 6px',
                        border: `1px solid ${undChoke === n ? 'var(--accent)' : 'var(--border)'}`,
                        background: undChoke === n ? 'var(--accent-dim)' : 'var(--surface-2)',
                        cursor: 'pointer', textAlign: 'center', transition: 'all 0.1s',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: undChoke === n ? 'var(--accent)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                        {n === 0 ? 'None' : `${n}px`}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                        {n === 0 ? 'No choke' : n === 1 ? 'Standard' : 'Heavy'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Export error */}
        {exportError && (
          <div style={{ margin: '0 16px 12px', padding: '8px 10px', background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.3)', fontSize: 11, color: '#ff5050', fontFamily: 'var(--font-mono)' }}>
            Export failed: {exportError}
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : `Export ${fmt.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', width: 100, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}
