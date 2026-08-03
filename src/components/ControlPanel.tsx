import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { PatternType } from '../engine/imageProcessor';
import { getBayer } from '../engine/colorSeparation';
import { DEFAULT_V2_SETTINGS } from '../engine/dtgEngineV2';
import { DEFAULT_XEROX_FAX, DEFAULT_XEROX_HYBRID } from '../engine/xeroxEngine';
import type { XeroxMode } from '../engine/xeroxEngine';

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

function Slider({ label, value, min, max, step = 1, onChange, unit = '', hint }: {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; unit?: string; hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isDragging = useRef(false);

  // Sync external changes (undo, preset load) when not actively dragging
  useEffect(() => { if (!isDragging.current) setLocalValue(value); }, [value]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const handleRangeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocalValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onChange(v), 80);
  };

  const handlePointerDown = () => { isDragging.current = true; };
  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    isDragging.current = false;
    clearTimeout(debounceRef.current);
    onChange(Number((e.target as HTMLInputElement).value));
  };

  const displayVal = step < 1 ? localValue.toFixed(1) : String(localValue);

  const commit = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
    setEditing(false);
  };

  return (
    <div className="field">
      <div className="field-row">
        <span className="field-label" style={{ flex: 1 }}>{label}</span>
        {editing ? (
          <input
            type="number"
            className="slider-num-input"
            value={draft}
            min={min} max={max} step={step}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              width: 48, height: 18, padding: '0 4px', fontSize: 11,
              fontFamily: 'var(--font-mono)', background: 'var(--surface-2)',
              border: '1px solid var(--accent)', color: 'var(--text)',
              textAlign: 'right',
            }}
          />
        ) : (
          <span
            className="field-value"
            title="Click to enter a value"
            onClick={() => { setDraft(displayVal); setEditing(true); }}
            style={{ cursor: 'text', borderBottom: '1px dashed var(--border-2)', padding: '4px 2px', minWidth: 28, display: 'inline-block', textAlign: 'right' }}
          >
            {displayVal}{unit}
          </span>
        )}
      </div>
      <div className="slider-track">
        <input type="range" min={min} max={max} step={step} value={localValue}
          onChange={handleRangeChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
        />
      </div>
      {hint && <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
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
  'diffusion':           'Diffusion · Floyd-Steinberg',
  'noise':               'Noise · Standard',
  'noise-coarse':        'Noise · Coarse',
  'noise-texture':       'Noise · Texture',
  'grain':               'Noise · Standard',
  'grain-soft':          'Noise · Standard',
  'grain-coarse':        'Noise · Coarse',
  'film-grain':          'Film Grain',
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
  'bayer-16':            'Bayer · 16×16',
  'bayer-32':            'Bayer · 32×32',
  // Dither-mode-only patterns
  'atkinson':    'Atkinson Diffusion',
  'jarvis':      'Jarvis Diffusion',
  'stucki':      'Stucki Diffusion',
  'blue-noise':  'Blue Noise',
  'grid':        'Grid',
  'checker':     'Checker',
  'hex':         'Hex',
  'hatch':       'Hatch',
  'bytewave':    'Bytewave',
  'shader':      'Shader',
  'stipple':     'Stipple',
  'engraving':   'Engraving',
  'etching':     'Etching',
  'newspaper':   'Newspaper',
  'comic':       'Comic',
  'scanline':    'Scanline',
  'crt':         'CRT',
  'glitch':      'Glitch',
  'pixel-sort':  'Pixel Sort',
  'voronoi':     'Voronoi',
  'ascii':       'ASCII',
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
    </select>
  );
}

