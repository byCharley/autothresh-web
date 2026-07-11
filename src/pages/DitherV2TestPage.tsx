import { useRef, useState, useCallback, useEffect } from 'react';

// ─── Engine ───────────────────────────────────────────────────────────────────
// Self-contained enhanced dither engine — does NOT touch imageProcessor.ts.
// Three improvements over the current dither pipeline:
//   1. Color-distance signal instead of luminance
//   2. Gamma + shadow/highlight on the signal (from DTG V2)
//   3. Analytic sine-wave threshold (no precomputed F32 array)

export type PatternType = 'bayer-4' | 'bayer-8' | 'sine' | 'noise' | 'floyd';
export type SignalMode  = 'luminance' | 'color-dist';

export interface DitherV2Settings {
  signalMode:   SignalMode;
  pattern:      PatternType;
  patternScale: number;  // bayer: pixel scale 1–8 | sine: cell size px | noise: cell size px
  angle:        number;  // sine halftone screen angle
  shadow:       number;  // 0–1 signal floor (below = no ink)
  highlight:    number;  // 0–1 signal ceiling (above = full ink)
  gamma:        number;  // midtone gamma on the coverage signal
  bgColor:      [number, number, number] | null; // null = auto-detect corners
}

export const DEFAULT_SETTINGS: DitherV2Settings = {
  signalMode:   'color-dist',
  pattern:      'bayer-8',
  patternScale: 2,
  angle:        22.5,
  shadow:       0,
  highlight:    1,
  gamma:        1.0,
  bgColor:      null,
};

// Bayer matrices (normalized 0–1)
const B4 = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v => v / 16);
const B8 = [
   0,32, 8,40, 2,34,10,42,
  48,16,56,24,50,18,58,26,
  12,44, 4,36,14,46, 6,38,
  60,28,52,20,62,30,54,22,
   3,35,11,43, 1,33, 9,41,
  51,19,59,27,49,17,57,25,
  15,47, 7,39,13,45, 5,37,
  63,31,55,23,61,29,53,21,
].map(v => v / 64);

function bayer(x: number, y: number, scale: number, mat: number[], order: number): number {
  const bx = Math.floor(x / scale) % order;
  const by = Math.floor(y / scale) % order;
  return mat[by * order + bx];
}

// Analytic sine halftone threshold (exact same formula as DTG V2)
function sineThreshold(x: number, y: number, cellSizePx: number, angleDeg: number): number {
  const rad  = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const sx   = x * cosA + y * sinA;
  const sy   = -x * sinA + y * cosA;
  const freq = (2 * Math.PI) / Math.max(1, cellSizePx);
  return 0.5 * (1 + Math.sin(freq * sx) * Math.sin(freq * sy));
}

// Deterministic per-pixel noise (no precomputed array — O(1) per pixel)
function noiseThreshold(x: number, y: number, scale: number): number {
  // Quantise to cells for a coarser noise grain, matching "patternScale"
  const cx = Math.floor(x / scale);
  const cy = Math.floor(y / scale);
  let h = ((cx * 1619 + cy * 31337 + 12345) * 2654435761) >>> 0;
  h ^= h >>> 13; h ^= h << 7; h ^= h >>> 17;
  return (h >>> 0) / 0xffffffff;
}

function levelsMap(v: number, lo: number, hi: number, gamma: number): number {
  const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)));
  return Math.pow(t, 1 / Math.max(0.01, gamma));
}

export function detectBgColor(src: ImageData): [number, number, number] {
  const { data: d, width: w, height: h } = src;
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
  let r = 0, g = 0, b = 0, n = 0;
  for (const c of corners) {
    if (d[c + 3] > 128) { r += d[c]; g += d[c + 1]; b += d[c + 2]; n++; }
  }
  return n > 0 ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [d[0], d[1], d[2]];
}

