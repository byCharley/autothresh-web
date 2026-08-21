import { useEffect } from 'react';

// ─── Changelog data ───────────────────────────────────────────────────────────
// Add a new entry at the top whenever a significant update ships.
// date format: YYYY-MM-DD  (used for localStorage "seen" tracking)

interface Entry {
  date: string;
  label: string;
  added?: string[];
  improved?: string[];
  changed?: string[];
  fixed?: string[];
}

export const CHANGELOG: Entry[] = [
  {
    date: '2026-08-21',
    label: 'Manage Billing in the App',
    added: [
      'Pause, resume, or cancel your subscription from your name in the top bar — open the menu and tap Manage subscription. Cancelling ends the plan immediately — it will not renew or charge you again. Purchases are final and are not refunded.',
    ],
    fixed: [
      'Annual trial and subscription accounts were sometimes shown as Lifetime. Your badge now follows the plan you actually bought.',
    ],
  },
  {
    date: '2026-08-20',
    label: 'Dither Export Fix',
    fixed: [
      'Dither export background now matches the canvas. If you designed on a black garment, the exported PNG, PSD, PDF, and EPS stay black — previously transparent or removed-background pixels were flattening to white automatically.',
      'You can attach photos and design files in support chat again — including pictures from your phone. If an upload fails, you will see an error instead of the file disappearing.',
    ],
  },
  {
    date: '2026-08-13',
    label: 'Mobile Export Fix',
    fixed: [
      'Exporting on iPhone or iPad (Chrome or Safari) no longer wipes your work. Previously, tapping Export would show "Verifying…" and clear all edits because iOS does not support browser-based file downloads — the app was navigating away from itself. Exports on mobile now use the iOS Share Sheet so you can save directly to Files, Photos, or any app.',
    ],
  },
  {
    date: '2026-08-09',
    label: 'Texture Mode Fixes',
    fixed: [
      'Texture mode exports now match the preview exactly — colour blend, grain overlays, Xerox effect, and distress texture are all applied to the exported file. Previously the export was ignoring all texture settings and producing a plain threshold separation instead.',
      'Grain overlay blend modes (Multiply, Screen, Overlay, etc.) now work correctly — textures only affect artwork pixels and no longer bleed into the transparent background area. Matches standard Photoshop blend mode behaviour.',
      'Texture export no longer throws a canvas security error when grain overlays are active.',
      'Export modal in Texture mode simplified — Color Reference and White Underbase options hidden since they do not apply to a flat composite export.',
    ],
  },
  {
    date: '2026-08-03',
    label: 'DTG/DTF Solid Output Mode',
    added: [
      'Solid output mode in DTG/DTF — switch from Halftone to Solid to remove the background and export a clean transparent PNG without any halftone screen applied. Ideal for artwork that uses solid colours and doesn\'t need halftoning, like the "Don\'t Panic" design shown in the example.',
    ],
    improved: [
      'Solid mode automatically removes dark fringe and shadow edges around artwork. Edge pixels that were blended against the background are mathematically deblended back to their true colour — a grey anti-aliased edge pixel on a black background is recovered as pure white, not printed as a dark halo.',
      'Soft edges on transparent-background PNGs are sharpened to 100% opacity in Solid mode — semi-transparent edge pixels below 50% coverage are cut, solid pixels above are output at full opacity.',
    ],
  },
  {
    date: '2026-08-02',
    label: 'DTG/DTF Edge Cleanup & Chat File Attachments',
    added: [
      'Min Brightness slider in DTG/DTF Edge Cleanup — pixels darker than the threshold are excluded from halftone output. Eliminates the dark anti-aliased fringe that appears around white or light artwork on solid-colored backgrounds. Start around 10–30% if you\'re seeing a black border around your design.',
      'Edge Choke slider in DTG/DTF Edge Cleanup — shrinks the ink boundary inward by the selected number of pixels before halftoning. Removes soft-edge fringe on all artwork types, including solid-background images where the old control had no effect.',
      'Chat support now accepts design file attachments — attach JPG, PNG, PSD, AI, or TIFF files (up to 20 MB) directly to a support message so the team can see exactly what you\'re working with.',
    ],
    improved: [
      'Edge Choke now applies to the ink coverage signal rather than the alpha channel, making it effective for solid-background images as well as transparent-background PNGs.',
    ],
  },
  {
    date: '2026-07-25',
    label: 'Bottom Nav Masking & Solo Layer Button',
    added: [
      'Solo button on each color layer card — click to isolate a single layer so brush masking only affects that ink. Works for all color layers including the underbase layer.',
    ],
    improved: [
      'Remove BG and Brush Mask tools are now available in the bottom toolbar across Threshold, Dither, and Color Separation modes — one consistent masking location regardless of which mode you are using.',
    ],
  },
  {
    date: '2026-07-20',
    label: 'CMYK Pro Improvements & Toolbar Masking',
    added: [
      'Remove BG and Brush Mask tools are now available directly in the bottom toolbar for Dither and Color Separation modes — no need to scroll the left panel.',
      'Remove BG in CMYK modes now opens a settings popup with Tolerance slider and Pick BG Color eyedropper. Clicking the eyedropper and sampling a color automatically enables removal.',
    ],
    improved: [
      'CMYK Pro now applies separations to the entire image by default — transparent-background PNGs and images with solid backgrounds are handled correctly without any unwanted auto-removal.',
      'Background section in the left panel renamed to "BG Color" for clarity.',
      'Remove BG and Brush Mask tools removed from the left panel for Dither and Color Separation modes since they are now on the toolbar.',
    ],
    fixed: [
      'CMYK Pro was incorrectly making the background transparent on images with solid black backgrounds (e.g. transparent-black PNGs) even when Remove BG was off.',
      'Stale cache in CMYK Pro could persist an old background mask after toggling Remove BG off, causing the background to appear transparent. Now always reflects the current setting instantly.',
    ],
  },
  {
    date: '2026-07-17',
    label: 'Bug Fixes',
    fixed: [
      'Remove BG was unreachable on iPhone — the panel content was being clipped and could not be scrolled to. Now fully accessible.',
      'Remove BG section now opens expanded by default on all modes so it is always visible without needing to scroll and expand it manually.',
      'Clear Touch Up in DTG/DTF mode was not visually resetting — painted brush strokes remained on screen even after clearing. Now clears correctly.',
      'Account menu (name, plan, sign out) was rendering behind the canvas on some browsers. Fixed.',
      'Display name changes now persist after signing out and back in.',
    ],
  },
  {
    date: '2026-07-14',
    label: 'Tablet Improvements',
    fixed: [
      'Export button was disappearing on tablet screens — it is now always visible across all modes and screen sizes.',
    ],
    improved: [
      'Sliders on tablet are now noticeably smoother and more responsive — dragging updates the preview instantly with no lag or stutter.',
      'Slider height reduced slightly on touchscreen devices for a more compact, comfortable layout.',
    ],
  },
  {
    date: '2026-07-13',
    label: 'Access & Subscription Fix',
    fixed: [
      'Resolved an issue where some monthly subscribers were incorrectly shown a "Free Trial" badge on first login.',
      'Resolved an issue where lifetime license holders were unable to log in.',
      'Resolved an issue where monthly subscribers were incorrectly identified as lifetime customers.',
      'Apologies for any inconvenience — all access checks are now working correctly. If you are still having trouble logging in, please contact us.',
    ],
  },
  {
    date: '2026-07-10',
    label: 'Xerox Effect — Texture Mode',
    added: [
      'Xerox effect added to Texture mode — apply a photocopy look as a final pass on any texture composite. Choose between Fax (high-contrast black & white) or Hybrid (color-preserving with posterized tones and a color boost). Controls include grain strength, threshold, and color boost.',
      'Texture mode background simplified to a single color wheel — pick any canvas color instantly.',
    ],
    improved: [
      'Texture mode right panel reorganized — Color Blend, Color Zone Pattern, Xerox Effect, and Image Adjustments in a clean top-to-bottom order.',
      'Texture mode controls stay visible and greyed out before an image is loaded, so you can configure the look before uploading.',
    ],
  },
  {
    date: '2026-07-09',
    label: 'DTG/DTF Engine V2 — Sine-Wave Halftone',
    added: [
      'Completely new halftone engine for DTG/DTF mode — rebuilt from the ground up using a per-pixel sine-wave screen algorithm. Every pixel\'s colour distance from the background directly drives dot coverage, producing clean, natural halftone fades with no cell artifacts.',
      'Auto background detection — the engine samples the four image corners to identify and suppress your background colour automatically. No manual removal step needed for most artwork.',
      'Eyedropper tool — click any pixel on the canvas to lock in a custom background colour, overriding auto-detect.',
      'Ink Signal controls: Shadow Cutoff (removes faint fringing), Highlight (boosts midtone coverage), and Gamma (opens up or compresses the tonal range).',
    ],
    improved: [
      'Halftone dots are significantly finer and more accurate — cell size now scales with image width, matching professional RIP output quality at any document resolution.',
      'LPI and Angle controls remain, giving full creative control over dot frequency and screen angle.',
      'Eyedropper button now shows the correct pipette icon.',
    ],
    changed: [
      'Shape picker and Stage Preview selector removed — the sine-wave screen produces superior results without needing shape selection. The output is always the final halftone-ready transparent PNG.',
    ],
  },
  {
    date: '2026-07-08',
    label: 'DTG/DTF Halftone Engine Rewrite',
    added: [
      'Photoshop-style bitmap workflow — greyscale levels → halftone → alpha mask. Dark pixels drop out naturally; no background removal step needed.',
      'Greyscale Mask controls (Black Point, White Point, Midtones) with a live Preview toggle so you can dial in the mask before seeing the halftone result.',
      'Image Adjustments (Exposure, Contrast, Shadows, Highlights, Saturation, Levels, Curves) now live on the left panel in DTG mode — always open and ready.',
      'Touch Up brush moved to the right panel alongside the screen controls — Erase and Restore buttons are full-width and touch-friendly.',
    ],
    improved: [
      'Garment color picker redesigned — large active swatch, color name display, and a clean 6-column rounded swatch grid replacing the old tiny squares.',
      'Slider knobs are circular in DTG mode on both panels.',
      'Consistent spacing between all sliders in the Greyscale Mask and Screen Settings sections.',
    ],
  },
  {
    date: '2026-07-07',
    label: 'Theme Color Picker',
    added: [
      'Pick your accent color — gear icon in the top bar lets you switch between Orange, Citrine, Red, Green, Blue, and Grey. Your choice saves to your account and applies automatically on every device you log in from.',
    ],
  },
  {
    date: '2026-07-06',
    label: 'DTG / DTF Mode Overhaul',
    fixed: [
      'Fabric export now composites artwork over the garment color before applying the fabric blend — the exported file is pixel-for-pixel identical to the canvas preview. Previously the blend was applied to the solid garment color before artwork was drawn, producing a washed-out result.',
      'Erase tool in DTG mode now correctly removes painted mask areas instead of toggling incorrectly in certain brush states.',
    ],
    improved: [
      'DTG / DTF mode is now a first-class separation mode alongside Thresh, Dither, Color, CMYK, and Texture — six modes total.',
      'White channel and fabric preview controls are more responsive during interactive editing.',
    ],
    added: [
      'DTG / DTF showcase added to the landing page — interactive before/after slider showing the full knockout workflow from raw artwork to fabric-blended garment.',
    ],
  },
  {
    date: '2026-07-05',
    label: 'Canvas Controls & Edge Softness',
    added: [
      'Canvas border toggle — new button in the canvas toolbar hides or shows the orange dashed outline around your artwork area.',
      'B/W button on texture overlays — desaturates any texture to black & white before blending, ideal for monotone fabric prints.',
    ],
    improved: [
      'Edge softness now blurs the artwork\'s alpha mask before any pattern is applied — the selected halftone or texture naturally creates the soft edge, giving consistent results across all separation modes.',
    ],
    changed: [
      'True AM Halftone patterns removed — they weren\'t producing reliable output and will return in a future update.',
    ],
  },
  {
    date: '2026-07-02',
    label: 'v1.0.2 — CorelDRAW Export & Layer Renaming',
    added: [
      'CorelDRAW export — new CDR format produces a ZIP of numbered EPS plates with spot-color DSC headers and a step-by-step README-CorelDRAW.txt import guide. Works in all screen-print separation modes.',
      'Layer renaming — double-click any layer name in Thresh, Dither, or Color mode to rename it. Custom names carry through to all export formats (PSD layer names, EPS/TIFF/PNG filenames, etc.).',
    ],
    improved: [
      'CMYK Pro underbase now uses art presence instead of ink density — highlights with near-zero CMYK ink no longer expose dark garment fabric through a thin white layer.',
      'CMYK Pro dot gain and tone curve controls respond instantly. Interactive adjustments now use a 2× render pass instead of 4×, giving roughly 8–16× faster feedback.',
    ],
    fixed: [
      'Stats Dashboard was inaccessible on mobile for creator accounts.',
      'CMYK Pro layer panel now shows channel cards first, then ICC Separation — consistent with all other modes.',
    ],
  },
  {
    date: '2026-06-30',
    label: 'CMYK Pro Fixes',
    improved: [
      'Adapt now instantly updates the canvas aspect ratio — switching preview modes (Raw, Inspect, Print Sim) no longer reverts to the previous document size.',
      'Print Sim loading bar reliably clears after processing completes and no longer gets stuck when switching modes.',
      'Clicking Inspect auto-clears any isolated (soloed) layer so the full composite is always visible.',
    ],
    added: [
      'Subscribe modal — choose Monthly ($11.99/mo) or Annual ($115.10/yr) plans with a 3-day free trial, accessible from the login screen.',
    ],
  },
  {
    date: '2026-06-26',
    label: 'Performance & Export',
    added: [
      'Document Bleed — expands the canvas around your artwork so registration marks never overlap the design.',
      'PSD layer names now include the ink\'s hex code (e.g. "C1 · #FF5500") so Photoshop shows color at a glance.',
      'Color Reference is now exported as a Photoshop layer (above all ink layers) when Include Color Info is checked.',
    ],
    improved: [
      'Color-sep mode is significantly faster — K-means clustering now runs once per image. Adjusting image exposure, contrast, or pattern settings no longer re-clusters from scratch.',
      'Eliminated a duplicate pixel-assignment pass during composite preview — roughly 2× faster per color-sep update.',
    ],
    changed: [
      'Registration Marks: the old "Bleed" slider is now "Mark Offset". A new "Bleed" slider controls canvas expansion.',
    ],
  },
  {
    date: '2026-06-22',
    label: 'UI & Defaults',
    added: [
      'Registration Marks moved into its own collapsible section below Document Setup.',
    ],
    improved: [
      'Color-sep swatches now display in a compact 3-column grid — up to 30 colors visible without scrolling.',
      'Zoom quality improved: all modes use smooth bilinear upscaling when zooming in. Dither mode keeps pixel-perfect nearest-neighbor rendering.',
      'Clicking "New" now fully clears the color palette and all color-sep colors so you start fresh.',
    ],
    changed: [
      'Document Setup is collapsed by default.',
      'Color-sep and all noise textures now default to Scale = 1.',
      'Color-sep mode defaults to Noise Standard pattern.',
    ],
  },
];

