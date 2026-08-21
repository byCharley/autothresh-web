import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { calcLayout, DTF_PRESETS, SUBLIMATION_PRESETS, displayVal, cmToIn, inToCm } from '../engine/sheetEngine';

export type ExportFormat = 'png' | 'jpg' | 'psd' | 'pdf' | 'tiff' | 'svg' | 'eps' | 'cdr';

export interface ExportConfig {
  mode:             'screen' | 'dtg';
  format:           ExportFormat;
  fileName:         string;
  includeColorInfo: boolean;
  usePantoneNames:  boolean;
  underbase:        boolean;
  underbaseChoke:   number;
  cropToArtwork:    boolean;
  withFabricView:   boolean;
}

interface Props {
  onClose:           () => void;
  onExport:          (config: ExportConfig) => Promise<void>;
  onGenerateSheet?:  () => Promise<void>;
  generatingSheet?:  boolean;
  defaultFileName:   string;
  separationMode?:   string;
}

const SMONO: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

const sheetChipBtn = (active: boolean): React.CSSProperties => ({
  flex: 1, height: 28, fontSize: 9, ...SMONO, letterSpacing: '0.04em',
  border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
  borderRadius: 3, cursor: 'pointer',
  background: active ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)',
  color: active ? 'var(--accent)' : 'var(--text-dim)',
  transition: 'all 0.12s', whiteSpace: 'nowrap' as const,
});