function PatternControls({
  pattern, scale, density, angle,
  onPattern, onScale, onDensity, onAngle,
  scaleMaxOverride,
}: {
  pattern: PatternType;
  scale: number; density: number; angle: number;
  onPattern: (v: PatternType) => void;
  onScale: (v: number) => void;
  onDensity: (v: number) => void;
  onAngle: (v: number) => void;
  scaleMaxOverride?: number;
}) {
  const isHalftone  = pattern.startsWith('halftone-');
  const isGrain     = pattern.startsWith('grain') || pattern.startsWith('noise');
  const hasPattern = pattern !== 'none';
  const scaleMax  = scaleMaxOverride ?? (isGrain ? 6 : 40);
  const scaleStep = isGrain ? 0.5 : 1;
  return (
    <>
      <div className="field">
        <span className="field-label">Type</span>
        <PatternSelect value={pattern} onChange={(v) => {
          onPattern(v);
          const newIsGrain = v.startsWith('grain') || v.startsWith('noise');
          if (newIsGrain) onScale(1);
        }} />
      </div>
      {hasPattern && (
        <>
          <Slider label="Scale" value={Math.min(scale, scaleMax)} min={1} max={scaleMax} step={scaleStep} onChange={onScale} />
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
  const { globalPattern, updateGlobalPattern, separationMode, thresholdPreBlur, setThresholdPreBlur } = useStore();
  const isDtg = separationMode === 'dtg';
  const isThreshold = separationMode === 'threshold';

  return (
    <Section title={isDtg ? 'Print Pattern' : 'Global Pattern'} defaultOpen={true}>
      <p style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', margin: '0 0 8px', lineHeight: 1.5 }}>
        {isDtg ? 'Screen applied over artwork.' : 'Applied to all separations. Override per layer below.'}
      </p>
      <PatternControls
        pattern={globalPattern.pattern}
        scale={globalPattern.patternScale}
        density={globalPattern.patternDensity}
        angle={globalPattern.patternAngle}
        onPattern={(v) => updateGlobalPattern({
          pattern: v,
          ...(v === 'reticulation' ? { patternScale: 4, patternDensity: 65 } : {}),
        })}
        onScale={(v) => updateGlobalPattern({ patternScale: v })}
        onDensity={(v) => updateGlobalPattern({ patternDensity: v })}
        onAngle={(v) => updateGlobalPattern({ patternAngle: v })}
      />
      {isThreshold && (
        <Slider
          label="Pre-blur"
          value={thresholdPreBlur}
          min={0} max={20} step={0.5}
          onChange={setThresholdPreBlur}
          unit="px"
        />
      )}
    </Section>
  );
}

// ─── Distressed Texture Section ───────────────────────────────────────────────

function DistressedTextureSection() {
  const {
    textureEnabled, textureIntensity, textureScale, textureSeed,
    setTextureEnabled, setTextureIntensity, setTextureScale, setTextureSeed,
  } = useStore();
  return (
    <Section title="Distressed Texture" defaultOpen={true}>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, marginBottom: 6, opacity: 0.7 }}>
        Texture engine made using real Plastisol Ink Crack Scans
      </div>
      <SwitchRow label="Enable" checked={textureEnabled} onChange={setTextureEnabled} />
      <div style={{ opacity: textureEnabled ? 1 : 0.4, pointerEvents: textureEnabled ? 'auto' : 'none', transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        <Slider label="Intensity" value={textureIntensity} min={0} max={100} step={1} onChange={setTextureIntensity} unit="%" />
        <Slider label="Scale" value={textureScale} min={0.25} max={4} step={0.25} onChange={setTextureScale} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Seed: {textureSeed}
          </span>
          <button className="btn btn-ghost" style={{ fontSize: 10, height: 24, padding: '0 8px' }}
            onClick={() => setTextureSeed(Math.floor(Math.random() * 99999))}>
            Randomize
          </button>
        </div>
      </div>
    </Section>
  );
}

// ─── Image Adjustments Section ────────────────────────────────────────────────

import { ImageAdjustPanel } from './ImageAdjustPanel';

function ImageAdjustmentsSection() {
  const { originalImage, separationMode, imageAdjustments, setImageAdjustment, setAdjMode, setLevels, setCurves, resetImageAdjustments } = useStore();
  const disabled = !originalImage;
  const showSaturation = separationMode === 'dtg' || separationMode === 'texture';

  return (
    <Section title="Image Adjustments" defaultOpen={true}>
      <div style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
      <ImageAdjustPanel
        adj={imageAdjustments}
        onAdjMode={setAdjMode}
        onLevels={setLevels}
        onCurves={setCurves}
        onReset={resetImageAdjustments}
        onBasic={(key, v) => setImageAdjustment(key as keyof typeof imageAdjustments, v)}
        showSaturation={showSaturation}
      />
      </div>
    </Section>
  );
}

// ─── Document Setup ───────────────────────────────────────────────────────────

const DPI_OPTIONS = [72, 96, 150, 300] as const;

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
    originalImage, globalPattern,
  } = useStore();

  const docPxW = Math.round(documentWidthIn * documentDpi);
  const docPxH = Math.round(documentHeightIn * documentDpi);
  const lpi = Math.round(documentDpi / Math.max(1, globalPattern.patternScale));

  const artWIn = originalImage ? (originalImage.width / documentDpi).toFixed(2) : null;
  const artHIn = originalImage ? (originalImage.height / documentDpi).toFixed(2) : null;

  return (
    <Section title="Document Setup" defaultOpen={false}>
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
          {originalImage && (
            <button
              title="Fit document to image aspect ratio at current DPI"
              style={{
                fontSize: 9, padding: '3px 7px', height: 22, flexShrink: 0,
                fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em',
                background: 'transparent', cursor: 'pointer',
                border: '1px solid rgba(128,128,128,0.35)',
                color: 'var(--text-dim)',
              }}
              onClick={() => {
                const rawW = originalImage.width / documentDpi;
                const rawH = originalImage.height / documentDpi;
                const maxDim = Math.max(rawW, rawH);
                const scale = maxDim > 24 ? 24 / maxDim : 1;
                setDocumentWidth(Math.max(0.5, parseFloat((rawW * scale).toFixed(2))));
                setDocumentHeight(Math.max(0.5, parseFloat((rawH * scale).toFixed(2))));
              }}
            >
              Adapt
            </button>
          )}
        </div>
      </div>

      {/* DPI */}
      <div className="field">
        <span className="field-label">Output DPI</span>
        <select className="at-select" value={documentDpi}
          onChange={(e) => setDocumentDpi(Number(e.target.value))}>
          {DPI_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} DPI{d === 300 ? ' · standard' : d === 72 ? ' · screen' : ''}
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
    </Section>
  );
}

// ─── Garment Color Section (color-sep right panel) ───────────────────────────

const GARMENT_PRESETS: { hex: string; name: string }[] = [
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#F4EED4', name: 'Natural' },
  { hex: '#C8C9CC', name: 'Silver' },
  { hex: '#4A4A55', name: 'Charcoal' },
  { hex: '#0D0D0D', name: 'Black' },
  { hex: '#7EB0D4', name: 'Carolina Blue' },
  { hex: '#1B62A8', name: 'Royal' },
  { hex: '#1C2848', name: 'Navy' },
  { hex: '#228C8C', name: 'Teal' },
  { hex: '#1A7A30', name: 'Kelly Green' },
  { hex: '#426840', name: 'Forest' },
  { hex: '#8A9A76', name: 'Sage' },
  { hex: '#5A5A24', name: 'Olive' },
  { hex: '#D2A828', name: 'Gold' },
  { hex: '#E85C1C', name: 'Orange' },
  { hex: '#CC1E1E', name: 'Red' },
  { hex: '#6A0E18', name: 'Maroon' },
  { hex: '#7B3FA0', name: 'Purple' },
];

function BgColorSection() {
  const {
    canvasColor, setCanvasColor,
    showFabricBg, setShowFabricBg,
    fabricTexture, setFabricTexture,
    fabricBlendStrength, setFabricBlendStrength,
    fabricTextureDepth, setFabricTextureDepth,
    originalImage, separationMode,
  } = useStore();
  const fabricOn = fabricTexture !== 'none';
  return (
    <Section title="Background Color" defaultOpen={true}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          position: 'relative', width: 32, height: 32, flexShrink: 0,
          background: canvasColor,
          border: '2px solid color-mix(in srgb, currentColor 20%, var(--border-2))',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          cursor: 'pointer',
        }}>
          <input type="color" value={canvasColor} onChange={(e) => setCanvasColor(e.target.value)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }} />
        </div>
        <input
          type="text" value={canvasColor} maxLength={7}
          style={{
            flex: 1, height: 26, padding: '0 6px', fontSize: 11, fontFamily: 'var(--font-mono)',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--text)', letterSpacing: '0.05em',
          }}
          onChange={(e) => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setCanvasColor(e.target.value); }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 3, marginBottom: 8 }}>
        {GARMENT_PRESETS.map(({ hex, name }) => {
          const active = canvasColor.toLowerCase() === hex.toLowerCase();
          return (
            <button key={hex} onClick={() => setCanvasColor(hex)} title={name}
              style={{
                aspectRatio: '1', background: hex, cursor: 'pointer',
                border: active ? '2px solid var(--accent)' : '1.5px solid color-mix(in srgb, var(--border-2) 60%, transparent)',
                boxShadow: active ? '0 0 0 1.5px var(--accent)' : 'inset 0 1px 2px rgba(0,0,0,0.15)',
                transform: active ? 'scale(1.1)' : 'scale(1)',
                transition: 'transform 0.1s, border 0.1s',
              }}
            />
          );
        })}
      </div>
      <SwitchRow label="Show Background" checked={showFabricBg} onChange={setShowFabricBg} />
      <SwitchRow
        label="Fabric View"
        checked={fabricOn}
        onChange={(v) => {
          if (!v) { setFabricTexture('none'); return; }
          if (separationMode === 'dtg' && originalImage) {
            const d = originalImage.data;
            const n = originalImage.width * originalImage.height;
            let lum = 0;
            for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 2000))) lum += 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
            setFabricTexture(lum / Math.ceil(n / Math.max(1, Math.floor(n / 2000))) < 128 ? 'dark' : 'light');
          } else { setFabricTexture('light'); }
          if (!showFabricBg) setShowFabricBg(true);
        }}
      />
      {fabricOn && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
            {(['light', 'dark'] as const).map((t) => (
              <button key={t} onClick={() => setFabricTexture(t)}
                style={{
                  padding: '4px', fontSize: 9, fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  background: fabricTexture === t ? 'var(--accent)' : 'var(--surface-2)',
                  color: fabricTexture === t ? '#000' : 'var(--text-dim)',
                  border: `1px solid ${fabricTexture === t ? 'var(--accent)' : 'var(--border)'}`,
                  cursor: 'pointer', fontWeight: fabricTexture === t ? 700 : 400,
                }}>
                {t === 'light' ? 'Light Shirt' : 'Dark Shirt'}
              </button>
            ))}
          </div>
          <Slider label="Blend Strength" value={Math.round(fabricBlendStrength * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setFabricBlendStrength(v / 100)} />
          <Slider label="Texture Depth" value={Math.round(fabricTextureDepth * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => setFabricTextureDepth(v / 100)} />
        </>
      )}
    </Section>
  );
}