export const CHANGELOG_LATEST_DATE = CHANGELOG[0].date;
const LS_KEY = 'at-changelog-seen';

export function hasUnseenUpdates(): boolean {
  try {
    const seen = localStorage.getItem(LS_KEY);
    if (!seen) return true;
    return seen < CHANGELOG_LATEST_DATE;
  } catch { return false; }
}

export function markChangelogSeen() {
  try { localStorage.setItem(LS_KEY, CHANGELOG_LATEST_DATE); } catch { /* */ }
}

// ─── Tag component ────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  NEW:      { bg: 'rgba(82, 196, 26, 0.15)',  text: '#52c41a' },
  IMPROVED: { bg: 'rgba(250, 173, 20, 0.15)', text: '#faad14' },
  CHANGED:  { bg: 'rgba(24, 144, 255, 0.15)', text: '#1890ff' },
  FIXED:    { bg: 'rgba(255, 77, 79, 0.15)',  text: '#ff4d4f' },
};

function Tag({ type }: { type: keyof typeof TAG_COLORS }) {
  const { bg, text } = TAG_COLORS[type];
  return (
    <span style={{
      display: 'inline-block', flexShrink: 0,
      fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
      letterSpacing: '0.10em', textTransform: 'uppercase',
      padding: '2px 6px', borderRadius: 2,
      background: bg, color: text,
      marginTop: 1,
    }}>
      {type}
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props { onClose: () => void; onContact?: () => void; }

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function WhatsNewModal({ onClose, onContact }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999, padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        maxWidth: 580, width: '100%', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        borderRadius: 2,
      }}>

        {/* Header */}
        <div style={{
          padding: '18px 22px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)',
            }}>
              What's New
            </span>
            <span style={{
              fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)',
              letterSpacing: '0.05em',
            }}>
              AutoThresh™ Web
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: 4, lineHeight: 1 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '6px 0 16px' }}>
          {CHANGELOG.map((entry, ei) => (
            <div key={entry.date} style={{
              padding: '16px 22px 0',
              borderTop: ei > 0 ? '1px solid var(--border)' : undefined,
              marginTop: ei > 0 ? 6 : 0,
            }}>
              {/* Entry header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                  color: 'var(--text)', letterSpacing: '0.04em',
                }}>
                  {formatDate(entry.date)}
                </span>
                <span style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)', letterSpacing: '0.04em',
                }}>
                  — {entry.label}
                </span>
              </div>

              {/* Change items */}
              {(['added', 'improved', 'changed', 'fixed'] as const).map((type) => {
                const items = entry[type];
                if (!items?.length) return null;
                const tagType = type === 'added' ? 'NEW'
                  : type === 'improved' ? 'IMPROVED'
                  : type === 'changed'  ? 'CHANGED'
                  : 'FIXED';
                return items.map((text, i) => (
                  <div key={`${type}-${i}`} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    marginBottom: 8, paddingLeft: 2,
                  }}>
                    <Tag type={tagType} />
                    <span style={{
                      fontSize: 11, color: 'var(--text-muted)',
                      fontFamily: 'var(--font-sans)', lineHeight: 1.6,
                      flex: 1,
                    }}>
                      {text}
                    </span>
                  </div>
                ));
              })}
            </div>
          ))}

          {/* Footer note */}
          <div style={{
            margin: '16px 22px 0',
            paddingTop: 14, borderTop: '1px solid var(--border)',
            fontSize: 10, fontFamily: 'var(--font-mono)',
            color: 'var(--text-dim)', lineHeight: 1.7,
          }}>
            Updates ship automatically — no reinstall needed.{' '}
            {onContact ? (
              <button onClick={onContact} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit' }}>
                Send feedback or report a bug →
              </button>
            ) : (
              <a href="https://charleypangus.com/pages/support" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                Send feedback or report a bug →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
