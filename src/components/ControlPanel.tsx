import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { PatternType } from '../engine/imageProcessor';
import { autoDetectPatternSettings } from '../engine/imageProcessor';

// ─── Primitives ───────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="control-section">
      <div className="control-section-header" onClick={() => setOpen(!open)}>
        <span className="section-label">{title}</span>
        <ChevronIcon open={open} />
      </div>
      {open && <div className="control-section-body">{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label" style={{ flex: 1 }}>{label}</span>
        <span className="field-value">{step < 1 ? value.toFixed(1) : value}{unit}</span>
      </div>
      <div className="slider-track">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    </div>
  );
}

function DualRangeSlider({ valueMin, valueMax, onChange }: {
  valueMin: number; valueMax: number;
  onChange: (min: number, max: number) => void;
}) {
  const pctMin = (valueMin / 255) * 100;
  const pctMax = (valueMax / 255) * 100;
  return (
    <div className="dual-range">
      <div className="dual-range-track" />
      <div className="dual-range-fill" style={{ left: `${pctMin}%`, width: `${pctMax - pctMin}%` }} />
      <input type="range" min={0} max={255} value={valueMin}
        onChange={(e) => onChange(Math.min(Number(e.target.value), valueMax - 1), valueMax)} />
      <input type="range" min={0} max={255} value={valueMax}
        onChange={(e) => onChange(valueMin, Math.max(Number(e.target.value), valueMin + 1))} />
    </div>
  );
}