function RegistrationSection() {
  const {
    showRegistrationMarks, setShowRegistrationMarks,
    regMarkPadding, setRegMarkPadding,
    documentBleed, setDocumentBleed,
    separationMode,
  } = useStore();
  if (separationMode === 'texture' || separationMode === 'dtg') return null;
  return (
    <Section title="Registration Marks" defaultOpen={false}>
      <SwitchRow
        label="Enable"
        checked={showRegistrationMarks}
        onChange={setShowRegistrationMarks}
        hint={showRegistrationMarks ? 'Shown at document corners — visible in preview and baked into export' : undefined}
      />
      <Slider
        label="Bleed"
        value={documentBleed}
        min={0} max={2.0} step={0.25}
        onChange={setDocumentBleed}
        unit='"'
      />
      {showRegistrationMarks && (
        <Slider
          label="Mark Offset"
          value={regMarkPadding}
          min={0.1} max={2.0} step={0.1}
          onChange={setRegMarkPadding}
          unit='"'
        />
      )}
    </Section>
  );
}

// ─── Palette (Dither) Section ─────────────────────────────────────────────────

const DIFFUSION_PATTERNS: { id: PatternType; label: string }[] = [
  { id: 'diffusion',  label: 'Floyd-Steinberg' },
  { id: 'atkinson',   label: 'Atkinson' },
  { id: 'jarvis',     label: 'Jarvis' },
  { id: 'stucki',     label: 'Stucki' },
];


const ERROR_DIFF_PATTERNS: PatternType[] = ['diffusion', 'atkinson', 'jarvis', 'stucki'];

function DitherPatternBtn({ id, label, active, onSelect }: {
  id: PatternType; label: string; active: boolean; onSelect: (id: PatternType) => void;
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      title={PATTERN_LABELS[id]}
      style={{
        height: 28, fontSize: 9, fontFamily: 'var(--font-mono)',
        border: '1px solid var(--border-2)', borderRadius: 3, cursor: 'pointer',
        background: active ? 'var(--accent)' : 'var(--bg-3)',
        color: active ? '#1a1a1a' : 'var(--text-dim)',
        fontWeight: active ? 700 : 400,
        transition: 'background 0.1s, color 0.1s',
        padding: '0 4px', lineHeight: 1.2, textAlign: 'center',
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
    >
      {label}
    </button>
  );
}

function DitherGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4, marginTop: 10,
    }}>
      {children}
    </div>
  );
}

// Renders a horizontal gradient (dark→light) dithered with Bayer matrix N at 2px/cell.
// Used purely as a static visual reference in the Bayer selector strip.
function BayerPreviewStrip({
  selectedPattern,
  onSelect,
}: {
  selectedPattern: string;
  onSelect: (id: string) => void;
}) {
  const BAYER_OPTS = [
    { id: 'bayer-2',  label: '2×2',  N: 2  },
    { id: 'bayer-4',  label: '4×4',  N: 4  },
    { id: 'bayer-8',  label: '8×8',  N: 8  },
    { id: 'bayer-16', label: '16×16', N: 16 },
    { id: 'bayer-32', label: '32×32', N: 32 },
  ];
  const W = 56, H = 28, CELL = 2;

  const previews = useMemo(() => BAYER_OPTS.map(({ N }) => {
    const bayer = getBayer(N);
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const L = x / (W - 1);
        const tx = Math.floor(x / CELL) % N;
        const ty = Math.floor(y / CELL) % N;
        const threshold = bayer[ty * N + tx] + 0.5;
        const v = L < threshold ? 0 : 255;
        const i = (y * W + x) * 4;
        data[i] = data[i+1] = data[i+2] = v; data[i+3] = 255;
      }
    }
    const imgData = new ImageData(data, W, H);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d')!.putImageData(imgData, 0, 0);
    return c.toDataURL('image/png');
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {BAYER_OPTS.map(({ id, label }, idx) => {
        const active = selectedPattern === id;
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', flex: 1 }}
            onClick={() => onSelect(id)}>
            <img src={previews[idx]} width="100%" height={H} alt={label} style={{
              display: 'block', borderRadius: 3, imageRendering: 'pixelated', width: '100%',
              border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-2)'}`,
              boxSizing: 'border-box',
            }} />
            <span style={{
              fontSize: 8, fontFamily: 'var(--font-mono)', lineHeight: 1,
              color: active ? 'var(--accent)' : 'var(--text-dim)',
              fontWeight: active ? 700 : 400,
            }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PaletteSection() {
  const {
    separationMode,
    palettePattern, setPalettePattern,
    palettePatternScale, setPalettePatternScale,
    paletteColorMode, setPaletteColorMode,
    paletteDensity, setPaletteDensity,
    paletteAngle, setPaletteAngle,
    paletteSoftness, setPaletteSoftness,
  } = useStore();
  if (separationMode !== 'palette') return null;

  const isErrDiff = ERROR_DIFF_PATTERNS.includes(palettePattern);
  const isBayer   = ['bayer-2', 'bayer-4', 'bayer-8', 'bayer-16', 'bayer-32'].includes(palettePattern);
  const isNone    = palettePattern === 'none';

  const handlePatternSelect = (id: PatternType) => {
    const willBeErrDiff = ERROR_DIFF_PATTERNS.includes(id);
    const wasErrDiff    = ERROR_DIFF_PATTERNS.includes(palettePattern);
    setPalettePattern(id);
    if (willBeErrDiff) {
      setPalettePatternScale(1); // block size 1 = full-res error diffusion
    } else if (wasErrDiff) {
      setPalettePatternScale(2); // 2px cells — matches preview strip cell size, makes matrix sizes clearly distinct
    }
    // Switching between ordered types (including Bayer sizes) keeps current scale —
    // matrix size and pattern scale are independent controls.
  };

  return (
    <>
      {/* ── Dither Style ── */}
      <Section title="Dither Style" defaultOpen={true}>
        <DitherGroupLabel>Error Diffusion</DitherGroupLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3 }}>
          {DIFFUSION_PATTERNS.map(({ id, label }) => (
            <DitherPatternBtn key={id} id={id} label={label} active={palettePattern === id} onSelect={handlePatternSelect} />
          ))}
        </div>

        <DitherGroupLabel>Bayer Ordered</DitherGroupLabel>
        {/* Clickable gradient previews — each shows how that matrix dithers a gradient */}
        <BayerPreviewStrip selectedPattern={palettePattern} onSelect={(id) => handlePatternSelect(id as PatternType)} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3, marginTop: 2 }}>
          <DitherPatternBtn id="blue-noise" label="Blue Noise" active={palettePattern === 'blue-noise'} onSelect={handlePatternSelect} />
          <DitherPatternBtn id="none" label="Solid" active={palettePattern === 'none'} onSelect={handlePatternSelect} />
        </div>


        {/* Controls — vary by pattern family */}
        {!isNone && (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10,
            display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isErrDiff ? (
              <>
                <Slider label="Block Size" value={palettePatternScale} min={1} max={16} step={1}
                  onChange={setPalettePatternScale} unit="px" />
                <Slider label="Error Spread" value={paletteDensity} min={0} max={150} step={1}
                  onChange={setPaletteDensity} unit="%" />
              </>
            ) : isBayer ? (
              <>
                <Slider label="Cell Size" value={Math.max(1, palettePatternScale)} min={1} max={16} step={1}
                  onChange={setPalettePatternScale} unit="px" />
                <Slider label="Softness" value={paletteSoftness} min={0} max={100} step={1}
                  onChange={setPaletteSoftness} unit="%" />
                <Slider label="Contrast" value={paletteDensity} min={0} max={150} step={1}
                  onChange={setPaletteDensity} unit="%" />
                <Slider label="Angle" value={paletteAngle} min={0} max={360} step={1}
                  onChange={setPaletteAngle} unit="°" />
              </>
            ) : (
              <>
                <Slider label="Scale" value={Math.max(2, palettePatternScale)} min={2} max={40} step={1}
                  onChange={setPalettePatternScale} unit="px" />
                <Slider label="Density" value={paletteDensity} min={0} max={150} step={1}
                  onChange={setPaletteDensity} unit="%" />
                <Slider label="Angle" value={paletteAngle} min={0} max={360} step={1}
                  onChange={setPaletteAngle} unit="°" />
              </>
            )}
          </div>
        )}

        {/* Color Mode toggle */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Color Mode
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 2, lineHeight: 1.5 }}>
              Overlay original hues onto dither pattern
            </div>
          </div>
          <button onClick={() => setPaletteColorMode(!paletteColorMode)}
            style={{
              width: 36, height: 20, borderRadius: 10, flexShrink: 0, cursor: 'pointer',
              border: 'none', padding: 0, position: 'relative', transition: 'background 0.2s',
              background: paletteColorMode ? 'var(--accent)' : 'var(--surface-3)',
            }}>
            <span style={{
              position: 'absolute', top: 2, left: paletteColorMode ? 18 : 2,
              width: 16, height: 16, borderRadius: '50%',
              background: paletteColorMode ? '#000' : 'var(--text-dim)',
              transition: 'left 0.2s',
            }} />
          </button>
        </div>
      </Section>
    </>
  );
}

