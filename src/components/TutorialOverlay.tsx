import { useState, useEffect, useCallback } from 'react';

interface Step {
  key: string | null;
  title: string;
  desc: string;
}

const STEPS: Step[] = [
  {
    key: null,
    title: 'Welcome to AutoThresh™',
    desc: 'This quick tour covers the key tools. Click Next to continue, or Skip to explore on your own.',
  },
  {
    key: 'tutorial-modes',
    title: 'Separation Mode',
    desc: 'Choose how to split your image. Thresh separates by tone into spot color layers. Dither simulates colors with halftone patterns. Color clusters by hue. Vector traces to SVG.',
  },
  {
    key: 'tutorial-layers',
    title: 'Layers Panel',
    desc: 'Each layer is one ink color. Select a layer to adjust its tonal range, rename it, change its color, or paint and erase areas manually.',
  },
  {
    key: 'tutorial-canvas',
    title: 'Live Preview',
    desc: 'Your artwork updates in real time. Drag to pan, scroll or pinch to zoom. The paint tools let you manually add or erase areas on any layer.',
  },
  {
    key: 'tutorial-controls',
    title: 'Controls Panel',
    desc: 'Fine-tune image settings like brightness and contrast, set your document size and DPI, and control background removal. Settings adapt to the active mode.',
  },
  {
    key: 'tutorial-presets',
    title: 'Presets',
    desc: 'Save your current layer setup as a preset to reuse across projects. Presets are stored to your account so they follow you across devices.',
  },
  {
    key: 'tutorial-mockup',
    title: 'Mockup Preview',
    desc: 'See your artwork on a garment before you export. Drag to reposition, adjust scale, and download a preview PNG to share with clients.',
  },
  {
    key: 'tutorial-export',
    title: 'Export',
    desc: 'Download your separated layers as individual PNGs, a layered PSD, or a ZIP. Each layer is production-ready for your screen printer.',
  },
];

const PAD = 6;
const CARD_W = 300;
const ARROW_H = 28;   // height of the floating arrow SVG
const CARD_GAP = 10;  // gap between arrow and card edge

export function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const current = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const measureTarget = useCallback(() => {
    if (!current.key) { setRect(null); return; }
    const el = document.querySelector(`[data-tutorial="${current.key}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [current.key]);

  useEffect(() => {
    measureTarget();
    window.addEventListener('resize', measureTarget);
    return () => window.removeEventListener('resize', measureTarget);
  }, [measureTarget]);

  const next = () => { if (isLast) onClose(); else setStep(s => s + 1); };
  const prev = () => setStep(s => Math.max(0, s - 1));

  const hl = rect ? {
    left: rect.left - PAD,
    top: rect.top - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  let tooltipStyle: React.CSSProperties = {};
  let arrowSide: 'top' | 'bottom' | null = null;
  let arrowX = 0; // left edge of the floating arrow SVG (24px wide)

  const TOTAL_GAP = ARROW_H + CARD_GAP * 2; // space reserved between highlight and card

  if (hl) {
    const spaceBelow = window.innerHeight - (hl.top + hl.height);
    const spaceAbove = hl.top;
    const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;

    let left = hl.left + hl.width / 2 - CARD_W / 2;
    left = Math.max(12, Math.min(window.innerWidth - CARD_W - 12, left));

    // Center arrow on the highlighted element's midpoint
    arrowX = hl.left + hl.width / 2 - 12;

    if (placeBelow) {
      const top = Math.min(window.innerHeight - 220, hl.top + hl.height + TOTAL_GAP);
      tooltipStyle = { left, top };
      arrowSide = 'top';
    } else {
      const top = Math.max(12, hl.top - TOTAL_GAP - 220);
      tooltipStyle = { left, top };
      arrowSide = 'bottom';
    }
  } else {
    tooltipStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  }

  // Floating arrow position (between highlight and card)
  const arrowY = hl && arrowSide === 'top'
    ? hl.top + hl.height + CARD_GAP
    : hl && arrowSide === 'bottom'
      ? hl.top - CARD_GAP - ARROW_H
      : 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9990, pointerEvents: 'all' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <style>{`
        @keyframes at-arrow-bounce-up   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes at-arrow-bounce-down { 0%,100%{transform:translateY(0)} 50%{transform:translateY(5px)} }
      `}</style>

      {/* Spotlight */}
      {hl ? (
        <div style={{
          position: 'fixed',
          left: hl.left, top: hl.top,
          width: hl.width, height: hl.height,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
          border: '2px solid var(--accent)',
          borderRadius: 3,
          pointerEvents: 'none',
          zIndex: 9991,
          transition: 'left 0.22s ease, top 0.22s ease, width 0.22s ease, height 0.22s ease',
        }} />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', pointerEvents: 'none', zIndex: 9991 }} />
      )}

      {/* Floating directional arrow */}
      {hl && arrowSide && (
        <div style={{
          position: 'fixed',
          left: arrowX,
          top: arrowY,
          width: 24,
          height: ARROW_H,
          zIndex: 9993,
          pointerEvents: 'none',
          animation: arrowSide === 'top'
            ? 'at-arrow-bounce-up 1.1s ease-in-out infinite'
            : 'at-arrow-bounce-down 1.1s ease-in-out infinite',
        }}>
          {arrowSide === 'top' ? (
            // Points upward toward the highlighted element
            <svg width="24" height="28" viewBox="0 0 24 28" fill="none">
              <line x1="12" y1="26" x2="12" y2="8" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
              <polyline points="4,16 12,4 20,16" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            // Points downward toward the highlighted element
            <svg width="24" height="28" viewBox="0 0 24 28" fill="none">
              <line x1="12" y1="2" x2="12" y2="20" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
              <polyline points="4,12 12,24 20,12" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      )}

      {/* Tooltip card */}
      <div
        style={{
          position: 'fixed',
          width: CARD_W,
          background: 'var(--surface)',
          border: '1px solid var(--accent)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
          zIndex: 9992,
          pointerEvents: 'all',
          ...tooltipStyle,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 18px 12px' }}>
          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>
            Step {step + 1} of {STEPS.length}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 8 }}>
            {current.title}
          </div>
          <p style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--text-muted)', lineHeight: 1.78 }}>
            {current.desc}
          </p>
        </div>

        <div style={{ padding: '0 18px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            style={{ fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.55, height: 26 }}
          >
            Skip
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            {!isFirst && (
              <button className="btn btn-ghost" onClick={prev} style={{ fontSize: 10, height: 26 }}>
                ← Back
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={next}
              style={{ fontSize: 10, height: 26, color: '#000', minWidth: 68 }}
            >
              {isLast ? 'Done ✓' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
