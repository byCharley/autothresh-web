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
  onAnalytics?: () => void;
  session: Session | null;
  children?: React.ReactNode;
}

type Sheet = 'layers' | 'controls' | null;

export function MobileLayout({ onExport, onMockup, onLogout, onAnalytics, session, children }: Props) {
  const [activeSheet, setActiveSheet] = useState<Sheet>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewCenter, setPreviewCenter] = useState({ x: 0.5, y: 0.5 });
  const menuRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewDragRef = useRef({ active: false, sx: 0, sy: 0, cx: 0.5, cy: 0.5 });
  const { originalImage, imageFileName, separationMode, setSeparationMode,
          passthroughMode, cmykQuality,
          processedLayers, processedLayerDims, ditherComposite,
          canvasColor, setCanvasColor,
          showFabricBg, setShowFabricBg,
          fabricTexture, setFabricTexture,
          proCmykSettings } = useStore();

  const [modePickerOpen, setModePickerOpen] = useState(false);
  const [showCmykDisclaimer, setShowCmykDisclaimer] = useState(false);
  const [cmykDisclaimerNeverShow, setCmykDisclaimerNeverShow] = useState(false);
  const [showTextureDisclaimer, setShowTextureDisclaimer] = useState(false);
  const [textureDisclaimerNeverShow, setTextureDisclaimerNeverShow] = useState(false);

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
    } else if (ditherComposite && (separationMode === 'palette' || separationMode === 'dtg' || separationMode === 'texture')) {
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
    const usesDitherComposite = ditherComposite && (separationMode === 'palette' || separationMode === 'dtg' || separationMode === 'texture');
    const srcW = usesDitherComposite ? ditherComposite!.w : (processedLayerDims?.w ?? 1);
    const srcH = usesDitherComposite ? ditherComposite!.h : (processedLayerDims?.h ?? 1);
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

  const MODE_OPTS = [
    { value: 'threshold', label: 'Threshold' },
    { value: 'palette',   label: 'Dither' },
    { value: 'color-sep', label: 'Color Sep' },
    { value: 'cmyk-pro',  label: 'CMYK Pro' },
    { value: 'dtg',       label: 'DTG / DTF' },
    { value: 'texture',   label: 'Texture' },
  ] as const;

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
              {subStatus === 'creator' && onAnalytics && (
                <div style={{ padding: '8px 14px 0', borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => { setMenuOpen(false); onAnalytics(); }}
                    style={{
                      width: '100%', background: 'none', border: '1px solid var(--border)',
                      cursor: 'pointer', padding: '7px 10px', fontSize: 11,
                      color: 'var(--accent)', fontFamily: 'var(--font-mono)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                    Analytics
                  </button>
                </div>
              )}
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

      {/* ─── Mode row + BG quick controls ────────────────────── */}
      {originalImage && (
        <div style={{
          flexShrink: 0, position: 'relative',
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 10px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', flexShrink: 0 }}>
            Mode
          </span>
          {/* Mode button — shrinks to make room for BG controls */}
          <button
            onClick={() => !passthroughMode && setModePickerOpen(v => !v)}
            style={{
              flex: 1, minWidth: 0, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 8px',
              background: modePickerOpen ? '#252525' : 'var(--surface)',
              border: `1px solid ${modePickerOpen ? 'var(--accent)' : 'var(--border)'}`,
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.07em', textTransform: 'uppercase',
              cursor: passthroughMode ? 'default' : 'pointer',
              opacity: passthroughMode ? 0.4 : 1,
              overflow: 'hidden',
              WebkitTapHighlightColor: 'transparent',
            } as React.CSSProperties}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {MODE_OPTS.find(m => m.value === separationMode)?.label ?? separationMode}
            </span>
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none" style={{ flexShrink: 0, marginLeft: 4, transform: modePickerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              <path d="M0 0l4 5 4-5z" fill="var(--accent)"/>
            </svg>
          </button>

          {/* BG color swatch */}
          <div style={{
            position: 'relative', width: 22, height: 22, flexShrink: 0,
            background: canvasColor,
            border: '1.5px solid color-mix(in srgb, currentColor 20%, var(--border-2))',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
            opacity: showFabricBg ? 1 : 0.5,
            cursor: 'pointer',
          }}>
            <input type="color" value={canvasColor} onChange={e => setCanvasColor(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
          </div>
          {/* Show BG */}
          <button onClick={() => setShowFabricBg(!showFabricBg)}
            style={{
              fontSize: 9, padding: '2px 7px', height: 22, flexShrink: 0,
              fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              color: showFabricBg ? 'var(--accent)' : 'var(--text-dim)',
              background: showFabricBg ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${showFabricBg ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer', borderRadius: 2, WebkitTapHighlightColor: 'transparent',
            } as React.CSSProperties}
          >Show</button>
          {/* Fabric */}
          <button
            onClick={() => {
              if (fabricTexture !== 'none') { setFabricTexture('none'); }
              else { setFabricTexture('light'); if (!showFabricBg) setShowFabricBg(true); }
            }}
            style={{
              fontSize: 9, padding: '2px 7px', height: 22, flexShrink: 0,
              fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              color: fabricTexture !== 'none' ? 'var(--accent)' : 'var(--text-dim)',
              background: fabricTexture !== 'none' ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${fabricTexture !== 'none' ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer', borderRadius: 2, WebkitTapHighlightColor: 'transparent',
            } as React.CSSProperties}
          >Fabric</button>

          {modePickerOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 2px)', left: 10, right: 10,
              background: 'var(--surface)', border: '1px solid var(--accent)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 200,
            }}>
              {MODE_OPTS.map((m, i) => (
                <button
                  key={m.value}
                  onClick={() => {
                    setSeparationMode(m.value as Parameters<typeof setSeparationMode>[0]);
                    if (m.value === 'cmyk-pro' && !localStorage.getItem('cmyk-disclaimer-dismissed')) {
                      setCmykDisclaimerNeverShow(false);
                      setTimeout(() => setShowCmykDisclaimer(true), 0);
                    }
                    if (m.value === 'texture' && !localStorage.getItem('texture-disclaimer-dismissed')) {
                      setTextureDisclaimerNeverShow(false);
                      setTimeout(() => setShowTextureDisclaimer(true), 0);
                    }
                    setModePickerOpen(false);
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '11px 14px',
                    background: separationMode === m.value ? 'color-mix(in srgb, var(--accent) 10%, var(--surface))' : 'transparent',
                    border: 'none',
                    borderBottom: i < MODE_OPTS.length - 1 ? '1px solid var(--border)' : 'none',
                    color: separationMode === m.value ? 'var(--accent)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
                    letterSpacing: '0.07em', textTransform: 'uppercase',
                    cursor: 'pointer', textAlign: 'left',
                    WebkitTapHighlightColor: 'transparent',
                  } as React.CSSProperties}
                >
                  {m.label}
                  {separationMode === m.value && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
          {activeSheet === 'layers' && <LayerPanel hideModeSwitch />}
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

      {/* Close mode picker when tapping outside */}
      {modePickerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setModePickerOpen(false)} />
      )}

      {/* Texture disclaimer */}
      {showTextureDisclaimer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', width: '100%', maxWidth: 360, padding: '28px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', color: 'var(--text)', textTransform: 'uppercase' }}>
                Texture Mode — Experimental
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
              Texture mode is a new experimental feature. Use it to build grunge, vintage, and hand-printed looks by layering textures directly on your artwork.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={textureDisclaimerNeverShow} onChange={(e) => setTextureDisclaimerNeverShow(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Don't show this again</span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { if (textureDisclaimerNeverShow) localStorage.setItem('texture-disclaimer-dismissed', '1'); setShowTextureDisclaimer(false); }}
                style={{ padding: '8px 18px', fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer', fontWeight: 700 }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CMYK Pro disclaimer */}
      {showCmykDisclaimer && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', width: '100%', maxWidth: 360, padding: '28px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', color: 'var(--text)', textTransform: 'uppercase' }}>
                CMYK Pro — Work in Progress
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6, margin: 0 }}>
              CMYK Pro mode is under active development. Use it for experimentation and proofing — always verify with a physical press proof before final production.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={cmykDisclaimerNeverShow} onChange={(e) => setCmykDisclaimerNeverShow(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 14, height: 14 }} />
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>Don't show this again</span>
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { if (cmykDisclaimerNeverShow) localStorage.setItem('cmyk-disclaimer-dismissed', '1'); setShowCmykDisclaimer(false); }}
                style={{ padding: '8px 18px', fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer', fontWeight: 700 }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

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
