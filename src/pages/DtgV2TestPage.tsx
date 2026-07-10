import { useRef, useState, useCallback, useEffect } from 'react';
import {
  detectV2BgColor, runV2Halftone, sampleV2Color,
  DEFAULT_V2_SETTINGS,
} from '../engine/dtgEngineV2';
import type { V2Settings, V2Result } from '../engine/dtgEngineV2';

// At 45 LPI (default), match the reference tool's auto cell size of imageWidth/375.
// Scaling by lpi keeps the relationship: higher LPI → proportionally finer dots.
// cellSizePx = imgWidth / (lpi * 8.333)  where 8.333 = 375/45
const REFERENCE_BASE = 375; // reference tool's width-per-cell at 45 LPI
const PREVIEW_MAX_W = 900;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PREVIEW_MAX_W / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      const ctx = cvs.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function putImageDataToCanvas(canvas: HTMLCanvasElement, data: ImageData) {
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
}

function compositeOnColor(
  canvas: HTMLCanvasElement,
  data: ImageData,
  bg: string,
) {
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // putImageData ignores existing pixels, so draw to temp canvas first
  const tmp = document.createElement('canvas');
  tmp.width = data.width; tmp.height = data.height;
  tmp.getContext('2d')!.putImageData(data, 0, 0);
  ctx.drawImage(tmp, 0, 0);
}