// ─── Grain Section (right panel: color blend + zone pattern) ─────────────────

function GrainSection() {
  const {
    separationMode,
    grainColorBlend, setGrainColorBlend,
    grainColorCount, setGrainColorCount,
    grainPattern, setGrainPattern,
    grainPatternScale, setGrainPatternScale,
    grainPatternDensity, setGrainPatternDensity,
    grainPatternAngle, setGrainPatternAngle,
  } = useStore();

  if (separationMode !== 'texture') return null;

  return (
    <>
      <Section title="Color Blend">
        <Slider label="B/W → Color" value={grainColorBlend} min={0} max={100} step={1}
          onChange={setGrainColorBlend} unit="%" />
        <Slider label="Color Count" value={grainColorCount} min={2} max={64} step={1}
          onChange={setGrainColorCount} />
      </Section>

      <Section title="Color Zone Pattern">
        <PatternControls
          pattern={grainPattern}
          scale={grainPatternScale}
          density={grainPatternDensity}
          angle={grainPatternAngle}
          onPattern={setGrainPattern}
          onScale={setGrainPatternScale}
          onDensity={setGrainPatternDensity}
          onAngle={setGrainPatternAngle}
          scaleMaxOverride={40}
        />
      </Section>
    </>
  );
}

// ─── Xerox Section ────────────────────────────────────────────────────────────

function XeroxSection() {
  const {
    separationMode,
    xeroxEnabled, setXeroxEnabled,
    xeroxSettings, setXeroxSettings,
  } = useStore();

  if (separationMode !== 'texture') return null;

  const mode = xeroxSettings.mode as XeroxMode;
  const set = (patch: Partial<typeof xeroxSettings>) =>
    setXeroxSettings({ ...xeroxSettings, ...patch });

  const switchMode = (m: XeroxMode) =>
    setXeroxSettings(m === 'fax' ? { ...DEFAULT_XEROX_FAX } : { ...DEFAULT_XEROX_HYBRID });

  return (
    <Section title="Xerox Effect" defaultOpen={false}>
      <SwitchRow label="Enable" checked={xeroxEnabled} onChange={setXeroxEnabled} />

      {xeroxEnabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['fax', 'hybrid'] as XeroxMode[]).map(m => (
              <button key={m} onClick={() => switchMode(m)} style={{
                flex: 1, padding: '5px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                letterSpacing: '0.06em',
                background: mode === m ? 'var(--accent)' : 'var(--surface-3)',
                color: mode === m ? '#fff' : 'var(--text-dim)',
                transition: 'background 0.12s',
              }}>
                {m}
              </button>
            ))}
          </div>

          <Slider label="Threshold" value={Math.round(xeroxSettings.threshold * 100)} min={5} max={75} step={1}
            onChange={v => set({ threshold: v / 100 })} unit="%" />
          <Slider label="Grain" value={xeroxSettings.fineStrength} min={0} max={4} step={0.05}
            onChange={v => set({ fineStrength: v })} />

          {mode === 'hybrid' && (
            <Slider label="Color boost" value={xeroxSettings.colorBoost} min={0} max={1} step={0.01}
              onChange={v => set({ colorBoost: v })} />
          )}

          <button onClick={() => set({ seed: Math.floor(Math.random() * 9999) })} style={{
            padding: '5px 0', background: 'var(--surface-3)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-dim)', fontSize: 10, cursor: 'pointer',
            fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
          }}>
            ⟳  Randomize Grain
          </button>
        </div>
      )}
    </Section>
  );
}

// ─── Color Sep Section ────────────────────────────────────────────────────────

function ColorSepSection() {
  const {
    separationMode,
    colorSepPattern, setColorSepPattern,
    colorSepPatternScale, setColorSepPatternScale,
    colorSepPatternDensity, setColorSepPatternDensity,
    colorSepPatternAngle, setColorSepPatternAngle,
  } = useStore();
  if (separationMode !== 'color-sep') return null;

  return (
    <Section title="Color Sep Pattern">
      <PatternControls
        pattern={colorSepPattern}
        scale={colorSepPatternScale}
        density={colorSepPatternDensity}
        angle={colorSepPatternAngle}
        onPattern={(v) => setColorSepPattern(v)}
        onScale={(v) => setColorSepPatternScale(v)}
        onDensity={(v) => setColorSepPatternDensity(v)}
        onAngle={(v) => setColorSepPatternAngle(v)}
        scaleMaxOverride={40}
      />
      <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, marginTop: 6 }}>
        {colorSepPattern === 'none'
          ? 'None — solid separations with hard color edges.'
          : 'Pattern blends the edges between color zones. Lower density = wider, more organic transitions.'}
      </div>
    </Section>
  );
}

// ─── DTG/DTF Screen Section ──────────────────────────────────────────────────