export function sampleColor(src: ImageData, x: number, y: number): [number, number, number] {
  const px = Math.max(0, Math.min(src.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(src.height - 1, Math.round(y)));
  const i  = (py * src.width + px) * 4;
  return [src.data[i], src.data[i + 1], src.data[i + 2]];
}

export interface DitherV2Result {
  output:           ImageData;
  luminanceOutput:  ImageData; // same settings but luminance signal — for A/B
  detectedBgColor:  [number, number, number];
}

export function runDitherV2(src: ImageData, s: DitherV2Settings): DitherV2Result {
  const { width: w, height: h, data } = src;
  const n = w * h;

  const bg = s.bgColor ?? detectBgColor(src);
  const [br, bg_g, bb] = bg;
  const bgLum = 0.299 * br + 0.587 * bg_g + 0.114 * bb;

  const outPrimary  = new Uint8ClampedArray(n * 4);
  const outLum      = new Uint8ClampedArray(n * 4);

  // Floyd-Steinberg requires sequential row processing — handle separately
  const isFloyd = s.pattern === 'floyd';

  if (isFloyd) {
    // Error diffusion buffers — operate on color-distance signal
    const errBuf = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const leftToRight = (y & 1) === 0;
      const xStart = leftToRight ? 0 : w - 1;
      const xEnd   = leftToRight ? w : -1;
      const xStep  = leftToRight ? 1 : -1;
      for (let x = xStart; x !== xEnd; x += xStep) {
        const i  = (y * w + x) * 4;
        const ei = y * w + x;
        if (data[i + 3] < 4) continue;

        // Color-distance signal
        const dr     = data[i] - br, dg = data[i + 1] - bg_g, db = data[i + 2] - bb;
        const rawSig = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 255);
        const signal = Math.max(0, Math.min(1, levelsMap(rawSig, s.shadow, s.highlight, s.gamma) + errBuf[ei]));

        const printed = signal >= 0.5;
        const error   = signal - (printed ? 1 : 0);

        if (printed) {
          outPrimary[i] = data[i]; outPrimary[i+1] = data[i+1]; outPrimary[i+2] = data[i+2]; outPrimary[i+3] = 255;
        }

        // Distribute error (Floyd-Steinberg weights)
        const distribute = (ox: number, oy: number, w_: number) => {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || nx >= w || ny >= h) return;
          errBuf[ny * w + nx] += error * w_;
        };
        if (leftToRight) {
          distribute( 1, 0, 7/16); distribute(-1, 1, 3/16);
          distribute( 0, 1, 5/16); distribute( 1, 1, 1/16);
        } else {
          distribute(-1, 0, 7/16); distribute( 1, 1, 3/16);
          distribute( 0, 1, 5/16); distribute(-1, 1, 1/16);
        }

        // Luminance A/B — same weights, luminance signal
        const lumRaw = Math.max(0, Math.min(255, 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
        const lumSig = levelsMap(Math.abs(lumRaw - bgLum) / 255, s.shadow, s.highlight, s.gamma);
        if (lumSig >= 0.5) {
          outLum[i] = data[i]; outLum[i+1] = data[i+1]; outLum[i+2] = data[i+2]; outLum[i+3] = 255;
        }
      }
    }
  } else {
    // Parallel per-pixel path (bayer, sine, noise)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 4) continue;

        // ── Color-distance signal ──────────────────────────────────────
        const dr = data[i] - br, dg = data[i + 1] - bg_g, db = data[i + 2] - bb;
        const rawDist = Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 255);
        const uDist   = levelsMap(rawDist, s.shadow, s.highlight, s.gamma);

        // ── Luminance signal (for A/B comparison) ─────────────────────
        const lumRaw  = Math.max(0, Math.min(255, 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
        const lumDist = Math.abs(lumRaw - bgLum) / 255;
        const uLum    = levelsMap(lumDist, s.shadow, s.highlight, s.gamma);

        // ── Pattern threshold ──────────────────────────────────────────
        let threshold: number;
        switch (s.pattern) {
          case 'bayer-4': threshold = bayer(x, y, s.patternScale, B4, 4); break;
          case 'bayer-8': threshold = bayer(x, y, s.patternScale, B8, 8); break;
          case 'sine':    threshold = sineThreshold(x, y, s.patternScale, s.angle); break;
          case 'noise':   threshold = noiseThreshold(x, y, s.patternScale); break;
          default:        threshold = 0.5;
        }

        if (uDist > threshold) {
          outPrimary[i] = data[i]; outPrimary[i+1] = data[i+1]; outPrimary[i+2] = data[i+2]; outPrimary[i+3] = 255;
        }
        if (uLum > threshold) {
          outLum[i] = data[i]; outLum[i+1] = data[i+1]; outLum[i+2] = data[i+2]; outLum[i+3] = 255;
        }
      }
    }
  }

  return {
    output:          new ImageData(outPrimary, w, h),
    luminanceOutput: new ImageData(outLum, w, h),
    detectedBgColor: bg,
  };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const PREVIEW_MAX_W = 900;

