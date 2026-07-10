// XeroxTestPage — isolated test bench for the Xerox/photocopy texture effect.
// Route: /xerox-test  (dev only, auth bypassed in App.tsx)

import { useState, useRef, useEffect, useCallback } from 'react';
import { runXerox, DEFAULT_XEROX_FAX, DEFAULT_XEROX_HYBRID } from '../engine/xeroxEngine';
import type { XeroxSettings, XeroxMode } from '../engine/xeroxEngine';

// ─── Presets ─────────────────────────────────────────────────────────────────

type PresetKey = XeroxMode;

const PRESETS: Record<PresetKey, { label: string; cfg: XeroxSettings }> = {
  fax:    { label: 'Fax',    cfg: { ...DEFAULT_XEROX_FAX } },
  hybrid: { label: 'Hybrid', cfg: { ...DEFAULT_XEROX_HYBRID } },
};

// ─── UI ───────────────────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'system-ui' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#fff', fontFamily: 'monospace', minWidth: 36, textAlign: 'right' }}>
          {step < 1 ? value.toFixed(2) : Math.round(value)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#a78bfa', cursor: 'pointer' }}
      />
    </div>
  );
}

function ColorSwatch({ label, r, g, b, onChange }: {
  label: string; r: number; g: number; b: number;
  onChange: (r: number, g: number, b: number) => void;
}) {
  const hex = `#${[r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <input type="color" value={hex}
        onChange={e => {
          const v = e.target.value;
          onChange(parseInt(v.slice(1,3),16), parseInt(v.slice(3,5),16), parseInt(v.slice(5,7),16));
        }}
        style={{ width: 28, height: 28, border: 'none', cursor: 'pointer', borderRadius: 6, background: 'none' }}
      />
      <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'system-ui' }}>{label}</span>
      <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace', marginLeft: 'auto' }}>{hex}</span>
    </div>
  );
}

function Sep() {
  return <div style={{ height: 1, background: '#242424', margin: '6px 0 14px' }} />;
}

function SL({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: '#555',
      marginBottom: 10, marginTop: 2, textTransform: 'uppercase', fontFamily: 'system-ui' }}>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function XeroxTestPage() {
  const [cfg, setCfg]               = useState<XeroxSettings>({ ...DEFAULT_XEROX_HYBRID });
  const [activePreset, setPreset]   = useState<PresetKey>('hybrid');
  const [processing, setProcessing] = useState(false);
  const [hasImage, setHasImage]     = useState(false);

  const srcRef    = useRef<ImageData | null>(null);
  const origRef   = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const dropRef   = useRef<HTMLDivElement>(null);

  const set = useCallback((patch: Partial<XeroxSettings>) => {
    setCfg(prev => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (!srcRef.current || !outputRef.current) return;
    setProcessing(true);
    const id = requestAnimationFrame(() => {
      const result = runXerox(srcRef.current!, cfg);
      outputRef.current!.getContext('2d', { colorSpace: 'srgb' })!.putImageData(result, 0, 0);
      setProcessing(false);
    });
    return () => cancelAnimationFrame(id);
  }, [cfg]);

  const loadImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 800;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d', { colorSpace: 'srgb' })!;
      octx.drawImage(img, 0, 0, w, h);
      srcRef.current = octx.getImageData(0, 0, w, h);
      URL.revokeObjectURL(url);

      if (origRef.current) {
        origRef.current.width = w; origRef.current.height = h;
        origRef.current.getContext('2d', { colorSpace: 'srgb' })!.putImageData(srcRef.current, 0, 0);
      }
      if (outputRef.current) {
        outputRef.current.width = w; outputRef.current.height = h;
        outputRef.current.getContext('2d', { colorSpace: 'srgb' })!
          .putImageData(runXerox(srcRef.current, cfg), 0, 0);
      }
      setHasImage(true);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [cfg]);

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const drop    = (e: DragEvent) => {
      prevent(e);
      const f = e.dataTransfer?.files[0];
      if (f && f.type.startsWith('image/')) loadImage(f);
    };
    el.addEventListener('dragover', prevent);
    el.addEventListener('drop', drop);
    return () => { el.removeEventListener('dragover', prevent); el.removeEventListener('drop', drop); };
  }, [loadImage]);

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    setCfg({ ...PRESETS[key].cfg });
  };

  const openPicker = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { if (inp.files?.[0]) loadImage(inp.files[0]); };
    inp.click();
  };

  const randomize = () => set({ seed: Math.floor(Math.random() * 9999) });

  const isHybrid = cfg.mode === 'hybrid';
  const accent   = isHybrid ? '#f59e0b' : '#a78bfa';

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#111', color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: 252, minWidth: 252, background: '#1a1a1a', borderRight: '1px solid #2a2a2a',
        overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column' }}>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: '#fff', marginBottom: 2 }}>XEROX</div>
          <div style={{ fontSize: 11, color: '#555' }}>/xerox-test</div>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['fax', 'hybrid'] as PresetKey[]).map(key => (
            <button key={key} onClick={() => applyPreset(key)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, fontFamily: 'system-ui', letterSpacing: '0.02em',
              background: activePreset === key ? accent : '#252525',
              color: activePreset === key ? '#fff' : '#666',
              transition: 'background 0.15s, color 0.15s',
            }}>
              {PRESETS[key].label}
            </button>
          ))}
        </div>

        {/* Randomize */}
        <button onClick={randomize} style={{
          width: '100%', padding: '7px 0', marginBottom: 16,
          background: '#252525', border: '1px solid #333', borderRadius: 8,
          color: '#aaa', fontSize: 11, cursor: 'pointer', fontFamily: 'system-ui',
          letterSpacing: '0.04em',
        }}>
          ⟳  Randomize Grain
        </button>

        <Sep />
        <SL>Fine Grain</SL>
        <Slider label="Strength"  value={cfg.fineStrength}  min={0} max={4} step={0.01} onChange={v => set({ fineStrength: v })} />
        <Slider label="Size (px)" value={cfg.fineSize}      min={0.2} max={4} step={0.01} onChange={v => set({ fineSize: v })} />
        <Slider label="Chroma"    value={cfg.chroma}        min={0} max={1} step={0.01} onChange={v => set({ chroma: v })} />

        <Sep />
        <SL>Coarse Grain</SL>
        <Slider label="Strength"  value={cfg.coarseStrength} min={0} max={4} step={0.01} onChange={v => set({ coarseStrength: v })} />
        <Slider label="Size (px)" value={cfg.coarseSize}     min={0.2} max={6} step={0.01} onChange={v => set({ coarseSize: v })} />

        <Sep />
        <SL>Tonal Weights</SL>
        <Slider label="Shadow"    value={cfg.shadowWeight}    min={0} max={1} step={0.01} onChange={v => set({ shadowWeight: v })} />
        <Slider label="Mid"       value={cfg.midWeight}       min={0} max={1} step={0.01} onChange={v => set({ midWeight: v })} />
        <Slider label="Highlight" value={cfg.highlightWeight} min={0} max={1} step={0.01} onChange={v => set({ highlightWeight: v })} />

        <Sep />
        <SL>Output</SL>
        <Slider label="Threshold"       value={Math.round(cfg.threshold * 100)} min={5} max={75} step={1}  onChange={v => set({ threshold: v / 100 })} />
        <Slider label="Edge emphasis"   value={cfg.edgeEmphasis}  min={0} max={3}   step={0.05} onChange={v => set({ edgeEmphasis: v })} />
        <Slider label="Paper texture"   value={cfg.paperTexture}  min={0} max={1}   step={0.01} onChange={v => set({ paperTexture: v })} />
        <Slider label="Pre-blur"        value={cfg.preBlur}       min={0} max={4}   step={0.5}  onChange={v => set({ preBlur: v })} />

        {isHybrid && (
          <>
            <Slider label="Color levels" value={cfg.posterizeLevels} min={2} max={8} step={1}    onChange={v => set({ posterizeLevels: v })} />
            <Slider label="Color boost"  value={cfg.colorBoost}      min={0} max={1} step={0.01} onChange={v => set({ colorBoost: v })} />
          </>
        )}

        <div style={{ marginTop: 10 }}>
          <ColorSwatch label="Ink"   r={cfg.inkR}   g={cfg.inkG}   b={cfg.inkB}
            onChange={(r,g,b) => set({ inkR: r, inkG: g, inkB: b })} />
          <ColorSwatch label="Paper" r={cfg.paperR} g={cfg.paperG} b={cfg.paperB}
            onChange={(r,g,b) => set({ paperR: r, paperG: g, paperB: b })} />
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 16, fontSize: 10, color: '#444', lineHeight: 1.6 }}>
          Drop image anywhere · approve → Texture mode
        </div>
      </div>

      {/* ── Preview pane ── */}
      <div ref={dropRef} style={{ flex: 1, overflowY: 'auto', padding: 24,
        display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' }}>

        {/* Drop zone */}
        <div style={{ display: hasImage ? 'none' : 'flex',
          width: '100%', maxWidth: 600, minHeight: 220,
          border: '2px dashed #333', borderRadius: 12,
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#555', gap: 10, cursor: 'pointer',
        }} onClick={openPicker}>
          <div style={{ fontSize: 32 }}>🖨️</div>
          <div style={{ fontSize: 13 }}>Drop an image or click to load</div>
          <div style={{ fontSize: 11, color: '#444' }}>JPG · PNG · WebP</div>
        </div>

        {/* Canvases — always in DOM so refs are valid */}
        <div style={{ display: hasImage ? 'flex' : 'none', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: '#555',
              marginBottom: 6, textTransform: 'uppercase', fontFamily: 'system-ui' }}>Original</div>
            <canvas ref={origRef} style={{ display: 'block', borderRadius: 8, border: '1px solid #2a2a2a', maxWidth: '100%' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                color: accent, textTransform: 'uppercase', fontFamily: 'system-ui' }}>
                {isHybrid ? 'Hybrid' : 'Fax'}
              </div>
              {processing && <div style={{ fontSize: 10, color: '#555' }}>rendering…</div>}
            </div>
            <canvas ref={outputRef} style={{ display: 'block', borderRadius: 8, border: '1px solid #2a2a2a', maxWidth: '100%' }} />
          </div>
        </div>

        {/* Fax vs Hybrid comparison */}
        {hasImage && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: '#555',
              marginBottom: 10, textTransform: 'uppercase', fontFamily: 'system-ui' }}>Fax vs Hybrid</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {(['fax', 'hybrid'] as PresetKey[]).map(key => (
                <PresetThumb key={key} src={srcRef.current} preset={PRESETS[key]}
                  active={activePreset === key} onClick={() => applyPreset(key)} />
              ))}
            </div>
          </div>
        )}

        {hasImage && (
          <button onClick={openPicker} style={{
            padding: '7px 16px', background: '#252525', border: '1px solid #333',
            borderRadius: 8, color: '#aaa', fontSize: 12, cursor: 'pointer', fontFamily: 'system-ui',
          }}>Load different image</button>
        )}
      </div>
    </div>
  );
}

// ─── Comparison thumbnail ─────────────────────────────────────────────────────

function PresetThumb({ src, preset, active, onClick }: {
  src: ImageData | null;
  preset: { label: string; cfg: XeroxSettings };
  active: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!src || !canvasRef.current) return;
    const maxDim = 180;
    const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
    const tw = Math.round(src.width * scale);
    const th = Math.round(src.height * scale);

    const tmp = document.createElement('canvas');
    tmp.width = src.width; tmp.height = src.height;
    tmp.getContext('2d')!.putImageData(src, 0, 0);

    const off = document.createElement('canvas');
    off.width = tw; off.height = th;
    const octx = off.getContext('2d')!;
    octx.drawImage(tmp, 0, 0, tw, th);

    canvasRef.current.width = tw; canvasRef.current.height = th;
    canvasRef.current.getContext('2d')!.putImageData(
      runXerox(octx.getImageData(0, 0, tw, th), preset.cfg), 0, 0
    );
  }, [src, preset]);

  const accent = preset.cfg.mode === 'hybrid' ? '#f59e0b' : '#a78bfa';

  return (
    <div onClick={onClick} style={{ cursor: 'pointer' }}>
      <div style={{ fontSize: 10, marginBottom: 5, fontFamily: 'system-ui',
        fontWeight: active ? 700 : 400, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: active ? accent : '#555' }}>
        {preset.label}
      </div>
      <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 6, maxWidth: 180,
        border: `1.5px solid ${active ? accent : '#2a2a2a'}` }} />
    </div>
  );
}