function SheetNumStepper({ value, step = 0.1, min = 0, onUp, onDown, onChange, unit }: {
  value: number; step?: number; min?: number;
  onUp: () => void; onDown: () => void;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button style={{ width: 24, height: 26, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text-dim)', borderRadius: 3, cursor: 'pointer', flexShrink: 0 }} onClick={onDown}>&minus;</button>
      <input type="number" step={step} value={value} style={{ width: 50, height: 26, textAlign: 'center', fontSize: 11, background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text)', borderRadius: 3, ...SMONO }}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= min) onChange(v); }} />
      <button style={{ width: 24, height: 26, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid var(--border-2)', color: 'var(--text-dim)', borderRadius: 3, cursor: 'pointer', flexShrink: 0 }} onClick={onUp}>+</button>
      {unit && <span style={{ fontSize: 9, color: 'var(--text-dim)', ...SMONO, marginLeft: 2 }}>{unit}</span>}
    </div>
  );
}

const FORMATS_ALL: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'png',  label: 'PNG',  ext: '.png'  },
  { value: 'psd',  label: 'PSD',  ext: '.psd'  },
  { value: 'pdf',  label: 'PDF',  ext: '.pdf'  },
  { value: 'tiff', label: 'TIFF', ext: '.tiff' },
  { value: 'eps',  label: 'EPS',  ext: '.eps'  },
  { value: 'cdr',  label: 'CDR',  ext: '.zip'  },
];

const FORMATS_DITHER: { value: ExportFormat; label: string; ext: string }[] = [
  { value: 'png', label: 'PNG', ext: '.png' },
  { value: 'psd', label: 'PSD', ext: '.psd' },
  { value: 'pdf', label: 'PDF', ext: '.pdf' },
  { value: 'eps', label: 'EPS', ext: '.eps' },
];

function details(mode: 'screen' | 'dtg', format: ExportFormat, isDither: boolean, showFabricBg = false, canvasColor = '#000000') {
  if (format === 'cdr') {
    if (mode === 'screen' && !isDither) {
      return { pkg: 'ZIP archive', layers: 'One EPS per separation, spot-color DSC headers + import guide', bg: 'Transparent', marks: 'Included' };
    } else {
      return { pkg: 'ZIP archive', layers: 'Composite EPS with CorelDRAW import guide', bg: 'White', marks: 'Not included' };
    }
  }
  if (isDither) {
    const canvasBg = showFabricBg ? `Canvas (${canvasColor})` : 'Transparent';
    switch (format) {
      case 'png':  return { pkg: 'Single file', layers: 'Dithered composite image',        bg: canvasBg, marks: 'Not included' };
      case 'psd':  return { pkg: 'Single file', layers: 'One colored layer per ink zone',  bg: canvasBg, marks: 'Not included' };
      case 'pdf':  return { pkg: 'Single file', layers: 'Dithered composite page',         bg: canvasBg, marks: 'Not included' };
      case 'tiff': return { pkg: 'Single file', layers: 'Dithered composite image',        bg: canvasBg, marks: 'Not included' };
      case 'eps':  return { pkg: 'Single file', layers: 'Composite RGB EPS',               bg: canvasBg, marks: 'Not included' };
    }
  }
  if (format === 'eps') {
    if (mode === 'screen') {
      return { pkg: 'ZIP archive', layers: 'One grayscale EPS per separation + underbase', bg: 'Transparent', marks: 'Included' };
    } else {
      return { pkg: 'Single file', layers: 'Composite RGB EPS', bg: 'White', marks: 'Not included' };
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
  return { pkg: 'Single file', layers: 'Composite image', bg: 'Transparent', marks: 'Not included' };
}

const FORMATS_PASSTHROUGH = [{ value: 'png' as ExportFormat, label: 'PNG', ext: '.png' }];
const FORMATS_TEXTURE = [
  { value: 'png' as ExportFormat, label: 'PNG', ext: '.png' },
  { value: 'jpg' as ExportFormat, label: 'JPG', ext: '.jpg' },
];

export function ExportModal({ onClose, onExport, onGenerateSheet, generatingSheet, defaultFileName, separationMode }: Props) {
  const { passthroughMode, sheetSettings, updateSheetSettings, originalImage, dtgPaintMask, dtgPaintMaskDims, showFabricBg, canvasColor } = useStore();
  const isDither  = !passthroughMode && separationMode === 'palette';
  const isCmykPro = separationMode === 'cmyk-pro';
  const isTexture = separationMode === 'texture';
  const isDtg     = separationMode === 'dtg';
  const FORMATS  = passthroughMode ? FORMATS_PASSTHROUGH
    : isTexture  ? FORMATS_TEXTURE
    : isDither   ? FORMATS_DITHER
    : FORMATS_ALL;

  const [mode,             setMode]             = useState<'screen' | 'dtg'>((isDither || isDtg) ? 'dtg' : 'screen');
  const [format,           setFormat]           = useState<ExportFormat>(passthroughMode ? 'png' : 'png');
  const [fileName,         setFileName]         = useState(defaultFileName);
  const [cropToArtwork,    setCropToArtwork]    = useState(true);
  const [withFabricView,   setWithFabricView]   = useState(false);
  const { underbaseEnabled, underbaseChoke: storeChoke, setUnderbaseEnabled, setUnderbaseChoke } = useStore();
  const [exporting,        setExporting]        = useState(false);
  const [exportError,      setExportError]      = useState<string | null>(null);
  const [includeColorInfo, setIncludeColorInfo] = useState(false);
  const [usePantoneNames] = useState(false);
  const includeUnderbase = underbaseEnabled;
  const undChoke         = storeChoke;
  const setIncludeUnderbase = setUnderbaseEnabled;
  const setUndChoke         = setUnderbaseChoke;

  // Sheet builder state (only active when isDtg)
  const [dtgTab,         setDtgTab]        = useState<'export' | 'sheet'>('export');
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Sheet preview drawing
  const { unit, sheetWidthIn, sheetHeightIn, quantity, spacingIn, dpi, rotateDesign } = sheetSettings;
  const artAspect = originalImage ? originalImage.height / originalImage.width : 1;
  const sheetLayout = calcLayout(sheetSettings, artAspect);

  useEffect(() => {
    if (!isDtg || dtgTab !== 'sheet' || !previewCanvasRef.current) return;
    const c = previewCanvasRef.current;
    const ctx = c.getContext('2d')!;
    const { designWidthIn, designHeightIn } = sheetLayout;
    const fpW = rotateDesign ? designHeightIn : designWidthIn;
    const fpH = rotateDesign ? designWidthIn : designHeightIn;
    const W = 400;
    const H = Math.max(1, Math.round(W * fpH / Math.max(0.001, fpW)));
    c.width = W; c.height = H;
    ctx.clearRect(0, 0, W, H);

    if (originalImage) {
      // Work at mask resolution if available so per-pixel masking aligns exactly
      const mW = dtgPaintMaskDims?.w ?? originalImage.width;
      const mH = dtgPaintMaskDims?.h ?? originalImage.height;

      // Scale originalImage → mask/source dimensions
      const rawCanvas = document.createElement('canvas');
      rawCanvas.width = originalImage.width; rawCanvas.height = originalImage.height;
      rawCanvas.getContext('2d')!.putImageData(originalImage, 0, 0);

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = mW; srcCanvas.height = mH;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.drawImage(rawCanvas, 0, 0, mW, mH);

      // Apply DTG paint mask — value 2 = background (transparent)
      if (dtgPaintMask && dtgPaintMaskDims && dtgPaintMaskDims.w === mW && dtgPaintMaskDims.h === mH) {
        const imgData = srcCtx.getImageData(0, 0, mW, mH);
        for (let i = 0; i < dtgPaintMask.length; i++) {
          if (dtgPaintMask[i] === 2) imgData.data[i * 4 + 3] = 0;
        }
        srcCtx.putImageData(imgData, 0, 0);
      }

      if (rotateDesign) {
        ctx.save(); ctx.translate(W, 0); ctx.rotate(Math.PI / 2);
        ctx.drawImage(srcCanvas, 0, 0, H, W);
        ctx.restore();
      } else {
        ctx.drawImage(srcCanvas, 0, 0, W, H);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDtg, dtgTab, sheetSettings, originalImage, dtgPaintMask, dtgPaintMaskDims, rotateDesign, sheetLayout.designWidthIn, sheetLayout.designHeightIn]);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    await new Promise(r => setTimeout(r, 60));
    try {
      await onExport({ mode: (isDither || isTexture || isDtg) ? 'dtg' : mode, format, fileName: fileName.trim() || defaultFileName, includeColorInfo, usePantoneNames, underbase: includeUnderbase, underbaseChoke: undChoke, cropToArtwork, withFabricView: false });
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const d = details(mode, format, isDither, showFabricBg, canvasColor);
  const fmt = FORMATS.find(f => f.value === format) ?? FORMATS[0];
  // EPS/CDR in screen mode export a ZIP; show the correct extension in the filename bar
  const displayExt = ((format === 'eps' && !isDither && mode === 'screen') || format === 'cdr') ? '.zip' : fmt.ext;

  // ── Passthrough modal: stripped to filename + export only ─────────────────────
  if (passthroughMode) {
    return (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={onClose}
      >
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: 380, maxWidth: '92vw', zIndex: 41 }} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              Export — Passthrough
            </span>
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          {/* Notice */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/>
            </svg>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', lineHeight: 1.5 }}>
              Passthrough mode — single PNG with textures applied.
            </span>
          </div>
          {/* Filename */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
              File Name
            </div>
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <input
                type="text"
                value={fileName}
                onChange={e => setFileName(e.target.value)}
                placeholder="filename"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', padding: '7px 10px', fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}
              />
              <span style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
                .png
              </span>
            </div>
          </div>
          {/* Export button */}
          <div style={{ padding: '12px 16px' }}>
            {exportError && <div style={{ fontSize: 10, color: '#e05050', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>{exportError}</div>}
            <button
              className="btn btn-primary"
              style={{ width: '100%', height: 36, fontSize: 12, color: '#1a1a1a' }}
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                setExportError(null);
                await new Promise(r => setTimeout(r, 60));
                try {
                  await onExport({ mode: 'dtg', format: 'png', fileName: fileName.trim() || defaultFileName, includeColorInfo: false, usePantoneNames: false, underbase: false, underbaseChoke: 0, cropToArtwork: false, withFabricView: false });
                  onClose();
                } catch (err) {
                  setExportError(err instanceof Error ? err.message : String(err));
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? 'Exporting…' : 'Export PNG'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── DTG modal: Export PNG tab + Build Sheet tab ──────────────────────────
  if (isDtg) {
    const doExport = async () => {
      setExporting(true);
      setExportError(null);
      await new Promise(r => setTimeout(r, 60));
      try {
        await onExport({ mode: 'dtg', format: 'png', fileName: fileName.trim() || defaultFileName, includeColorInfo: false, usePantoneNames: false, underbase: false, underbaseChoke: 0, cropToArtwork, withFabricView });
        onClose();
      } catch (err) {
        setExportError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    };

    const u = unit;
    const step = u === 'cm' ? 0.5 : 0.1;
    const dispW = displayVal(sheetWidthIn, u);
    const dispH = displayVal(sheetHeightIn, u);
    const dispS = displayVal(spacingIn, u);
    function setSheetW(v: number) { updateSheetSettings({ sheetWidthIn: u === 'cm' ? cmToIn(v) : v }); }
    function setSheetH(v: number) { updateSheetSettings({ sheetHeightIn: u === 'cm' ? cmToIn(v) : v }); }
    function setSpacing(v: number) { updateSheetSettings({ spacingIn: u === 'cm' ? cmToIn(v) : v }); }
    const copySize = `${displayVal(sheetLayout.designWidthIn, u).toFixed(2)} × ${displayVal(sheetLayout.designHeightIn, u).toFixed(2)} ${u}`;
    const canGenSheet = sheetLayout.perSheet > 0 && !!originalImage && !!onGenerateSheet;

    const tabStyle = (active: boolean): React.CSSProperties => ({
      flex: 1, height: 36, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      background: 'none', cursor: 'pointer',
      color: active ? 'var(--accent)' : 'var(--text-dim)',
      transition: 'all 0.12s',
    });

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }} onClick={onClose}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '100%', maxWidth: dtgTab === 'sheet' ? 480 : 420, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 2, zIndex: 41 }} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>Export — DTG / DTF</span>
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <button style={tabStyle(dtgTab === 'export')} onClick={() => setDtgTab('export')}>Export PNG</button>
            <button style={tabStyle(dtgTab === 'sheet')} onClick={() => setDtgTab('sheet')}>Build Sheet</button>
          </div>

          {/* ── Export PNG tab ─────────────────────────────────── */}
          {dtgTab === 'export' && (
            <>
              {/* Filename */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>File Name</div>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <input type="text" value={fileName} onChange={e => setFileName(e.target.value)} placeholder="filename"
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', padding: '7px 10px', fontSize: 12, color: 'var(--text)', fontFamily: 'var(--font-mono)' }} />
                  <span style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', borderLeft: '1px solid var(--border)', flexShrink: 0 }}>.png</span>
                </div>
              </div>
              {/* Crop + Fabric view toggles */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  { label: 'Crop to Image', desc: 'Export artwork bounds only, no canvas padding', val: cropToArtwork, set: setCropToArtwork },
                  { label: 'Realistic Fabric View', desc: 'Composite artwork over garment color with fabric texture', val: withFabricView, set: setWithFabricView },
                ] as const).map(({ label, desc, val, set }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{desc}</div>
                    </div>
                    <button onClick={() => set(!val)} style={{ flexShrink: 0, height: 26, padding: '0 12px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', borderRadius: 3, cursor: 'pointer', transition: 'all 0.12s', border: val ? '1.5px solid var(--accent)' : '1px solid var(--border-2)', background: val ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)', color: val ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {val ? 'On' : 'Off'}
                    </button>
                  </div>
                ))}
              </div>
              {/* Export button */}
              <div style={{ padding: '12px 16px' }}>
                {exportError && <div style={{ fontSize: 10, color: '#e05050', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>{exportError}</div>}
                <button className="btn btn-primary" style={{ width: '100%', height: 36, fontSize: 12, color: '#1a1a1a' }} disabled={exporting} onClick={doExport}>
                  {exporting ? 'Exporting…' : 'Export PNG'}
                </button>
              </div>
            </>
          )}

          {/* ── Build Sheet tab ────────────────────────────────── */}
          {dtgTab === 'sheet' && (
            <>
              <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Presets */}
                <div>
                  <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>DTF Film</div>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
                    {DTF_PRESETS.map(p => (
                      <button key={p.label} style={sheetChipBtn(Math.abs(sheetWidthIn - p.widthIn) < 0.1)}
                        onClick={() => updateSheetSettings({ sheetWidthIn: p.widthIn, sheetHeightIn: p.heightIn })}>
                        {u === 'cm' ? `${inToCm(p.widthIn).toFixed(0)}cm` : p.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5 }}>Sublimation</div>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {SUBLIMATION_PRESETS.map(p => {
                      const active = Math.abs(sheetWidthIn - p.widthIn) < 0.1 && Math.abs(sheetHeightIn - p.heightIn) < 0.1;
                      return (
                        <button key={p.label} style={sheetChipBtn(active)}
                          onClick={() => updateSheetSettings({ sheetWidthIn: p.widthIn, sheetHeightIn: p.heightIn })}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Dimensions + Quantity + Spacing */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Sheet Width</div>
                    <SheetNumStepper value={dispW} step={step} onUp={() => setSheetW(parseFloat((dispW + step).toFixed(2)))} onDown={() => setSheetW(parseFloat((Math.max(step, dispW - step)).toFixed(2)))} onChange={setSheetW} unit={u} />
                  </div>
                  <div>
                    <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Sheet Height</div>
                    <SheetNumStepper value={dispH} step={step} onUp={() => setSheetH(parseFloat((dispH + step).toFixed(2)))} onDown={() => setSheetH(parseFloat((Math.max(step, dispH - step)).toFixed(2)))} onChange={setSheetH} unit={u} />
                  </div>
                  <div>
                    <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Copies</div>
                    <SheetNumStepper value={quantity} step={1} min={1} onUp={() => updateSheetSettings({ quantity: quantity + 1 })} onDown={() => updateSheetSettings({ quantity: Math.max(1, quantity - 1) })} onChange={v => updateSheetSettings({ quantity: Math.max(1, Math.round(v)) })} />
                  </div>
                  <div>
                    <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Spacing</div>
                    <SheetNumStepper value={dispS} step={step} min={0} onUp={() => setSpacing(parseFloat((dispS + step).toFixed(2)))} onDown={() => setSpacing(parseFloat((Math.max(0, dispS - step)).toFixed(2)))} onChange={setSpacing} unit={u} />
                  </div>
                </div>

                {/* Options + DPI + Unit */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
                  {(['in', 'cm'] as const).map(v => (
                    <button key={v} onClick={() => updateSheetSettings({ unit: v })} style={{ ...sheetChipBtn(u === v), flex: 'none', width: 30, height: 24, fontSize: 8 }}>{v}</button>
                  ))}
                  {([150, 300] as const).map(d => (
                    <button key={d} onClick={() => updateSheetSettings({ dpi: d })} style={{ ...sheetChipBtn(dpi === d), flex: 'none', padding: '0 7px', height: 24, fontSize: 8 }}>{d}dpi</button>
                  ))}
                </div>

                {/* Layout stats */}
                <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 3, padding: '10px 12px' }}>
                  {sheetLayout.perSheet > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        ['Grid', `${sheetLayout.cols}×${sheetLayout.rows}`],
                        ['Per Sheet', `${sheetLayout.perSheet}`],
                        ['Sheets', `${sheetLayout.sheets}`],
                        ['Copy Size', copySize],
                        ['Used', `${sheetLayout.usedAreaIn2.toFixed(0)} in²`],
                        ['Waste', `${sheetLayout.wastedAreaIn2.toFixed(0)} in²`],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{k}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, ...SMONO, color: 'var(--text)' }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: '#ff4d4f', ...SMONO, textAlign: 'center' }}>Doesn't fit — reduce copies or increase sheet size.</div>
                  )}
                </div>

                {/* Preview */}
                <div>
                  <div style={{ fontSize: 8, ...SMONO, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Preview (1 copy)</div>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', background: 'repeating-conic-gradient(#c0c0c0 0% 25%, #f0f0f0 0% 50%) 0 0 / 12px 12px' }}>
                    <canvas ref={previewCanvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
                    {!originalImage && (
                      <div style={{ padding: 24, textAlign: 'center', fontSize: 10, ...SMONO, color: 'var(--text-muted)' }}>Upload artwork to preview</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sheet footer */}
              <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={onClose} style={{ flex: 1, height: 34, fontSize: 9, ...SMONO, letterSpacing: '0.06em', border: '1px solid var(--border-2)', borderRadius: 3, cursor: 'pointer', background: 'var(--surface-2)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                  Cancel
                </button>
                <button onClick={onGenerateSheet} disabled={generatingSheet || !canGenSheet}
                  style={{ flex: 2, height: 34, fontSize: 9, ...SMONO, letterSpacing: '0.06em', border: 'none', borderRadius: 3, cursor: generatingSheet || !canGenSheet ? 'not-allowed' : 'pointer', background: generatingSheet || !canGenSheet ? 'var(--surface-2)' : 'var(--accent)', color: generatingSheet || !canGenSheet ? 'var(--text-muted)' : '#fff', textTransform: 'uppercase', fontWeight: 700, transition: 'background 0.15s' }}>
                  {generatingSheet ? 'Generating…' : 'Generate Sheet PNG'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

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
            {passthroughMode ? 'Export — Passthrough' : isDither ? 'Export — Dither' : isCmykPro ? 'Export — CMYK Pro' : isTexture ? 'Export — Texture' : 'Export'}
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Passthrough notice */}
        {passthroughMode && (
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--accent-dim)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/>
            </svg>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', lineHeight: 1.5 }}>
              Passthrough mode active — exporting original image with textures only. PNG only.
            </span>
          </div>
        )}

        {/* Texture notice */}
        {isTexture && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
            </svg>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', lineHeight: 1.5 }}>
              Texture mode — exports a flat composite image. PNG (transparent bg) or JPG (white bg).
            </span>
          </div>
        )}

        {/* Mode selector — hidden for Dither, CMYK Pro, Texture, and Passthrough */}
        {!isDither && !isCmykPro && !isTexture && !passthroughMode && (
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
              {displayExt}
            </span>
          </div>
        </div>

        {/* Color info toggle */}
        {!isTexture && (
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

        {/* Pantone names toggle hidden pending licensing */}

        {/* Underbase */}
        {!isTexture && (
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
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setUndChoke(n)}
                      style={{
                        flex: 1, padding: '7px 4px',
                        border: `1px solid ${undChoke === n ? 'var(--accent)' : 'var(--border)'}`,
                        background: undChoke === n ? 'var(--accent-dim)' : 'var(--surface-2)',
                        cursor: 'pointer', textAlign: 'center', transition: 'all 0.1s',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: undChoke === n ? 'var(--accent)' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                        {n === 0 ? 'Off' : `${n}px`}
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
            {exporting ? 'Exporting…' : format === 'cdr' ? 'Export CorelDRAW (ZIP)' : format === 'eps' && !isDither && mode === 'screen' ? 'Export EPS (ZIP)' : `Export ${fmt.label}`}
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