const CHECKER = `
  linear-gradient(45deg,#222 25%,transparent 25%) -8px 0,
  linear-gradient(-45deg,#222 25%,transparent 25%) -8px 0,
  linear-gradient(45deg,transparent 75%,#222 75%) 0 0,
  linear-gradient(-45deg,transparent 75%,#222 75%) 0 0
`.trim();

function loadImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PREVIEW_MAX_W / img.width);
      const cw = Math.round(img.width * scale);
      const ch = Math.round(img.height * scale);
      const cvs = document.createElement('canvas');
      cvs.width = cw; cvs.height = ch;
      cvs.getContext('2d')!.drawImage(img, 0, 0, cw, ch);
      resolve(cvs.getContext('2d')!.getImageData(0, 0, cw, ch));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function draw(canvas: HTMLCanvasElement, data: ImageData, bg?: string) {
  canvas.width = data.width; canvas.height = data.height;
  const ctx = canvas.getContext('2d')!;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  const tmp = document.createElement('canvas');
  tmp.width = data.width; tmp.height = data.height;
  tmp.getContext('2d')!.putImageData(data, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

function rgbCss([r, g, b]: [number, number, number]) { return `rgb(${r},${g},${b})`; }
function hexFromRgb([r, g, b]: [number, number, number]) { return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''); }
function rgbFromHex(h: string): [number, number, number] { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]; }

interface PanelProps {
  label: string;
  sub?: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  checker?: boolean;
  onClick?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  cursor?: string;
}
function Panel({ label, sub, canvasRef, checker, onClick, cursor }: PanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div>
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#555', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#444', marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{
        border: '1px solid #1e1e2a', overflow: 'hidden', minHeight: 80,
        background: checker ? '#181820' : '#0d0d14',
        backgroundImage: checker ? CHECKER : undefined,
        backgroundSize: checker ? '16px 16px' : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <canvas ref={canvasRef} onClick={onClick} style={{ maxWidth: '100%', height: 'auto', display: 'block', cursor: cursor ?? 'default' }} />
      </div>
    </div>
  );
}

interface SliderProps { label: string; value: number; min: number; max: number; step?: number; unit?: string; decimals?: number; onChange: (v: number) => void; }
function Slider({ label, value, min, max, step = 1, unit = '', decimals = 0, onChange }: SliderProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#999', fontFamily: 'monospace' }}>{value.toFixed(decimals)}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: '#4a9eff' }} />
    </div>
  );
}