function DtgSection() {
  const {
    originalImage,
    printSettings, updatePrintSettings, resetPrintSettings,
    printBgEyedropperActive, setPrintBgEyedropperActive,
    dtgPaintMode, setDtgPaintMode,
    setDtgPaintMask,
    brushSize, setBrushSize,
  } = useStore();

  const disabled = !originalImage;

  const labelStyle: React.CSSProperties = {
    fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  };

  const subheadStyle: React.CSSProperties = {
    ...labelStyle,
    marginBottom: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  };

  const touchBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, height: 36, fontSize: 10, fontFamily: 'var(--font-mono)',
    border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
    borderRadius: 4, cursor: 'pointer',
    background: active ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)',
    color: active ? 'var(--accent)' : 'var(--text-dim)',
    fontWeight: active ? 700 : 400,
    letterSpacing: '0.05em', textTransform: 'uppercase',
    transition: 'all 0.12s', minWidth: 0,
  });

  const isHalftone = printSettings.halftone !== false;

  const isChanged = (
    printSettings.lpi       !== DEFAULT_V2_SETTINGS.lpi       ||
    printSettings.angle     !== DEFAULT_V2_SETTINGS.angle     ||
    printSettings.shadow    !== DEFAULT_V2_SETTINGS.shadow    ||
    printSettings.highlight !== DEFAULT_V2_SETTINGS.highlight ||
    printSettings.gamma     !== DEFAULT_V2_SETTINGS.gamma     ||
    printSettings.bgColor   !== DEFAULT_V2_SETTINGS.bgColor   ||
    (printSettings.alphaChoke    ?? 0) !== DEFAULT_V2_SETTINGS.alphaChoke ||
    (printSettings.minBrightness ?? 0) !== DEFAULT_V2_SETTINGS.minBrightness ||
    (printSettings.halftone ?? true)   !== DEFAULT_V2_SETTINGS.halftone
  );

  const bgColor = printSettings.bgColor;

  return (
    <Section title="Print Prep" defaultOpen={true}>
      <div style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity 0.2s' }}>

        {/* Workflow tip */}
        <div style={{
          fontSize: 9, fontFamily: 'var(--font-mono)', lineHeight: 1.65,
          color: 'var(--text-dim)', background: 'var(--surface-1)',
          border: '1px solid var(--border)', borderRadius: 4,
          padding: '7px 9px', marginBottom: 10,
        }}>
          <strong style={{ color: 'var(--text)' }}>How it works:</strong> Colour distance from the background drives ink coverage. Use <strong style={{ color: 'var(--text)' }}>Screen</strong> for halftone DTG output, or <strong style={{ color: 'var(--text)' }}>Solid</strong> to remove the background only — perfect for artwork that doesn't need halftoning.
        </div>

        {/* ── Background ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 4 }}>
          <div style={{ ...subheadStyle, marginBottom: 8 }}>
            <span>Background</span>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: bgColor ? 8 : 0 }}>
            <button
              onClick={() => updatePrintSettings({ bgColor: null })}
              title="Auto-detect background from image corners"
              style={{
                flex: 1, height: 30, fontSize: 10, fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                border: !bgColor ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
                borderRadius: 4, cursor: 'pointer',
                background: !bgColor
                  ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))'
                  : 'var(--surface-2)',
                color: !bgColor ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'all 0.12s',
              }}
            >
              Auto
            </button>
            <button
              onClick={() => setPrintBgEyedropperActive(true)}
              title="Pick background colour from canvas"
              style={{
                flex: 1, height: 30, fontSize: 10, fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                border: printBgEyedropperActive ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
                borderRadius: 4, cursor: 'pointer',
                background: printBgEyedropperActive
                  ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))'
                  : 'var(--surface-2)',
                color: printBgEyedropperActive ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'all 0.12s',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m2 22 1-1h3l9-9"/>
                <path d="M3 21v-3l9-9"/>
                <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
              </svg>
              {printBgEyedropperActive ? 'Click canvas…' : 'Eyedropper'}
            </button>
            {bgColor && (
              <div
                title={`RGB(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]})`}
                style={{
                  width: 30, height: 30, borderRadius: 4, flexShrink: 0,
                  background: `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`,
                  border: '1px solid var(--border-2)',
                }}
              />
            )}
          </div>
        </div>

        {/* ── Ink Signal ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 4 }}>
          <div style={subheadStyle}><span>Ink Signal</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Slider label="Shadow Cutoff" value={Math.round(printSettings.shadow * 100)} min={0} max={80} step={1}
              onChange={v => updatePrintSettings({ shadow: v / 100 })} unit="%"
              hint="Distance below this = no ink. Raise to remove faint edge fringing." />
            <Slider label="Highlight" value={Math.round(printSettings.highlight * 100)} min={20} max={100} step={1}
              onChange={v => updatePrintSettings({ highlight: v / 100 })} unit="%"
              hint="Distance above this = full ink. Lower to boost coverage of midtones." />
            <Slider label="Gamma" value={printSettings.gamma} min={0.25} max={4} step={0.05}
              onChange={v => updatePrintSettings({ gamma: Math.round(v * 100) / 100 })}
              hint="Midtone curve. >1 opens up shadows; <1 compresses them." />
          </div>
        </div>

        {/* ── Edge Cleanup ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 4 }}>
          <div style={subheadStyle}><span>Edge Cleanup</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Slider label="Min Brightness" value={Math.round((printSettings.minBrightness ?? 0) * 100)} min={0} max={80} step={1}
              onChange={v => updatePrintSettings({ minBrightness: v / 100 })} unit="%"
              hint="Pixels darker than this are excluded — removes dark fringe on black-background artwork. Try 5–20%." />
            <Slider label="Edge Choke" value={printSettings.alphaChoke ?? 0} min={0} max={8} step={1}
              onChange={v => updatePrintSettings({ alphaChoke: v })} unit="px"
              hint="Shrinks the ink boundary inward by N pixels — removes anti-aliased fringe on all image types." />
          </div>
        </div>

        {/* ── Output ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={labelStyle}>Output</span>
            {isChanged && (
              <button className="btn btn-ghost" style={{ fontSize: 9, padding: '2px 8px', height: 20 }}
                onClick={resetPrintSettings}>Reset All</button>
            )}
          </div>
          {/* Screen / Solid toggle */}
          <div style={{ display: 'flex', gap: 6, marginBottom: isHalftone ? 12 : 0 }}>
            <button
              onClick={() => updatePrintSettings({ halftone: true })}
              title="Apply sine-wave halftone screen — standard DTG output"
              style={{
                flex: 1, height: 30, fontSize: 10, fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                border: isHalftone ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
                borderRadius: 4, cursor: 'pointer',
                background: isHalftone ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)',
                color: isHalftone ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'all 0.12s',
              }}
            >
              Halftone
            </button>
            <button
              onClick={() => updatePrintSettings({ halftone: false })}
              title="Remove background only — outputs solid transparent PNG with no halftone screen"
              style={{
                flex: 1, height: 30, fontSize: 10, fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
                border: !isHalftone ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
                borderRadius: 4, cursor: 'pointer',
                background: !isHalftone ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-2))' : 'var(--surface-2)',
                color: !isHalftone ? 'var(--accent)' : 'var(--text-dim)',
                transition: 'all 0.12s',
              }}
            >
              Solid
            </button>
          </div>
          {isHalftone && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Slider label="Frequency" value={printSettings.lpi} min={10} max={85} step={1}
                onChange={v => updatePrintSettings({ lpi: v })} unit=" LPI" />
              <Slider label="Angle" value={printSettings.angle} min={0} max={180} step={0.5}
                onChange={v => updatePrintSettings({ angle: v })} unit="°" />
              <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                Sine-wave screen. 45 LPI · 22.5° is a standard DTG target.
              </div>
            </div>
          )}
          {!isHalftone && (
            <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.7, marginTop: 6 }}>
              Background removed. Exports a solid transparent PNG — no halftone screen applied.
            </div>
          )}
        </div>

        {/* ── Touch Up ── */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ ...subheadStyle, marginBottom: 8 }}><span>Touch Up</span></div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => setDtgPaintMode(dtgPaintMode === 'erase' ? 'off' : 'erase')}
              style={touchBtnStyle(dtgPaintMode === 'erase')}
            >
              Erase
            </button>
            <button
              onClick={() => setDtgPaintMode(dtgPaintMode === 'restore' ? 'off' : 'restore')}
              style={touchBtnStyle(dtgPaintMode === 'restore')}
            >
              Restore
            </button>
          </div>
          {dtgPaintMode !== 'off' && (
            <>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, marginBottom: 8 }}>
                {dtgPaintMode === 'erase'
                  ? 'Paint on the canvas to remove ink from that area.'
                  : 'Paint on the canvas to restore ink to that area.'}
              </div>
              <Slider label="Brush Size" value={brushSize} min={4} max={120} step={2} onChange={setBrushSize} unit="px" />
            </>
          )}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => setDtgPaintMask(null, null)}
              style={{
                width: '100%', height: 30, fontSize: 10, fontFamily: 'var(--font-mono)',
                border: '1px solid var(--border-2)', borderRadius: 4, cursor: 'pointer',
                background: 'var(--surface-2)', color: 'var(--text-dim)',
                letterSpacing: '0.05em', textTransform: 'uppercase',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              Clear Touch Up
            </button>
          </div>
        </div>


      </div>
    </Section>
  );
}

