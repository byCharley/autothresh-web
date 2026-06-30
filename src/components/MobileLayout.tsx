import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { CanvasView } from './CanvasView';
import { LayerPanel } from './LayerPanel';
import { ControlPanel } from './ControlPanel';
import { AppIcon } from './AppIcon';
import { renderComposite } from '../engine/imageProcessor';
import { compositeHalftonePlates, buildNeugebauerPrimaries } from '../engine/inkSimulator';

interface Session {
  firstName?: string;
  email?: string;
  subscriptionStatus?: string;
  planTitle?: string;
  subscriptionExpiresAt?: string;
}

interface Props {
  onExport: () => void;
  onMockup: () => void;
  onLogout: () => void;
  session: Session | null;
  children?: React.ReactNode;
}

type Sheet = 'layers' | 'controls' | null;

export function MobileLayout({ onExport, onMockup, onLogout, session, children }: Props) {
  const [activeSheet, setActiveSheet] = useState<Sheet>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewCenter, setPreviewCenter] = useState({ x: 0.5, y: 0.5 });
  const menuRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewDragRef = useRef({ active: false, sx: 0, sy: 0, cx: 0.5, cy: 0.5 });
  const { originalImage, imageFileName, separationMode, cmykQuality,
          processedLayers, processedLayerDims, ditherComposite,
          canvasColor, proCmykSettings } = useStore();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const toggleSheet = (tab: 'layers' | 'controls') =>
    setActiveSheet(prev => prev === tab ? null : tab);

  const isCmykPro = separationMode === 'cmyk-pro';
  // CMYK Pro gets ~45% of screen height so the full image is visible in the preview strip.
  // Other modes use a compact 200px strip since they zoom into dot detail.
  const previewH = isCmykPro ? Math.min(Math.round(window.innerHeight * 0.45), 420) : 200;

  // ── Live preview strip ────────────────────────────────────────────────────
  useEffect(() => {
    if (activeSheet !== 'controls' && activeSheet !== 'layers') return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    let srcCanvas: HTMLCanvasElement | null = null;

    if (isCmykPro && processedLayers.length && processedLayerDims) {
      // Neugebauer ink simulation — matches in-app Print Sim preview
      const { w, h } = processedLayerDims;
      const [gR, gG, gB] = (canvasColor.match(/[\da-f]{2}/gi) ?? ['00','00','00'])
        .map(x => parseInt(x, 16)) as [number, number, number];
      const garmentMode: 'dark' | 'light' =
        gR * 0.299 + gG * 0.587 + gB * 0.114 < 128 ? 'dark' : 'light';
      const composite = compositeHalftonePlates(
        processedLayers, w, h,
        buildNeugebauerPrimaries(proCmykSettings.cmykProfile),
        null, { c: true, m: true, y: true, k: true },
        garmentMode, [gR, gG, gB],
      );
      // Layer garment bg + composite (composite has alpha=0 for transparent areas)
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d')!.putImageData(composite, 0, 0);
      srcCanvas = document.createElement('canvas');
      srcCanvas.width = w; srcCanvas.height = h;
      const sCtx = srcCanvas.getContext('2d')!;
      sCtx.fillStyle = canvasColor;
      sCtx.fillRect(0, 0, w, h);
      sCtx.drawImage(tmp, 0, 0);
    } else if (separationMode === 'palette' && ditherComposite) {
      srcCanvas = document.createElement('canvas');
      srcCanvas.width  = ditherComposite.w;
      srcCanvas.height = ditherComposite.h;
      srcCanvas.getContext('2d')!.putImageData(ditherComposite.data, 0, 0);
    } else if (processedLayers.length && processedLayerDims) {
      srcCanvas = document.createElement('canvas');
      const { w, h } = processedLayerDims;
      srcCanvas.width = w; srcCanvas.height = h;
      const composite = renderComposite(processedLayers, w, h, true, '#ffffff', false);
      srcCanvas.getContext('2d')!.putImageData(composite, 0, 0);
    }

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = isCmykPro ? canvasColor : '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!srcCanvas) return;

    // CMYK Pro: fit full image width (dots become sub-pixel, image reads as the actual photo).
    // Others: show 35% of width so individual dot patterns are inspectable.
    const zoomFraction = isCmykPro ? 1.0 : 0.35;
    const zoom = canvas.width / (srcCanvas.width * zoomFraction);
    const viewW = canvas.width  / zoom;
    const viewH = canvas.height / zoom;

    const cx = Math.min(Math.max(previewCenter.x * srcCanvas.width,  viewW / 2), srcCanvas.width  - viewW / 2);
    const cy = Math.min(Math.max(previewCenter.y * srcCanvas.height, viewH / 2), srcCanvas.height - viewH / 2);

    // CMYK Pro downsamples a large source to a small canvas → smooth filter looks better.
    // Other modes zoom in to inspect dots → pixelated keeps hard edges.
    ctx.imageSmoothingEnabled = isCmykPro;
    if (isCmykPro) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, cx - viewW / 2, cy - viewH / 2, viewW, viewH, 0, 0, canvas.width, canvas.height);
  }, [activeSheet, processedLayers, processedLayerDims, ditherComposite, separationMode, previewCenter, canvasColor, proCmykSettings, isCmykPro]);

  const onPreviewDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    previewDragRef.current = { active: true, sx: e.clientX, sy: e.clientY, cx: previewCenter.x, cy: previewCenter.y };
  };
  const onPreviewMove = (e: React.PointerEvent) => {
    const d = previewDragRef.current;
    if (!d.active || !previewCanvasRef.current) return;
    const srcW = (separationMode === 'palette' && ditherComposite) ? ditherComposite.w : (processedLayerDims?.w ?? 1);
    const srcH = (separationMode === 'palette' && ditherComposite) ? ditherComposite.h : (processedLayerDims?.h ?? 1);
    const panFraction = isCmykPro ? 1.0 : 0.35;
    const zoom  = previewCanvasRef.current.width / (srcW * panFraction);
    const dxN = -(e.clientX - d.sx) / zoom / srcW;
    const dyN = -(e.clientY - d.sy) / zoom / srcH;
    setPreviewCenter({
      x: Math.min(Math.max(d.cx + dxN, 0), 1),
      y: Math.min(Math.max(d.cy + dyN, 0), 1),
    });
  };
  const onPreviewUp = () => { previewDragRef.current.active = false; };

  const subStatus = session?.subscriptionStatus;
  const subColor = subStatus === 'tester' ? '#38bdf8'
    : subStatus === 'trial' ? '#a78bfa'
    : subStatus === 'paused' || subStatus === 'cancelled' ? '#e6a817'
    : '#3ecf4f';

  const modeLabel = separationMode === 'threshold' ? 'Thresh'
    : separationMode === 'palette' ? 'Dither'
    : separationMode === 'color-sep' ? 'Color'
    : 'Vector';

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>

      {/* ─── Top Bar ─────────────────────────────────────────── */}
      <div style={{
        height: 52, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        zIndex: 10,
      }}>
        <AppIcon size={22} color="var(--accent)" />

        <div style={{ flex: 1, overflow: 'hidden' }}>
          {imageFileName ? (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
            }}>
              {imageFileName}
            </span>
          ) : (
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>
              AutoThresh™ <span style={{ color: 'var(--accent)' }}>Web</span>
            </span>
          )}
        </div>

        {/* Active mode badge */}
        {originalImage && (
          <div style={{
            fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.07em',
            background: 'var(--accent)', color: '#000',
            padding: '3px 8px', flexShrink: 0,
          }}>
            {modeLabel}
          </div>
        )}


        {/* Account button */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              width: 34, height: 34,
              background: menuOpen ? 'var(--surface-3)' : 'var(--surface-2)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
              WebkitTapHighlightColor: 'transparent',
            } as React.CSSProperties}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span style={{
              position: 'absolute', bottom: 4, right: 4,
              width: 6, height: 6, borderRadius: '50%',
              background: subColor, border: '1px solid var(--surface)',
              pointerEvents: 'none',
            }} />
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              width: 220,
              background: 'var(--surface)', border: '1px solid var(--border)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
              zIndex: 200,
            }}>
              <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>
                  {session?.firstName || session?.email?.split('@')[0] || 'User'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {session?.email}
                </div>
              </div>
              <div style={{ padding: '10px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button
                  onClick={() => { setMenuOpen(false); onLogout(); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                >
                  Sign out
                </button>
                <a
                  href="https://www.charleypangus.com/login"
                  target="_blank" rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                  style={{ border: '1px solid var(--border)', padding: '4px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textDecoration: 'none' }}
                >
                  Subscription
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Canvas ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
        <CanvasView />
      </div>

      {/* ─── Sheet backdrop ──────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 52, left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
          background: 'rgba(0,0,0,0.5)',
          opacity: activeSheet ? 1 : 0,
          pointerEvents: activeSheet ? 'all' : 'none',
          transition: 'opacity 0.25s ease',
          zIndex: 40,
        }}
        onClick={() => setActiveSheet(null)}
      />

      {/* ─── Bottom Sheet ────────────────────────────────────── */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        height: 'calc(100dvh - 52px - 64px - env(safe-area-inset-bottom, 0px))',
        background: 'var(--surface)',
        borderTop: '2px solid var(--accent)',
        transform: activeSheet ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1)',
        zIndex: 50,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
      }}>
        {/* Live preview strip — fills top, title/close overlaid */}
        {(activeSheet === 'layers' || activeSheet === 'controls') && (
          <div style={{ flexShrink: 0, position: 'relative', borderBottom: '1px solid var(--border)', cursor: 'grab', touchAction: 'none' }}>
            <canvas
              ref={previewCanvasRef}
              width={Math.round(window.innerWidth)}
              height={previewH}
              style={{ display: 'block', width: '100%', height: previewH }}
              onPointerDown={onPreviewDown}
              onPointerMove={onPreviewMove}
              onPointerUp={onPreviewUp}
              onPointerCancel={onPreviewUp}
            />
            {/* Title + close overlaid on preview */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 10px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, pointerEvents: 'none' }}>
                {activeSheet === 'layers' ? 'Layers & Modes' : 'Image Controls'}
              </span>
              <button
                onClick={() => setActiveSheet(null)}
                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 2, cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: '4px 6px', display: 'flex', pointerEvents: 'all', WebkitTapHighlightColor: 'transparent' } as React.CSSProperties}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div style={{
              position: 'absolute', bottom: 6, left: 8,
              fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)',
              pointerEvents: 'none',
            }}>
              Live · Drag to pan
            </div>
            <div style={{
              position: 'absolute', bottom: 6, right: 8,
              fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
              color: 'rgba(255,200,0,0.5)', pointerEvents: 'none',
            }}>
              ●
            </div>
          </div>
        )}

        {/* Scrollable content */}
        <div className="mobile-sheet-content" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {activeSheet === 'layers' && <LayerPanel />}
          {activeSheet === 'controls' && <ControlPanel cmykQuality={cmykQuality} />}
        </div>
      </div>

      {/* ─── Bottom Tab Bar ──────────────────────────────────── */}
      <div style={{
        height: 'calc(64px + env(safe-area-inset-bottom, 0px))',
        flexShrink: 0,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        alignItems: 'start',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        zIndex: 60, position: 'relative',
      }}>
        <MobileTab
          icon={<LayersIcon />}
          label="Layers"
          active={activeSheet === 'layers'}
          onClick={() => toggleSheet('layers')}
        />
        <MobileTab
          icon={<SlidersIcon />}
          label="Adjust"
          active={activeSheet === 'controls'}
          onClick={() => toggleSheet('controls')}
        />
        <MobileTab
          icon={<ShirtIcon />}
          label="Mockup"
          active={false}
          onClick={() => { setActiveSheet(null); onMockup(); }}
          disabled={!originalImage}
        />
        <MobileTab
          icon={<DownloadIcon />}
          label="Export"
          active={false}
          onClick={() => { setActiveSheet(null); onExport(); }}
          disabled={!originalImage}
          accent
        />
      </div>

      {/* Modals (passed from App.tsx) */}
      {children}
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

interface TabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}

function MobileTab({ icon, label, active, onClick, disabled, accent }: TabProps) {
  const color = disabled
    ? 'var(--text-dim)'
    : active
    ? 'var(--accent)'
    : accent
    ? 'var(--accent)'
    : 'var(--text-muted)';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: active ? 'color-mix(in srgb, var(--accent) 8%, var(--surface))' : 'none',
        border: 'none',
        borderTop: active ? '2px solid var(--accent)' : '2px solid transparent',
        cursor: disabled ? 'default' : 'pointer',
        color,
        opacity: disabled ? 0.35 : 1,
        padding: '6px 4px',
        transition: 'color 0.15s, background 0.15s',
        WebkitTapHighlightColor: 'transparent',
      } as React.CSSProperties}
    >
      {icon}
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <line x1="4" y1="21" x2="4" y2="14"/>
      <line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/>
      <line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/>
      <line x1="9" y1="8" x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  );
}

function ShirtIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/>
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}