interface ToggleProps { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; }
function Toggle({ label, value, options, onChange }: ToggleProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            flex: 1, padding: '5px 6px', fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
            background: value === o.value ? 'rgba(74,158,255,0.15)' : 'transparent',
            border: `1px solid ${value === o.value ? '#4a9eff' : '#222'}`,
            color: value === o.value ? '#4a9eff' : '#555',
            cursor: 'pointer', transition: 'all 0.1s',
          }}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DitherV2TestPage() {
  const [srcImage,  setSrcImage]  = useState<ImageData | null>(null);
  const [result,    setResult]    = useState<DitherV2Result | null>(null);
  const [settings,  setSettings]  = useState<DitherV2Settings>(DEFAULT_SETTINGS);
  const [previewBg, setPreviewBg] = useState('#000000');
  const [eyedrop,   setEyedrop]   = useState(false);
  const [processing,setProcessing]= useState(false);
  const [dragOver,  setDragOver]  = useState(false);

  const fileRef  = useRef<HTMLInputElement>(null);
  const origRef  = useRef<HTMLCanvasElement>(null);
  const newRef   = useRef<HTMLCanvasElement>(null);
  const lumRef   = useRef<HTMLCanvasElement>(null);
  const compRef  = useRef<HTMLCanvasElement>(null);
  const comp2Ref = useRef<HTMLCanvasElement>(null);

  const up = useCallback(<K extends keyof DitherV2Settings>(k: K, v: DitherV2Settings[K]) =>
    setSettings(s => ({ ...s, [k]: v })), []);

  // Re-run whenever image or settings change
  useEffect(() => {
    if (!srcImage) return;
    setProcessing(true);
    const id = setTimeout(() => {
      setResult(runDitherV2(srcImage, settings));
      setProcessing(false);
    }, 10);
    return () => clearTimeout(id);
  }, [srcImage, settings]);

  // Redraw all canvases
  useEffect(() => {
    if (!srcImage || !result) return;
    if (origRef.current) draw(origRef.current, srcImage);
    if (newRef.current)  draw(newRef.current,  result.output);
    if (lumRef.current)  draw(lumRef.current,  result.luminanceOutput);
    if (compRef.current) draw(compRef.current, result.output, previewBg);
    if (comp2Ref.current) {
      const c = comp2Ref.current;
      c.width = srcImage.width; c.height = srcImage.height;
      const ctx = c.getContext('2d')!;
      // Split-screen: left = luminance, right = color-dist
      const hw = Math.floor(srcImage.width / 2);
      const tmp1 = document.createElement('canvas');
      tmp1.width = srcImage.width; tmp1.height = srcImage.height;
      tmp1.getContext('2d')!.putImageData(result.luminanceOutput, 0, 0);
      const tmp2 = document.createElement('canvas');
      tmp2.width = srcImage.width; tmp2.height = srcImage.height;
      tmp2.getContext('2d')!.putImageData(result.output, 0, 0);
      ctx.fillStyle = previewBg; ctx.fillRect(0, 0, srcImage.width, srcImage.height);
      ctx.drawImage(tmp1, 0, 0, hw, srcImage.height, 0, 0, hw, srcImage.height);
      ctx.drawImage(tmp2, hw, 0, srcImage.width - hw, srcImage.height, hw, 0, srcImage.width - hw, srcImage.height);
      // Divider line
      ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hw, 0); ctx.lineTo(hw, srcImage.height); ctx.stroke();
      ctx.globalAlpha = 1;
      // Labels
      ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#fff';
      ctx.fillText('LUMINANCE', hw / 2, 16);
      ctx.fillText('COLOR DIST', hw + (srcImage.width - hw) / 2, 16);
      ctx.globalAlpha = 1;
    }
  }, [srcImage, result, previewBg]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const f = files[0];
    if (!f.type.startsWith('image/')) return;
    const d = await loadImageData(f).catch(() => null);
    if (d) { setSrcImage(d); setSettings(s => ({ ...s, bgColor: null })); }
  }, []);

  const handleOrigClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!eyedrop || !srcImage || !origRef.current) return;
    const r   = origRef.current.getBoundingClientRect();
    const scX = srcImage.width / r.width, scY = srcImage.height / r.height;
    const col = sampleColor(srcImage, (e.clientX - r.left) * scX, (e.clientY - r.top) * scY);
    up('bgColor', col);
    setEyedrop(false);
  }, [eyedrop, srcImage, up]);

  const detectedBg = result?.detectedBgColor ?? (srcImage ? detectBgColor(srcImage) : null);

  const PATTERN_OPTS = [
    { value: 'bayer-4',  label: 'Bayer 4×4' },
    { value: 'bayer-8',  label: 'Bayer 8×8' },
    { value: 'sine',     label: 'Sine' },
    { value: 'noise',    label: 'Noise' },
    { value: 'floyd',    label: 'Floyd' },
  ];

  const showAngle = settings.pattern === 'sine';
  const showScale = settings.pattern !== 'floyd';

  return (
    <div style={{ background: '#0d0d14', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif', padding: '0 0 64px' }}>

      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: '1px solid #1a1a24', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>Dither V2 — Test Bench</div>
          <div style={{ fontSize: 10, color: '#444', marginTop: 2, fontFamily: 'monospace' }}>
            Color-distance signal · shadow/highlight/gamma · analytic patterns · isolated from main app
          </div>
        </div>
        {srcImage && (
          <button onClick={() => { setSrcImage(null); setResult(null); }} style={{ fontSize: 10, color: '#555', background: 'none', border: '1px solid #222', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>
            Clear
          </button>
        )}
      </div>

      <div style={{ padding: 24 }}>
        {!srcImage ? (
          // Drop zone
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#4a9eff' : '#222'}`,
              borderRadius: 12, padding: '80px 40px', textAlign: 'center',
              cursor: 'pointer', transition: 'border-color 0.2s',
              background: dragOver ? 'rgba(74,158,255,0.04)' : 'transparent',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
            <div style={{ fontSize: 14, color: '#555', marginBottom: 4 }}>Drop an image here, or click to upload</div>
            <div style={{ fontSize: 11, color: '#333' }}>PNG / JPG · works best with artwork on a solid background</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

            {/* ── Controls sidebar ─────────────────────────────────────── */}
            <div style={{
              width: 240, flexShrink: 0, background: '#0f0f18',
              border: '1px solid #1a1a24', borderRadius: 10, padding: 18,
              display: 'flex', flexDirection: 'column', gap: 20,
              position: 'sticky', top: 24,
            }}>

              {/* Signal mode */}
              <Toggle
                label="Signal"
                value={settings.signalMode}
                options={[{ value: 'color-dist', label: 'Color Dist' }, { value: 'luminance', label: 'Luminance' }]}
                onChange={v => up('signalMode', v as SignalMode)}
              />

              {/* Pattern */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Toggle
                  label="Pattern"
                  value={settings.pattern}
                  options={PATTERN_OPTS.slice(0, 3)}
                  onChange={v => up('pattern', v as PatternType)}
                />
                <div style={{ display: 'flex', gap: 2 }}>
                  {PATTERN_OPTS.slice(3).map(o => (
                    <button key={o.value} onClick={() => up('pattern', o.value as PatternType)} style={{
                      flex: 1, padding: '5px 6px', fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
                      background: settings.pattern === o.value ? 'rgba(74,158,255,0.15)' : 'transparent',
                      border: `1px solid ${settings.pattern === o.value ? '#4a9eff' : '#222'}`,
                      color: settings.pattern === o.value ? '#4a9eff' : '#555',
                      cursor: 'pointer',
                    }}>{o.label}</button>
                  ))}
                </div>
              </div>

              {/* Pattern controls */}
              {showScale && (
                <Slider
                  label={settings.pattern === 'sine' ? 'Cell size (px)' : 'Pixel scale'}
                  value={settings.patternScale}
                  min={settings.pattern === 'sine' ? 2 : 1}
                  max={settings.pattern === 'sine' ? 80 : 8}
                  step={settings.pattern === 'sine' ? 1 : 1}
                  unit={settings.pattern === 'sine' ? 'px' : '×'}
                  onChange={v => up('patternScale', v)}
                />
              )}
              {showAngle && (
                <Slider label="Angle" value={settings.angle} min={0} max={180} step={0.5} unit="°" decimals={1} onChange={v => up('angle', v)} />
              )}

              {/* Divider */}
              <div style={{ borderTop: '1px solid #1a1a24' }} />

              {/* Signal levels */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Signal Levels</div>
                <Slider label="Shadow cutoff" value={Math.round(settings.shadow * 100)} min={0} max={80} unit="%" onChange={v => up('shadow', v / 100)} />
                <Slider label="Highlight point" value={Math.round(settings.highlight * 100)} min={20} max={100} unit="%" onChange={v => up('highlight', v / 100)} />
                <Slider label="Gamma" value={settings.gamma} min={0.25} max={4} step={0.05} decimals={2} onChange={v => up('gamma', v)} />
              </div>

              {/* Divider */}
              <div style={{ borderTop: '1px solid #1a1a24' }} />

              {/* Background color */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Background Color</div>
                {detectedBg && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 18, height: 18, background: rgbCss(detectedBg), border: '1px solid #333', flexShrink: 0, borderRadius: 3 }} />
                    <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>
                      {settings.bgColor ? 'Custom' : 'Auto'} · RGB({detectedBg.join(', ')})
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => { up('bgColor', null); setEyedrop(false); }} style={{ flex: 1, padding: '4px 6px', fontSize: 9, fontFamily: 'monospace', fontWeight: 700, background: !settings.bgColor ? 'rgba(74,222,128,0.1)' : 'transparent', border: `1px solid ${!settings.bgColor ? '#3a7a3a' : '#222'}`, color: !settings.bgColor ? '#4ade80' : '#555', cursor: 'pointer' }}>Auto</button>
                  <button onClick={() => setEyedrop(v => !v)} style={{ flex: 1, padding: '4px 6px', fontSize: 9, fontFamily: 'monospace', fontWeight: 700, background: eyedrop ? 'rgba(74,158,255,0.1)' : 'transparent', border: `1px solid ${eyedrop ? '#4a9eff' : '#222'}`, color: eyedrop ? '#4a9eff' : '#555', cursor: 'pointer' }}>
                    {eyedrop ? 'Click img ↗' : 'Eyedropper'}
                  </button>
                </div>
                {settings.bgColor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>Custom</span>
                    <input type="color" value={hexFromRgb(settings.bgColor)} onChange={e => up('bgColor', rgbFromHex(e.target.value))} style={{ width: 28, height: 22, border: 'none', cursor: 'pointer', padding: 0, background: 'none' }} />
                  </div>
                )}
              </div>

              {/* Divider */}
              <div style={{ borderTop: '1px solid #1a1a24' }} />

              {/* Preview background */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Preview BG</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['#000000', '#ffffff', '#c41f3b', '#1a4a8a'].map(c => (
                    <button key={c} onClick={() => setPreviewBg(c)} style={{ flex: 1, height: 24, background: c, border: `2px solid ${previewBg === c ? '#4a9eff' : 'transparent'}`, cursor: 'pointer', borderRadius: 3 }} />
                  ))}
                  <input type="color" value={previewBg} onChange={e => setPreviewBg(e.target.value)} style={{ width: 32, height: 24, border: '1px solid #222', cursor: 'pointer', padding: 0, borderRadius: 3 }} />
                </div>
              </div>

              <button onClick={() => setSettings(DEFAULT_SETTINGS)} style={{ padding: '6px 0', fontSize: 10, fontFamily: 'monospace', background: 'transparent', border: '1px solid #1a1a24', color: '#444', cursor: 'pointer', borderRadius: 4 }}>
                Reset all
              </button>

              {processing && (
                <div style={{ textAlign: 'center', fontSize: 10, color: '#444', fontFamily: 'monospace' }}>Processing…</div>
              )}
            </div>

            {/* ── Panels ───────────────────────────────────────────────── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

              {/* Row 1: Original + Split A/B */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Panel
                  label="Original"
                  sub="Click to pick background color with eyedropper"
                  canvasRef={origRef}
                  checker
                  onClick={handleOrigClick}
                  cursor={eyedrop ? 'crosshair' : 'default'}
                />
                <Panel
                  label="A/B Split — Luminance (left) vs Color Distance (right)"
                  sub={`composited on ${previewBg}`}
                  canvasRef={comp2Ref}
                />
              </div>

              {/* Row 2: New result + composited */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Panel
                  label={`Color Distance — ${settings.pattern} · transparent`}
                  canvasRef={newRef}
                  checker
                />
                <Panel
                  label={`Color Distance — composited on preview BG`}
                  canvasRef={compRef}
                />
              </div>

              {/* Row 3: Luminance only */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Panel
                  label="Luminance only — transparent (current behaviour)"
                  canvasRef={lumRef}
                  checker
                />
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 16px', gap: 10 }}>
                  <div style={{ fontSize: 10, color: '#444', fontFamily: 'monospace', lineHeight: 1.7 }}>
                    <div style={{ color: '#4a9eff', fontWeight: 700, marginBottom: 6 }}>What's different</div>
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ color: '#888' }}>Luminance</span> — converts to greyscale, thresholds on brightness.
                      Bright red and bright green are treated identically.
                    </div>
                    <div>
                      <span style={{ color: '#4ade80' }}>Color Distance</span> — measures how far each pixel is from the
                      detected background in RGB space. Saturated colors that look bright
                      still register as "ink" when they differ from the BG.
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer note */}
              <div style={{ padding: '10px 14px', background: '#0a0a10', border: '1px solid #1a1a24', borderRadius: 6, fontSize: 10, color: '#333', fontFamily: 'monospace', lineHeight: 1.7 }}>
                Signal: {settings.signalMode === 'color-dist' ? 'Euclidean color distance from BG → levels(shadow, highlight, gamma) → pattern threshold' : 'Luminance → |lum − bgLum| → levels → pattern threshold'}
                {srcImage && (
                  <> · Image: {srcImage.width}×{srcImage.height}px
                    {settings.pattern === 'sine' && <> · Cell: {settings.patternScale}px</>}
                    {settings.pattern !== 'sine' && settings.pattern !== 'floyd' && <> · Scale: {settings.patternScale}×</>}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