// ─── CMYK Auto Section (beginner-friendly) ───────────────────────────────────

function CmykTabGroup({ label, options, value, onChange }: {
  label: string;
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', minWidth: 88 }}>{label}</span>
      <div style={{ display: 'flex', gap: 2, flex: 1 }}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1, height: 24, fontSize: 10, fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border-2)', borderRadius: 3, cursor: 'pointer',
              background: value === opt.value ? 'var(--accent)' : 'var(--bg-3)',
              color: value === opt.value ? '#fff' : 'var(--text-dim)',
              fontWeight: value === opt.value ? 700 : 400,
              transition: 'background 0.15s',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CmykAutoSection({ quality }: { quality: number | null }) {
  const { separationMode, cmykParams, setCmykParam, cmykViewMode, setCmykViewMode } = useStore();
  if (separationMode !== 'cmyk') return null;
  const p = cmykParams;

  const scoreColor = quality === null ? 'var(--text-dim)'
    : quality >= 80 ? '#4caf50'
    : quality >= 60 ? '#ff9800'
    : '#f44336';

  return (
    <Section title="Print Settings">
      {/* View mode toggle */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 10 }}>
        {(['composite', 'plates'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setCmykViewMode(mode)}
            style={{
              flex: 1, height: 26, fontSize: 10, fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border-2)', borderRadius: 3, cursor: 'pointer',
              background: cmykViewMode === mode ? 'var(--accent)' : 'var(--bg-3)',
              color: cmykViewMode === mode ? '#fff' : 'var(--text-dim)',
              fontWeight: cmykViewMode === mode ? 700 : 400,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}
          >
            {mode === 'composite' ? 'Composite' : 'Plate View'}
          </button>
        ))}
      </div>

      {/* Quality score badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          Visual quality score
        </span>
        <span style={{
          fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: scoreColor,
          background: 'var(--bg-3)', border: `1px solid ${scoreColor}`,
          borderRadius: 4, padding: '1px 8px',
        }}>
          {quality === null ? '–' : `${quality}/100`}
        </span>
      </div>

      <CmykTabGroup
        label="Print Style"
        options={[{ label: 'Soft', value: 0 }, { label: 'Standard', value: 50 }, { label: 'Sharp', value: 100 }]}
        value={p.printStyle}
        onChange={(v) => setCmykParam('printStyle', v)}
      />
      <CmykTabGroup
        label="Garment"
        options={[{ label: 'White', value: 0 }, { label: 'Light', value: 50 }, { label: 'Dark', value: 100 }]}
        value={p.garmentColor}
        onChange={(v) => setCmykParam('garmentColor', v)}
      />

      <div style={{ marginTop: 6 }}>
        <Slider label="Detail"        value={p.detail}        min={0} max={100} step={1}
          onChange={(v) => setCmykParam('detail', v)}        unit="%" />
        <Slider label="Contrast"      value={p.contrast}      min={0} max={100} step={1}
          onChange={(v) => setCmykParam('contrast', v)}      unit="%" />
        <Slider label="Color Strength" value={p.colorStrength} min={0} max={100} step={1}
          onChange={(v) => setCmykParam('colorStrength', v)} unit="%" />
        <Slider label="Black Strength" value={p.blackStrength} min={0} max={100} step={1}
          onChange={(v) => setCmykParam('blackStrength', v)} unit="%" />
      </div>
    </Section>
  );
}

// ─── CMYK Advanced Section (hidden by default) ────────────────────────────────

function CmykAdvancedSection() {
  const { separationMode, cmykParams, setCmykParam } = useStore();
  if (separationMode !== 'cmyk') return null;
  const p = cmykParams;
  return (
    <Section title="Advanced" defaultOpen={false}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 8, lineHeight: 1.6 }}>
        Fine-tune ink separation and screening behavior.
      </div>
      <Slider label="Cyan Warm Protect" value={p.cyanWarmProtect}  min={0}   max={100} step={1}
        onChange={(v) => setCmykParam('cyanWarmProtect', v)}  unit="%" />
      <Slider label="Yellow Cleanup"    value={p.yellowClean}      min={0}   max={100} step={1}
        onChange={(v) => setCmykParam('yellowClean', v)}      unit="%" />
      <Slider label="Highlight Protect" value={p.highlightProtect} min={0}   max={60}  step={1}
        onChange={(v) => setCmykParam('highlightProtect', v)} unit="%" />
      <Slider label="UCR Amount"        value={p.ucrAmount}        min={0}   max={100} step={1}
        onChange={(v) => setCmykParam('ucrAmount', v)}        unit="%" />
      <Slider label="GCR Amount"        value={p.gcrAmount}        min={0}   max={100} step={1}
        onChange={(v) => setCmykParam('gcrAmount', v)}        unit="%" />
      <Slider label="Total Ink Limit"   value={p.totalInkLimit}    min={200} max={400} step={5}
        onChange={(v) => setCmykParam('totalInkLimit', v)}    unit="%" />
      <Slider label="Dot Gain Comp"     value={p.dotGain}          min={0}   max={40}  step={1}
        onChange={(v) => setCmykParam('dotGain', v)}          unit="%" />
      <Slider label="Smooth Flat Tones" value={p.smoothFlat}       min={0}   max={100} step={1}
        onChange={(v) => setCmykParam('smoothFlat', v)}       unit="%" />
    </Section>
  );
}

// ─── CMYK Screen Section ──────────────────────────────────────────────────────

function CmykScreenSection() {
  const { separationMode, cmykLpi, setCmykLpi, documentDpi, cmykAngles, setCmykAngle } = useStore();
  if (separationMode !== 'cmyk') return null;
  const dotPx = (documentDpi / cmykLpi).toFixed(1);
  const DEFAULTS = { 'cmyk-k': 45, 'cmyk-c': 15, 'cmyk-m': 75, 'cmyk-y': 0 };
  const channels = [
    { id: 'cmyk-k', label: 'K  Black' },
    { id: 'cmyk-c', label: 'C  Cyan' },
    { id: 'cmyk-m', label: 'M  Magenta' },
    { id: 'cmyk-y', label: 'Y  Yellow' },
  ];
  const isDirty = channels.some(({ id }) => (cmykAngles[id] ?? 0) !== DEFAULTS[id as keyof typeof DEFAULTS]);
  return (
    <Section title="Screen" defaultOpen={false}>
      <Slider label="Screen Ruling" value={cmykLpi} min={25} max={150} step={1}
        onChange={setCmykLpi} unit=" LPI" />
      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', lineHeight: 1.6, marginTop: 4 }}>
        ~{dotPx}px per dot @ {documentDpi} DPI · Round dot
      </div>
      <div style={{ marginTop: 10 }}>
        {channels.map(({ id, label }) => (
          <Slider key={id} label={label} value={cmykAngles[id] ?? 0}
            min={0} max={180} step={1}
            onChange={(v) => setCmykAngle(id, v)} unit="°" />
        ))}
      </div>
      {isDirty && (
        <button
          className="btn btn-ghost"
          onClick={() => channels.forEach(({ id }) => setCmykAngle(id, DEFAULTS[id as keyof typeof DEFAULTS]))}
          style={{ marginTop: 8, fontSize: 10, fontFamily: 'var(--font-mono)', height: 24, padding: '0 10px', opacity: 0.7 }}
        >
          Reset angles to defaults (K45° C15° M75° Y0°)
        </button>
      )}
    </Section>
  );
}

// ─── CMYK Pro Section ─────────────────────────────────────────────────────────

const QUALITY_PRESETS = [
  { label: 'Ultra Fine', lpi: 80 },
  { label: 'Fine',       lpi: 70 },
  { label: 'Detailed',   lpi: 65 },
  { label: 'Standard',   lpi: 55 },
  { label: 'Commercial', lpi: 45 },
  { label: 'Vintage',    lpi: 35 },
  { label: 'Poster',     lpi: 25 },
] as const;

const ANGLE_PRESETS = [
  {
    value: 'photoshop',
    label: 'Photoshop Default',
    angles: { C: 15, M: 75, Y: 0, K: 45 },
    desc: 'C 15° · M 75° · Y 0° · K 45°',
  },
  {
    value: 'screenPrint',
    label: 'Screen Print Process',
    // 7.5° shift avoids halftone/fabric-weave moiré on textiles
    angles: { C: 22.5, M: 52.5, Y: 7.5, K: 37.5 },
    desc: 'C 22.5° · M 52.5° · Y 7.5° · K 37.5°',
  },
  {
    value: 'accurip',
    label: 'Commercial Offset',
    angles: { C: 75, M: 15, Y: 30, K: 45 },
    desc: 'C 75° · M 15° · Y 30° · K 45°',
  },
] as const;

// Screen mode presets: configure all 4 channel shapes at once
const SCREEN_MODES = [
  {
    value: 'custom',
    label: 'Custom',
    shapes: null,
  },
  {
    value: 'classic',
    label: 'Classic Rosette  — Round, all channels',
    shapes: { C: 'round', M: 'round', Y: 'round', K: 'round' },
  },
  {
    value: 'euclidean',
    label: 'Euclidean Rosette  — Smooth midtones',
    shapes: { C: 'euclidean', M: 'euclidean', Y: 'euclidean', K: 'euclidean' },
  },
  {
    value: 'line',
    label: 'Line Screen  — AM lines, all channels',
    shapes: { C: 'line', M: 'line', Y: 'line', K: 'line' },
  },
] as const;

const HALFTONE_CHANNELS = [
  { key: 'halftoneC' as const, label: 'Cyan',    dot: '#00AEEF' },
  { key: 'halftoneM' as const, label: 'Magenta', dot: '#EC008C' },
  { key: 'halftoneY' as const, label: 'Yellow',  dot: '#C8A800' },
  { key: 'halftoneK' as const, label: 'Black',   dot: '#444' },
] as const;

function CmykProSection() {
  const {
    separationMode, proCmykSettings, setProCmykSettings, documentDpi,
  } = useStore();
  const [toneOpen, setToneOpen] = useState<Record<string, boolean>>({});
  if (separationMode !== 'cmyk-pro') return null;
  const s = proCmykSettings;

  // Update a single channel's halftone settings; if lockLpi/lockAngle, sync across all channels
  function updateChannel(
    key: 'halftoneC' | 'halftoneM' | 'halftoneY' | 'halftoneK',
    patch: Partial<import('../engine/cmykProEngine').ChannelHalftone>,
  ) {
    const current = s[key];
    const updated = { ...current, ...patch };
    const allKeys = ['halftoneC', 'halftoneM', 'halftoneY', 'halftoneK'] as const;
    let extra: Record<string, unknown> = {};
    if (s.lockLpi && patch.lpi !== undefined) {
      extra = Object.fromEntries(allKeys.map(k => [k, { ...s[k], lpi: patch.lpi! }]));
    }
    if (s.lockAngle && patch.angle !== undefined) {
      const delta = patch.angle - s[key].angle;
      const angleUpdates = Object.fromEntries(
        allKeys.map(k => [k, { ...(extra[k] as object ?? s[k]), angle: ((s[k].angle + delta) % 180 + 180) % 180 }])
      );
      extra = { ...extra, ...angleUpdates };
    }
    setProCmykSettings({ ...extra, [key]: updated });
  }

  return (
    <>
      <Section title="Halftone Screen" defaultOpen={true}>
        {/* Quality preset: sets LPI for all channels at once */}
        {(() => {
          const currentLpi = s.halftoneC?.lpi ?? 80;
          const matchedPreset = QUALITY_PRESETS.find(p => p.lpi === currentLpi);
          return (
            <div className="field" style={{ marginBottom: 8 }}>
              <span className="field-label">Quality</span>
              <select
                className="at-select"
                value={matchedPreset ? String(matchedPreset.lpi) : 'custom'}
                onChange={(e) => {
                  if (e.target.value === 'custom') return;
                  const lpi = Number(e.target.value);
                  setProCmykSettings({
                    lockLpi: true,
                    halftoneC: { ...s.halftoneC, lpi },
                    halftoneM: { ...s.halftoneM, lpi },
                    halftoneY: { ...s.halftoneY, lpi },
                    halftoneK: { ...s.halftoneK, lpi },
                  });
                }}
              >
                {!matchedPreset && <option value="custom">Custom ({currentLpi} LPI)</option>}
                {QUALITY_PRESETS.map((p) => (
                  <option key={p.lpi} value={String(p.lpi)}>{p.label} — {p.lpi} LPI</option>
                ))}
              </select>
            </div>
          );
        })()}

        <SwitchRow label="Lock LPI" checked={s.lockLpi ?? true}
          onChange={(v) => setProCmykSettings({ lockLpi: v })} />
        <SwitchRow label="Lock Angle" checked={s.lockAngle ?? false}
          onChange={(v) => setProCmykSettings({ lockAngle: v })} />

        {/* Angle preset: sets all 4 channel angles at once */}
        {(() => {
          const ca = s.halftoneC?.angle ?? 15;
          const ma = s.halftoneM?.angle ?? 75;
          const ya = s.halftoneY?.angle ?? 0;
          const ka = s.halftoneK?.angle ?? 45;
          const matched = ANGLE_PRESETS.find(
            p => p.angles.C === ca && p.angles.M === ma && p.angles.Y === ya && p.angles.K === ka,
          );
          return (
            <div className="field" style={{ marginTop: 6 }}>
              <span className="field-label">Angles</span>
              <select
                className="at-select"
                value={matched ? matched.value : 'custom'}
                onChange={(e) => {
                  const preset = ANGLE_PRESETS.find(p => p.value === e.target.value);
                  if (!preset) return;
                  setProCmykSettings({
                    halftoneC: { ...s.halftoneC, angle: preset.angles.C },
                    halftoneM: { ...s.halftoneM, angle: preset.angles.M },
                    halftoneY: { ...s.halftoneY, angle: preset.angles.Y },
                    halftoneK: { ...s.halftoneK, angle: preset.angles.K },
                  });
                }}
              >
                {!matched && <option value="custom">Custom ({ca}° / {ma}° / {ya}° / {ka}°)</option>}
                {ANGLE_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label} — {p.desc}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* Screen / rosette mode preset */}
        {(() => {
          const shapes = {
            C: s.halftoneC?.shape, M: s.halftoneM?.shape,
            Y: s.halftoneY?.shape, K: s.halftoneK?.shape,
          };
          const matched = SCREEN_MODES.find(
            m => m.shapes !== null &&
              m.shapes.C === shapes.C && m.shapes.M === shapes.M &&
              m.shapes.Y === shapes.Y && m.shapes.K === shapes.K
          );
          return (
            <div className="field" style={{ marginTop: 6 }}>
              <span className="field-label">Screen</span>
              <select
                className="at-select"
                value={matched ? matched.value : 'custom'}
                onChange={(e) => {
                  const mode = SCREEN_MODES.find(m => m.value === e.target.value);
                  if (!mode || !mode.shapes) return;
                  setProCmykSettings({
                    halftoneC: { ...s.halftoneC, shape: mode.shapes.C as import('../engine/cmykProEngine').DotShape },
                    halftoneM: { ...s.halftoneM, shape: mode.shapes.M as import('../engine/cmykProEngine').DotShape },
                    halftoneY: { ...s.halftoneY, shape: mode.shapes.Y as import('../engine/cmykProEngine').DotShape },
                    halftoneK: { ...s.halftoneK, shape: mode.shapes.K as import('../engine/cmykProEngine').DotShape },
                  });
                }}
              >
                {!matched && <option value="custom">Custom</option>}
                {SCREEN_MODES.filter(m => m.value !== 'custom').map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {HALFTONE_CHANNELS.map(({ key, label, dot }) => {
          const ht = s[key];
          const dotPx = (documentDpi / Math.max(1, ht.lpi)).toFixed(1);
          return (
            <div key={key} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Channel header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: dot, flexShrink: 0, display: 'inline-block',
                }} />
                <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', color: 'var(--text)' }}>
                  {label.toUpperCase()}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                  ~{dotPx}px/dot
                </span>
              </div>

              {/* LPI + Angle row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className="field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span className="field-label" style={{ fontSize: 9 }}>LPI</span>
                  <input
                    type="number"
                    min={25} max={200} step={1}
                    value={ht.lpi}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateChannel(key, { lpi: Math.min(200, v) });
                    }}
                    onBlur={(e) => updateChannel(key, { lpi: Math.max(25, Math.min(200, +e.target.value || 65)) })}
                    style={{
                      width: '100%', background: 'var(--input-bg)', border: '1px solid var(--border)',
                      color: 'var(--text)', borderRadius: 4, padding: '4px 6px',
                      fontSize: 12, fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
                <div className="field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span className="field-label" style={{ fontSize: 9 }}>Angle</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                    <input
                      type="number"
                      min={0} max={180} step={1}
                      value={ht.angle}
                      onChange={(e) => updateChannel(key, { angle: Math.max(0, Math.min(180, +e.target.value || 0)) })}
                      style={{
                        flex: 1, background: 'var(--input-bg)', border: '1px solid var(--border)',
                        color: 'var(--text)', borderRadius: 4, padding: '4px 6px',
                        fontSize: 12, fontFamily: 'var(--font-mono)',
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>°</span>
                  </div>
                </div>
              </div>

              {/* Shape */}
              <div className="field">
                <span className="field-label">Shape</span>
                <select
                  className="at-select"
                  value={ht.shape}
                  onChange={(e) => updateChannel(key, { shape: e.target.value as import('../engine/cmykProEngine').DotShape })}
                >
                  <option value="round">Round</option>
                  <option value="euclidean">Euclidean</option>
                  <option value="ellipse">Ellipse</option>
                  <option value="line">Line</option>
                  <option value="square">Square</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>

              {/* Dot Gain */}
              <Slider label="Dot Gain" value={ht.dotGain} min={0} max={30} step={1}
                onChange={(v) => updateChannel(key, { dotGain: v })} unit="%" />

              {/* Tone curve — collapsed by default */}
              <button
                onClick={() => setToneOpen(prev => ({ ...prev, [key]: !(prev[key] ?? false) }))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', fontSize: 9, fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.08em', textTransform: 'uppercase', padding: 0,
                }}
              >
                <span style={{
                  display: 'inline-block',
                  transform: (toneOpen[key] ?? false) ? 'rotate(90deg)' : 'none',
                  transition: 'transform 0.15s',
                  fontSize: 8,
                }}>▶</span>
                Tone Curve
              </button>

              {(toneOpen[key] ?? false) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 4, borderLeft: '2px solid var(--border)' }}>
                  <Slider label="HL Clip" value={ht.highlightClip ?? 3} min={0} max={10} step={0.5}
                    onChange={(v) => updateChannel(key, { highlightClip: v })} unit="%" />
                  <Slider label="HL Fade" value={ht.highlightFade ?? 5} min={0} max={15} step={0.5}
                    onChange={(v) => updateChannel(key, { highlightFade: v })} unit="%" />
                  <Slider label="SH Clip" value={ht.shadowClip ?? 0} min={0} max={10} step={0.5}
                    onChange={(v) => updateChannel(key, { shadowClip: v })} unit="%" />
                  <Slider label="SH Fade" value={ht.shadowFade ?? 0} min={0} max={15} step={0.5}
                    onChange={(v) => updateChannel(key, { shadowFade: v })} unit="%" />
                </div>
              )}
            </div>
          );
        })}

      </Section>
    </>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ControlPanel({ cmykQuality = null }: { cmykQuality?: number | null }) {
  const { originalImage, separationMode, passthroughMode } = useStore();

  if (!originalImage) {
    return (
      <aside className="panel-right" data-tutorial="tutorial-controls" data-mode={separationMode}>
        <div className="control-scroll">
          <DocumentSection />
          <RegistrationSection />
          {separationMode === 'color-sep' && <BgColorSection />}
          {separationMode === 'dtg' && <DtgSection />}
          {separationMode === 'threshold' && (
            <>
              <div style={{ opacity: 0.4, pointerEvents: 'none' }}>
                <DistressedTextureSection />
                <GlobalPatternSection />
              </div>
              <ImageAdjustmentsSection />
            </>
          )}
          {separationMode === 'texture' && (
            <div style={{ opacity: 0.4, pointerEvents: 'none' }}>
              <GrainSection />
              <XeroxSection />
              <ImageAdjustmentsSection />
            </div>
          )}
        </div>
      </aside>
    );
  }

  if (passthroughMode) {
    return (
      <aside className="panel-right" data-tutorial="tutorial-controls" data-mode={separationMode}>
        <div className="control-scroll">
          <DocumentSection />
          <RegistrationSection />
          <div style={{
            margin: '10px 12px',
            padding: '8px 10px',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', lineHeight: 1.6,
          }}>
            Passthrough mode — separation controls disabled.
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel-right" data-tutorial="tutorial-controls" data-mode={separationMode}>
      <div className="control-scroll">
        <DocumentSection />
        <RegistrationSection />
        {separationMode === 'cmyk' ? (
          <>
            <ImageAdjustmentsSection />
            <CmykAutoSection quality={cmykQuality} />
            <CmykAdvancedSection />
            <CmykScreenSection />
          </>
        ) : separationMode === 'cmyk-pro' ? (
          <>
            <ImageAdjustmentsSection />
            <CmykProSection />
          </>
        ) : separationMode === 'palette' ? (
          <PaletteSection />
        ) : separationMode === 'color-sep' ? (
          <>
            <BgColorSection />
            <ColorSepSection />
          </>
        ) : separationMode === 'texture' ? (
          <>
            <GrainSection />
            <XeroxSection />
          </>
        ) : separationMode === 'dtg' ? (
          <DtgSection />
        ) : (
          <>
            {separationMode === 'threshold' && <DistressedTextureSection />}
            <GlobalPatternSection />
          </>
        )}
        {separationMode !== 'cmyk' && separationMode !== 'cmyk-pro' && separationMode !== 'dtg' && <ImageAdjustmentsSection />}

      </div>
    </aside>
  );
}