function rgbCss(c: [number, number, number]) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function hexFromRgb([r, g, b]: [number, number, number]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function rgbFromHex(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const CHECKER_BG = `
  linear-gradient(45deg, #2a2a2a 25%, transparent 25%) -8px 0,
  linear-gradient(-45deg, #2a2a2a 25%, transparent 25%) -8px 0,
  linear-gradient(45deg, transparent 75%, #2a2a2a 75%) 0 0,
  linear-gradient(-45deg, transparent 75%, #2a2a2a 75%) 0 0
`.trim();

interface PanelProps {
  label: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  bg?: string;
  onCanvasClick?: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  cursor?: string;
}

function Panel({ label, canvasRef, bg, onCanvasClick, cursor }: PanelProps) {
  const isChecker = !bg || bg === 'checker';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontSize: 10, fontFamily: 'monospace', color: '#666',
        letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
      }}>
        {label}
      </span>
      <div style={{
        borderRadius: 6, overflow: 'hidden', border: '1px solid #2a2a2a',
        minHeight: 120,
        background: isChecker ? '#1e1e1e' : (bg ?? '#000'),
        backgroundImage: isChecker ? CHECKER_BG : undefined,
        backgroundSize: isChecker ? '16px 16px' : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          style={{ maxWidth: '100%', height: 'auto', display: 'block', cursor: cursor ?? 'default' }}
        />
      </div>
    </div>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  decimals?: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step = 1, unit = '', decimals = 0, onChange }: SliderRowProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>
          {value.toFixed(decimals)}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#4a9eff' }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DtgV2TestPage() {
  const [srcImage, setSrcImage] = useState<ImageData | null>(null);
  const [result, setResult] = useState<V2Result | null>(null);
  const [settings, setSettings] = useState<V2Settings>(DEFAULT_V2_SETTINGS);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const origRef    = useRef<HTMLCanvasElement>(null);
  const maskRef    = useRef<HTMLCanvasElement>(null);
  const v2Ref     = useRef<HTMLCanvasElement>(null);
  const blackRef  = useRef<HTMLCanvasElement>(null);

  // Re-run pipeline whenever image or settings change.
  useEffect(() => {
    if (!srcImage) return;
    setProcessing(true);
    const timer = setTimeout(() => {
      // Width-based cell size: at 45 LPI matches reference (imgWidth/375).
      // Higher LPI → proportionally smaller cells, same visual relationship.
      const cellSizePx = Math.max(1.5, srcImage.width / (settings.lpi * (REFERENCE_BASE / 45)));
      const res = runV2Halftone(srcImage, settings, cellSizePx);
      setResult(res);
      setProcessing(false);
    }, 10);
    return () => clearTimeout(timer);
  }, [srcImage, settings]);

  // Draw all canvases when result changes.
  useEffect(() => {
    if (!srcImage) return;
    if (origRef.current) putImageDataToCanvas(origRef.current, srcImage);
    if (!result) return;
    if (maskRef.current) putImageDataToCanvas(maskRef.current, result.bgMask);
    if (v2Ref.current) putImageDataToCanvas(v2Ref.current, result.output);
    if (blackRef.current) compositeOnColor(blackRef.current, result.output, '#000000');
  }, [srcImage, result]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    try {
      const imageData = await loadImageData(file);
      setSrcImage(imageData);
      setSettings(s => ({ ...s, bgColor: null })); // reset to auto-detect
    } catch {
      // silent
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleOrigClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!eyedropperActive || !srcImage || !origRef.current) return;
    const rect = origRef.current.getBoundingClientRect();
    const scaleX = srcImage.width / rect.width;
    const scaleY = srcImage.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const color = sampleV2Color(srcImage, px, py);
    setSettings(s => ({ ...s, bgColor: color }));
    setEyedropperActive(false);
  }, [eyedropperActive, srcImage]);

  const detectedBg = result?.detectedBgColor
    ?? (srcImage ? detectV2BgColor(srcImage) : null);

  const update = useCallback(<K extends keyof V2Settings>(key: K, val: V2Settings[K]) => {
    setSettings(s => ({ ...s, [key]: val }));
  }, []);

  return (
    <div style={{
      background: '#0d0d14', minHeight: '100vh', color: '#e0e0e0',
      fontFamily: 'system-ui, sans-serif', padding: '0 0 48px',
    }}>

      {/* Header */}
      <div style={{
        padding: '16px 24px', borderBottom: '1px solid #1e1e2e',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em' }}>
            DTG Engine V2 — Test Bench
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2, fontFamily: 'monospace' }}>
            Isolated · not connected to main app · sine-wave screen algorithm
          </div>
        </div>
        {srcImage && (
          <button
            onClick={() => { setSrcImage(null); setResult(null); }}
            style={{
              fontSize: 10, color: '#555', background: 'none',
              border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            Clear image
          </button>
        )}
      </div>

      <div style={{ padding: '24px' }}>
        {!srcImage ? (
          /* Drop zone */
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? '#4a9eff' : '#2a2a2a'}`,
              borderRadius: 12, padding: '80px 40px', textAlign: 'center',
              cursor: 'pointer', transition: 'border-color 0.2s',
              background: dragOver ? 'rgba(74,158,255,0.04)' : 'transparent',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
            <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
              Drop an image here, or click to upload
            </div>
            <div style={{ fontSize: 11, color: '#444' }}>
              PNG / JPG · images with a solid background color work best
            </div>
            <input
              ref={fileInputRef}
              type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => handleFiles(e.target.files)}
            />
          </div>
        ) : (
          <>
            {/* Panel grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: 16, marginBottom: 24,
            }}>
              <Panel
                label="1 — Original"
                canvasRef={origRef}
                bg="checker"
                onCanvasClick={handleOrigClick}
                cursor={eyedropperActive ? 'crosshair' : 'default'}
              />
              <Panel
                label="2 — Background detection mask"
                canvasRef={maskRef}
                bg="#000"
              />
              <Panel
                label="3 — V2 halftone (transparent)"
                canvasRef={v2Ref}
                bg="checker"
              />
              <Panel
                label="4 — V2 on black shirt"
                canvasRef={blackRef}
                bg="#000"
              />
            </div>

            {processing && (
              <div style={{
                textAlign: 'center', fontSize: 11, color: '#555',
                fontFamily: 'monospace', marginBottom: 16,
              }}>
                Processing…
              </div>
            )}

            {/* Controls */}
            <div style={{
              background: '#111118', border: '1px solid #1e1e2e',
              borderRadius: 10, padding: 20,
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 28,
            }}>

              {/* Col 1 — Screen */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Screen
                </div>
                <SliderRow label="LPI" value={settings.lpi} min={10} max={85} onChange={v => update('lpi', v)} />
                <SliderRow label="Angle" value={settings.angle} min={0} max={180} step={0.5} unit="°" decimals={1} onChange={v => update('angle', v)} />
              </div>

              {/* Col 2 — Levels */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Ink Signal Levels
                </div>
                <SliderRow label="Shadow cutoff" value={Math.round(settings.shadow * 100)} min={0} max={80} unit="%" onChange={v => update('shadow', v / 100)} />
                <SliderRow label="Highlight point" value={Math.round(settings.highlight * 100)} min={20} max={100} unit="%" onChange={v => update('highlight', v / 100)} />
                <SliderRow label="Gamma" value={settings.gamma} min={0.25} max={4} step={0.05} decimals={2} onChange={v => update('gamma', v)} />
              </div>

              {/* Col 3 — Background */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#555', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Background Color
                </div>

                {detectedBg && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: 4,
                      background: rgbCss(detectedBg),
                      border: '1px solid #333', flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>
                      {settings.bgColor ? 'Custom' : 'Auto'}{' '}
                      RGB({detectedBg.join(', ')})
                    </span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => { setSettings(s => ({ ...s, bgColor: null })); setEyedropperActive(false); }}
                    style={{
                      flex: 1, fontSize: 10, padding: '5px 8px',
                      background: !settings.bgColor ? '#1e3a1e' : '#16161e',
                      border: `1px solid ${!settings.bgColor ? '#3a7a3a' : '#2a2a2a'}`,
                      color: !settings.bgColor ? '#6fc46f' : '#888',
                      borderRadius: 4, cursor: 'pointer',
                    }}
                  >
                    Auto (corners)
                  </button>
                  <button
                    onClick={() => setEyedropperActive(v => !v)}
                    style={{
                      flex: 1, fontSize: 10, padding: '5px 8px',
                      background: eyedropperActive ? '#1a2a3a' : '#16161e',
                      border: `1px solid ${eyedropperActive ? '#4a9eff' : '#2a2a2a'}`,
                      color: eyedropperActive ? '#4a9eff' : '#888',
                      borderRadius: 4, cursor: 'pointer',
                    }}
                  >
                    {eyedropperActive ? 'Click panel 1 ↑' : 'Eyedropper'}
                  </button>
                </div>

                {settings.bgColor && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>Custom:</span>
                    <input
                      type="color"
                      value={hexFromRgb(settings.bgColor)}
                      onChange={e => setSettings(s => ({ ...s, bgColor: rgbFromHex(e.target.value) }))}
                      style={{ width: 32, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer', padding: 0 }}
                    />
                  </div>
                )}

                <button
                  onClick={() => setSettings(DEFAULT_V2_SETTINGS)}
                  style={{
                    marginTop: 8, fontSize: 10, padding: '5px 8px',
                    background: '#16161e', border: '1px solid #2a2a2a',
                    color: '#666', borderRadius: 4, cursor: 'pointer',
                  }}
                >
                  Reset all settings
                </button>
              </div>
            </div>

            {/* Algorithm note */}
            <div style={{
              marginTop: 16, padding: '12px 16px',
              background: '#0a0a10', border: '1px solid #1a1a24',
              borderRadius: 8, fontSize: 10, color: '#444',
              fontFamily: 'monospace', lineHeight: 1.7,
            }}>
              Algorithm: color distance from bg → sine-wave threshold (0.5·(1 + sin(freq·sx)·sin(freq·sy))) → binary alpha.
              {srcImage && (
                <>
                  {' '}Preview cell: {(srcImage.width / (settings.lpi * (REFERENCE_BASE / 45))).toFixed(1)}px
                  · Image: {srcImage.width}×{srcImage.height}px
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
