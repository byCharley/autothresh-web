import { useState } from 'react';
import { useStore } from '../store/useStore';
import { extractPalette } from '../engine/imageProcessor';

// ─── Icons ────────────────────────────────────────────────────────────────────

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="16 3 21 3 21 8"/>
      <line x1="4" y1="20" x2="21" y2="3"/>
      <polyline points="21 16 21 21 16 21"/>
      <line x1="15" y1="15" x2="21" y2="21"/>
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '0 12px', height: 32,
        background: 'none', border: 'none', borderTop: '1px solid var(--border)',
        cursor: 'pointer', color: 'var(--text-muted)',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
        {title}
      </span>
      <ChevronIcon open={open} />
    </button>
  );
}

function SwitchRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </span>
      <label className="switch" style={{ flexShrink: 0 }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className="switch-track" /><div className="switch-thumb" />
      </label>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ width: '100%' }}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

// ─── Fabric swatches ──────────────────────────────────────────────────────────

const FABRIC_SWATCHES = [
  { hex: '#ffffff', label: 'White' },
  { hex: '#f5f0e8', label: 'Natural' },
  { hex: '#e8d5b0', label: 'Sand' },
  { hex: '#d4a76a', label: 'Tan' },
  { hex: '#c0392b', label: 'Red' },
  { hex: '#e67e22', label: 'Orange' },
  { hex: '#f1c40f', label: 'Yellow' },
  { hex: '#27ae60', label: 'Green' },
  { hex: '#2980b9', label: 'Blue' },
  { hex: '#1a1a2e', label: 'Navy' },
  { hex: '#2d1b69', label: 'Purple' },
  { hex: '#6d4c41', label: 'Brown' },
  { hex: '#555555', label: 'Heather' },
  { hex: '#222222', label: 'Charcoal' },
  { hex: '#000000', label: 'Black' },
];

// ─── Fabric Section ───────────────────────────────────────────────────────────