function SwitchRow({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <div className="field">
      <div className="field-row" style={{ justifyContent: 'space-between' }}>
        <span className="field-label">{label}</span>
        <label className="switch" style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <div className="switch-track" /><div className="switch-thumb" />
        </label>
      </div>
      {hint && <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ─── Pattern controls (reusable) ─────────────────────────────────────────────

const PATTERN_LABELS: Record<PatternType, string> = {
  'none':                'None (Solid fill)',
  'noise':               'Noise · Standard',
  'noise-coarse':        'Noise · Coarse',
  'noise-texture':       'Noise · Texture',
  'grain':               'Noise · Standard',
  'grain-soft':          'Noise · Standard',
  'grain-coarse':        'Noise · Coarse',
  'halftone-round':      'Halftone · Round',
  'halftone-diamond':    'Halftone · Diamond',
  'halftone-ellipse':    'Halftone · Ellipse',
  'halftone-line':       'Line · AM (thickness varies)',
  'halftone-line-am':    'Line · AM Smooth',
  'halftone-line-fm':    'Line · FM (spacing varies)',
  'halftone-crosshatch': 'Line · Crosshatch',
  'halftone-wave':       'Line · Wave',
  'halftone-square':     'Halftone · Square',
  'halftone-cross':      'Halftone · Cross',
  'reticulation':        'Reticulation',
  'bayer-2':             'Bayer · 2×2',
  'bayer-4':             'Bayer · 4×4',
  'bayer-8':             'Bayer · 8×8',
};

function PatternSelect({ value, onChange }: { value: PatternType; onChange: (v: PatternType) => void }) {
  return (
    <select className="at-select" value={value} onChange={(e) => onChange(e.target.value as PatternType)}>
      <option value="none">None (Solid fill)</option>
      <optgroup label="─ Noise ─">
        <option value="noise">Noise · Standard</option>
        <option value="noise-coarse">Noise · Coarse</option>
        <option value="noise-texture">Noise · Texture</option>
      </optgroup>
      <optgroup label="─ Halftone Dots ─">
        <option value="halftone-round">Halftone · Round</option>
        <option value="halftone-diamond">Halftone · Diamond</option>
        <option value="halftone-ellipse">Halftone · Ellipse</option>
        <option value="halftone-square">Halftone · Square</option>
        <option value="halftone-cross">Halftone · Cross</option>
      </optgroup>
      <optgroup label="─ Line Screen ─">
        <option value="halftone-line">Line · AM (thickness varies)</option>
        <option value="halftone-line-am">Line · AM Smooth</option>
        <option value="halftone-line-fm">Line · FM (spacing varies)</option>
        <option value="halftone-crosshatch">Line · Crosshatch</option>
        <option value="halftone-wave">Line · Wave</option>
      </optgroup>
      <optgroup label="─ Texture ─">
        <option value="reticulation">Reticulation</option>
      </optgroup>
      <optgroup label="─ Ordered Dither ─">
        <option value="bayer-2">Bayer · 2×2</option>
        <option value="bayer-4">Bayer · 4×4</option>
        <option value="bayer-8">Bayer · 8×8</option>
      </optgroup>
    </select>
  );
}

function PatternControls({
  pattern, scale, density, angle,
  onPattern, onScale, onDensity, onAngle,
}: {
  pattern: PatternType;
  scale: number; density: number; angle: number;
  onPattern: (v: PatternType) => void;
  onScale: (v: number) => void;
  onDensity: (v: number) => void;
  onAngle: (v: number) => void;
}) {
  const isHalftone = pattern.startsWith('halftone-');
  const isGrain = pattern.startsWith('grain') || pattern.startsWith('noise');
  const hasPattern = pattern !== 'none';
  const scaleMin  = isGrain ? 0.5 : 1;
  const scaleMax  = isGrain ? 6  : 40;
  const scaleStep = isGrain ? 0.5 : 1;
  return (
    <>
      <div className="field">
        <span className="field-label">Type</span>
        <PatternSelect value={pattern} onChange={onPattern} />
      </div>
      {hasPattern && (
        <>
          <Slider label="Scale" value={Math.min(scale, scaleMax)} min={scaleMin} max={scaleMax} step={scaleStep} onChange={onScale} />
          <Slider label="Density" value={density} min={5} max={100} onChange={onDensity} unit="%" />
          {isHalftone && (
            <Slider label="Angle" value={angle} min={0} max={180} onChange={onAngle} unit="°" />
          )}
        </>
      )}
    </>
  );
}

// ─── Global Pattern Section ───────────────────────────────────────────────────

function GlobalPatternSection() {
  const { globalPattern, updateGlobalPattern, previewImage, originalImage } = useStore();

  const handleAutoDetect = () => {
    if (!previewImage) return;
    updateGlobalPattern(autoDetectPatternSettings(previewImage, originalImage));
  };

  return (
    <Section title="Global Pattern" defaultOpen={true}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.5 }}>
          Applies to all layers
        </span>
        {previewImage && (
          <button
            className="btn btn-ghost"
            style={{ fontSize: 10, padding: '2px 8px', height: 22 }}
            onClick={handleAutoDetect}
            title="Auto-detect best grain settings for this image"
          >
            Auto Detect
          </button>
        )}
      </div>
      <PatternControls
        pattern={globalPattern.pattern}
        scale={globalPattern.patternScale}
        density={globalPattern.patternDensity}
        angle={globalPattern.patternAngle}
        onPattern={(v) => updateGlobalPattern({ pattern: v })}
        onScale={(v) => updateGlobalPattern({ patternScale: v })}
        onDensity={(v) => updateGlobalPattern({ patternDensity: v })}
        onAngle={(v) => updateGlobalPattern({ patternAngle: v })}
      />
    </Section>
  );
}

// ─── Image Adjustments Section ────────────────────────────────────────────────

function ImageAdjustmentsSection() {
  const { originalImage, imageAdjustments, setImageAdjustment, resetImageAdjustments } = useStore();
  if (!originalImage) return null;

  const adj = imageAdjustments;
  const isDirty = adj.exposure !== 0 || adj.contrast !== 0 || adj.shadows !== 0 || adj.highlights !== 0 || adj.blur !== 0;

  return (
    <Section title="Image Adjustments" defaultOpen={false}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          Applied before separation
        </span>
        {isDirty && (
          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px', height: 22 }}
            onClick={resetImageAdjustments}>Reset</button>
        )}
      </div>
      <Slider label="Exposure" value={adj.exposure} min={-100} max={100}
        onChange={(v) => setImageAdjustment('exposure', v)} />
      <Slider label="Contrast" value={adj.contrast} min={-100} max={100}
        onChange={(v) => setImageAdjustment('contrast', v)} />
      <Slider label="Shadows" value={adj.shadows} min={-100} max={100}
        onChange={(v) => setImageAdjustment('shadows', v)} />
      <Slider label="Highlights" value={adj.highlights} min={-100} max={100}
        onChange={(v) => setImageAdjustment('highlights', v)} />
      <Slider label="Pre-blur" value={adj.blur} min={0} max={15}
        onChange={(v) => setImageAdjustment('blur', v)} />
    </Section>
  );
}

// ─── Document Setup ───────────────────────────────────────────────────────────

const DPI_OPTIONS = [72, 96, 150, 300, 600] as const;

const DOC_PRESETS = [
  { label: '10×10"', w: 10, h: 10 },
  { label: '12×14"', w: 12, h: 14 },
  { label: '14×16"', w: 14, h: 16 },
  { label: '16×20"', w: 16, h: 20 },
  { label: 'Letter', w: 8.5, h: 11 },
  { label: 'A4', w: 8.27, h: 11.69 },
] as const;

function DocumentSection() {
  const {
    documentDpi, setDocumentDpi,
    documentWidthIn, documentHeightIn,
    setDocumentWidth, setDocumentHeight,
    showRegistrationMarks, setShowRegistrationMarks,
    regMarkPadding, setRegMarkPadding,
    originalImage, globalPattern,
  } = useStore();

  const docPxW = Math.round(documentWidthIn * documentDpi);
  const docPxH = Math.round(documentHeightIn * documentDpi);
  const lpi = Math.round(documentDpi / Math.max(1, globalPattern.patternScale));

  // Artwork dimensions at current DPI
  const artWIn = originalImage ? (originalImage.width / documentDpi).toFixed(2) : null;
  const artHIn = originalImage ? (originalImage.height / documentDpi).toFixed(2) : null;

  return (
    <Section title="Document Setup" defaultOpen={true}>
      {/* Presets */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {DOC_PRESETS.map((p) => (
          <button
            key={p.label}
            className="btn btn-ghost"
            style={{
              fontSize: 10, padding: '2px 7px', height: 22,
              background: documentWidthIn === p.w && documentHeightIn === p.h ? 'var(--accent)' : undefined,
              color: documentWidthIn === p.w && documentHeightIn === p.h ? '#000' : undefined,
            }}
            onClick={() => { setDocumentWidth(p.w); setDocumentHeight(p.h); }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Width × Height */}
      <div className="field">
        <span className="field-label">Size</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" className="at-input"
            value={documentWidthIn} min={0.5} max={60} step={0.5}
            style={{ width: 58 }}
            onChange={(e) => setDocumentWidth(parseFloat(e.target.value) || documentWidthIn)}
          />
          <span style={{ color: 'var(--text-dim)', fontSize: 12, flexShrink: 0 }}>×</span>
          <input
            type="number" className="at-input"
            value={documentHeightIn} min={0.5} max={60} step={0.5}
            style={{ width: 58 }}
            onChange={(e) => setDocumentHeight(parseFloat(e.target.value) || documentHeightIn)}
          />
          <span style={{ color: 'var(--text-dim)', fontSize: 11, flexShrink: 0 }}>in</span>
        </div>
      </div>

      {/* DPI */}
      <div className="field">
        <span className="field-label">Output DPI</span>
        <select className="at-select" value={documentDpi}
          onChange={(e) => setDocumentDpi(Number(e.target.value))}>
          {DPI_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} DPI{d === 300 ? ' · standard' : d === 72 ? ' · screen' : d === 600 ? ' · hi-res' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Info */}
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.8, marginTop: 4 }}>
        <div>Output: {docPxW.toLocaleString()} × {docPxH.toLocaleString()} px</div>
        <div>Pattern: {globalPattern.patternScale}px scale → ~{lpi} LPI</div>
        {artWIn && artHIn && (
          <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>
            Artwork: {artWIn}" × {artHIn}" @ {documentDpi} DPI
          </div>
        )}
      </div>

      {/* Registration Marks — tied to document corners */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10 }}>
        <SwitchRow
          label="Registration Marks"
          checked={showRegistrationMarks}
          onChange={setShowRegistrationMarks}
          hint={showRegistrationMarks ? 'Shown at document corners — visible in preview and baked into export' : undefined}
        />
        {showRegistrationMarks && (
          <Slider
            label="Padding"
            value={regMarkPadding}
            min={0.1} max={2.0} step={0.1}
            onChange={setRegMarkPadding}
            unit='"'
          />
        )}
      </div>
    </Section>
  );
}

// ─── CMYK Screen Section ──────────────────────────────────────────────────────

function CmykScreenSection() {
  const { separationMode, cmykLpi, setCmykLpi, documentDpi } = useStore();
  if (separationMode !== 'cmyk') return null;
  const dotPx = (documentDpi / cmykLpi).toFixed(1);
  return (
    <Section title="CMYK Screen">
      <Slider label="Screen Ruling" value={cmykLpi} min={25} max={85} step={5}
        onChange={setCmykLpi} unit=" LPI" />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.8, marginTop: 4 }}>
        <div>~{dotPx}px per dot @ {documentDpi} DPI</div>
        <div>K 45° · C 15° · M 75° · Y 90°</div>
      </div>
    </Section>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ControlPanel() {
  const { layers, selectedLayerId, updateLayer, globalPattern, originalImage, separationMode } = useStore();
  const layer = layers.find((l) => l.id === selectedLayerId);

  if (!originalImage) {
    return (
      <aside className="panel-right">
        <div className="panel-header"><span className="panel-title">Controls</span></div>
        <div className="control-scroll">
          <DocumentSection />
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel-right">
      <div className="panel-header">
        {separationMode === 'cmyk' ? (
          <span className="panel-title">CMYK</span>
        ) : layer ? (
          <>
            <span className="panel-title">{layer.name}</span>
            <div style={{ width: 14, height: 14, background: layer.color, border: '1px solid var(--border-2)' }} />
          </>
        ) : (
          <span className="panel-title">Controls</span>
        )}
      </div>

      <div className="control-scroll">
        <DocumentSection />
        {separationMode === 'cmyk' ? <CmykScreenSection /> : <GlobalPatternSection />}
        <ImageAdjustmentsSection />

        {/* Per-layer controls — threshold mode only */}
        {separationMode === 'threshold' && layer ? (
          <>
            <Section title="Color">
              <div className="field">
                <span className="field-label">Ink Color</span>
                <div className="color-field">
                  <div className="color-swatch-btn" style={{ background: layer.color }}>
                    <input type="color" value={layer.color}
                      onChange={(e) => updateLayer(layer.id, { color: e.target.value })} />
                  </div>
                  <input className="color-hex" type="text" value={layer.color} maxLength={7}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value))
                        updateLayer(layer.id, { color: e.target.value });
                    }} />
                </div>
              </div>
            </Section>

            <Section title="Threshold">
              <div className="field">
                <div className="field-row">
                  <span className="field-label" style={{ flex: 1 }}>Range</span>
                  <span className="field-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    {layer.thresholdMin} – {layer.thresholdMax}
                  </span>
                </div>
                <DualRangeSlider
                  valueMin={layer.thresholdMin} valueMax={layer.thresholdMax}
                  onChange={(mn, mx) => updateLayer(layer.id, { thresholdMin: mn, thresholdMax: mx })}
                />
              </div>
              <Slider label="Exposure" value={layer.exposure} min={-100} max={100}
                onChange={(v) => updateLayer(layer.id, { exposure: v })} />
              <Slider label="Blur" value={layer.blur} min={0} max={20}
                onChange={(v) => updateLayer(layer.id, { blur: v })} />
            </Section>

            <Section title="Pattern Override">
              <SwitchRow
                label="Override Global Pattern"
                checked={!layer.useGlobalPattern}
                onChange={(checked) => updateLayer(layer.id, { useGlobalPattern: !checked })}
              />
              {!layer.useGlobalPattern ? (
                <PatternControls
                  pattern={layer.pattern}
                  scale={layer.patternScale}
                  density={layer.patternDensity}
                  angle={layer.patternAngle}
                  onPattern={(v) => updateLayer(layer.id, { pattern: v })}
                  onScale={(v) => updateLayer(layer.id, { patternScale: v })}
                  onDensity={(v) => updateLayer(layer.id, { patternDensity: v })}
                  onAngle={(v) => updateLayer(layer.id, { patternAngle: v })}
                />
              ) : (
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  padding: '8px 0', lineHeight: 1.5,
                }}>
                  Using global: <span style={{ color: 'var(--accent)' }}>
                    {PATTERN_LABELS[globalPattern.pattern]}
                  </span>
                </div>
              )}
            </Section>
          </>
        ) : separationMode === 'threshold' && !layer ? (
          <div className="no-layer-selected" style={{ flex: 'none', padding: '16px 14px' }}>
            <span className="no-layer-label">Select a layer to edit</span>
          </div>
        ) : null}

      </div>
    </aside>
  );
}