function FabricSection() {
  const [open, setOpen] = useState(true);
  const { canvasColor, setCanvasColor, showFabricBg, setShowFabricBg } = useStore();

  return (
    <>
      <SectionHeader title="Fabric" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwitchRow label="Show Background" checked={showFabricBg} onChange={setShowFabricBg} />

          <div style={{ opacity: showFabricBg ? 1 : 0.45, pointerEvents: showFabricBg ? 'auto' : 'none', transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Color picker row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="color-swatch-btn" style={{ background: canvasColor, width: 26, height: 26, flexShrink: 0 }}>
                <input type="color" value={canvasColor} onChange={(e) => setCanvasColor(e.target.value)} />
              </div>
              <input
                className="color-hex"
                type="text"
                value={canvasColor}
                maxLength={7}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setCanvasColor(e.target.value);
                }}
              />
            </div>

            {/* Swatch grid */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {FABRIC_SWATCHES.map(({ hex, label }) => (
                <button
                  key={hex}
                  onClick={() => setCanvasColor(hex)}
                  title={label}
                  style={{
                    width: 20, height: 20, background: hex, cursor: 'pointer', flexShrink: 0,
                    border: canvasColor === hex ? '2px solid var(--accent)' : '1px solid var(--border-2)',
                    boxShadow: canvasColor === hex ? '0 0 0 1px var(--accent)' : 'none',
                    transition: 'border 0.1s, box-shadow 0.1s',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Texture Section ──────────────────────────────────────────────────────────

function TextureSection() {
  const [open, setOpen] = useState(true);
  const {
    originalImage,
    textureEnabled, textureIntensity, textureScale, textureSeed,
    setTextureEnabled, setTextureIntensity, setTextureScale, setTextureSeed,
  } = useStore();
  if (!originalImage) return null;

  return (
    <>
      <SectionHeader title="Plastisol Texture" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwitchRow label="Enable" checked={textureEnabled} onChange={setTextureEnabled} />

          <div style={{ opacity: textureEnabled ? 1 : 0.4, pointerEvents: textureEnabled ? 'auto' : 'none', transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Slider label="Intensity" value={textureIntensity} min={0} max={100} step={1}
              onChange={setTextureIntensity} unit="%" />
            <Slider label="Scale" value={textureScale} min={0.25} max={4} step={0.25}
              onChange={setTextureScale} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Seed: {textureSeed}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 10, height: 24, padding: '0 8px' }}
                onClick={() => setTextureSeed(Math.floor(Math.random() * 99999))}
              >
                Randomize
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Background Removal Section ───────────────────────────────────────────────

function ArtworkSection() {
  const [open, setOpen] = useState(true);
  const { originalImage, bgRemovalEnabled, bgTolerance, setBgRemovalEnabled, setBgTolerance } = useStore();
  if (!originalImage) return null;

  return (
    <>
      <SectionHeader title="Background" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwitchRow label="Remove BG" checked={bgRemovalEnabled} onChange={setBgRemovalEnabled} />
          {bgRemovalEnabled && (
            <Slider label="Tolerance" value={bgTolerance} min={1} max={100}
              onChange={setBgTolerance} unit="%" />
          )}
        </div>
      )}
    </>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function LayerPanel() {
  const {
    layers, selectedLayerId, selectLayer, updateLayer,
    previewImage, palettePool, activePaletteIdx, setPalettePool, applyPalette,
  } = useStore();

  const handleAutoPalette = () => {
    if (!previewImage) return;
    const palettes = [
      extractPalette(previewImage, 4),
      extractPalette(previewImage, 4),
      extractPalette(previewImage, 4),
    ];
    setPalettePool(palettes);
    applyPalette(0);
  };

  const handleShuffle = () => {
    if (palettePool.length === 0) return;
    applyPalette((activePaletteIdx + 1) % palettePool.length);
  };

  return (
    <aside className="panel-left">
      <div className="panel-header">
        <span className="panel-title">Layers</span>
        <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
          {layers.filter(l => l.visible).length}/{layers.length}
        </span>
      </div>

      {/* Single scrollable column: knockout → layers → palette → fabric → bg removal */}
      <div className="left-scroll">
        {/* Knockout */}
        <div style={{ padding: '8px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              Knockout
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#22c55e', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Auto</span>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            Ink overlap removed
          </div>
        </div>

        {/* Layer cards */}
        <div style={{ padding: '8px 8px 4px' }}>
          {[...layers].reverse().map((layer) => (
            <div
              key={layer.id}
              className={`layer-card ${selectedLayerId === layer.id ? 'selected' : ''}`}
              style={{ marginBottom: 4 }}
              onClick={() => selectLayer(layer.id)}
            >
              <div className="layer-swatch" title="Click to change color">
                <div className="layer-swatch-inner" style={{ background: layer.color }} />
                <input
                  type="color"
                  value={layer.color}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); updateLayer(layer.id, { color: e.target.value }); }}
                />
              </div>
              <div className="layer-card-info">
                <div className="layer-card-name">{layer.name}</div>
                <div className="layer-card-sub">
                  {layer.thresholdMin}–{layer.thresholdMax}
                  {layer.pattern !== 'none' && ` · ${layer.pattern}`}
                </div>
              </div>
              <div className="layer-card-actions">
                <button
                  className={`vis-btn ${!layer.visible ? 'hidden-layer' : ''}`}
                  onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                  title={layer.visible ? 'Hide layer' : 'Show layer'}
                >
                  <EyeIcon visible={layer.visible} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Auto Palette */}
        {previewImage && (
          <div style={{ padding: '4px 8px 8px', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className="btn btn-ghost"
                style={{ flex: 1, fontSize: 10, height: 26 }}
                onClick={handleAutoPalette}
              >
                Auto Palette
              </button>
              {palettePool.length > 1 && (
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={handleShuffle}
                  title={`Shuffle (${activePaletteIdx + 1}/${palettePool.length})`}
                  style={{ width: 26, height: 26 }}
                >
                  <ShuffleIcon />
                </button>
              )}
            </div>
            {palettePool.length > 0 && (
              <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                {palettePool[activePaletteIdx]?.map((c, i) => (
                  <div key={i} style={{ flex: 1, height: 8, background: c, border: '1px solid var(--border-2)', borderRadius: 1 }} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Texture overlay */}
        <TextureSection />

        {/* Fabric color + bg toggle */}
        <FabricSection />

        {/* Background removal (image only) */}
        <ArtworkSection />
      </div>

    </aside>
  );
}
