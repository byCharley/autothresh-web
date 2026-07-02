import { useState, useEffect, useCallback } from 'react';
import type { Session } from '../auth/useAuth';

interface AnalyticsData {
  period: { days: number; since: string };
  summary: { totalEvents: number; loginCount: number; appOpenCount: number; uniqueUsers: number; peakHour: number };
  devices: { desktop: number; mobile: number; tablet: number };
  countries: Array<{ country: string; count: number }>;
  dailyTrend: Array<{ date: string; logins: number; opens: number; unique: number }>;
  hourly: number[];
  subscriptions: { active: number; trial: number; paused: number; cancelled: number; total: number };
  subTrend: Array<{ date: string; active: number; trial: number; paused: number; cancelled: number; total: number }>;
}

// ── SVG line + area chart ───────────────────────────────────────────────────
function TrendChart({ data }: { data: AnalyticsData['dailyTrend']; days?: number }) {
  const W = 560; const H = 160; const PAD = { t: 10, r: 10, b: 32, l: 42 };
  const cW = W - PAD.l - PAD.r; const cH = H - PAD.t - PAD.b;

  const maxUnique = Math.max(...data.map(d => d.unique), 1);
  const maxOpens  = Math.max(...data.map(d => d.opens),  1);
  const yMax = Math.max(maxUnique, maxOpens, 1);

  const xPos = (i: number) => PAD.l + (i / (data.length - 1)) * cW;
  const yPos = (v: number) => PAD.t + cH - (v / yMax) * cH;

  const linePath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');

  const areaPath = (vals: number[]) => {
    const base = PAD.t + cH;
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ')
      + ` L${xPos(data.length - 1).toFixed(1)},${base} L${xPos(0).toFixed(1)},${base} Z`;
  };

  // x-axis labels: show ~6 evenly spaced dates
  const labelStep = Math.max(1, Math.floor(data.length / 5));
  const xLabels = data.filter((_, i) => i === 0 || i === data.length - 1 || i % labelStep === 0);

  // y-axis ticks
  const yTicks = [0, Math.round(yMax / 2), yMax];

  const uniqueVals = data.map(d => d.unique);
  const opensVals  = data.map(d => d.opens);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="grad-unique" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="grad-opens" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Y grid lines */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PAD.l} y1={yPos(v)} x2={W - PAD.r} y2={yPos(v)} stroke="var(--border)" strokeWidth="0.5" />
          <text x={PAD.l - 6} y={yPos(v) + 4} textAnchor="end" fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)">{v}</text>
        </g>
      ))}

      {/* Area fills */}
      <path d={areaPath(opensVals)} fill="url(#grad-opens)" />
      <path d={areaPath(uniqueVals)} fill="url(#grad-unique)" />

      {/* Lines */}
      <path d={linePath(opensVals)} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      <path d={linePath(uniqueVals)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* X-axis labels */}
      {xLabels.map(d => {
        const i = data.indexOf(d);
        const label = d.date.slice(5); // "MM-DD"
        return (
          <text key={d.date} x={xPos(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

// ── Donut chart ─────────────────────────────────────────────────────────────
function DonutChart({ desktop, mobile, tablet }: { desktop: number; mobile: number; tablet: number }) {
  const total = desktop + mobile + tablet || 1;
  const cx = 60; const cy = 60; const R = 45; const r = 28;

  function slice(value: number, startAngle: number, color: string) {
    const angle = (value / total) * 2 * Math.PI;
    if (angle < 0.001) return null;
    const endAngle = startAngle + angle;
    const x1 = cx + R * Math.sin(startAngle); const y1 = cy - R * Math.cos(startAngle);
    const x2 = cx + R * Math.sin(endAngle);   const y2 = cy - R * Math.cos(endAngle);
    const ix1 = cx + r * Math.sin(startAngle); const iy1 = cy - r * Math.cos(startAngle);
    const ix2 = cx + r * Math.sin(endAngle);   const iy2 = cy - r * Math.cos(endAngle);
    const large = angle > Math.PI ? 1 : 0;
    return (
      <path
        key={color}
        d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${r},${r} 0 ${large},0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`}
        fill={color}
      />
    );
  }

  let angle = 0;
  const desktopSlice = slice(desktop, angle, 'var(--accent)');        angle += (desktop / total) * 2 * Math.PI;
  const mobileSlice  = slice(mobile,  angle, '#60a5fa');               angle += (mobile  / total) * 2 * Math.PI;
  const tabletSlice  = slice(tablet,  angle, '#a78bfa');

  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        {desktopSlice}{mobileSlice}{tabletSlice}
        <circle cx={cx} cy={cy} r={r - 1} fill="var(--surface)" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--text)" fontFamily="var(--font-mono)">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="var(--text-dim)" fontFamily="var(--font-mono)">TOTAL</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { label: 'Desktop', value: desktop, pct: pct(desktop), color: 'var(--accent)' },
          { label: 'Mobile',  value: mobile,  pct: pct(mobile),  color: '#60a5fa' },
          { label: 'Tablet',  value: tablet,  pct: pct(tablet),  color: '#a78bfa' },
        ].map(({ label, value, pct: p, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', width: 52 }}>{label}</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600, width: 28 }}>{p}%</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Subscription trend chart ────────────────────────────────────────────────
function SubTrendChart({ data }: { data: AnalyticsData['subTrend'] }) {
  if (data.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 0', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
        No snapshot data yet — first snapshot runs at 6:00 AM UTC daily.
      </div>
    );
  }

  const W = 560; const H = 140; const PAD = { t: 10, r: 10, b: 32, l: 42 };
  const cW = W - PAD.l - PAD.r; const cH = H - PAD.t - PAD.b;

  const maxVal = Math.max(...data.map(d => d.active + d.trial), 1);
  const xPos = (i: number) => PAD.l + (data.length === 1 ? cW / 2 : (i / (data.length - 1)) * cW);
  const yPos = (v: number) => PAD.t + cH - (v / maxVal) * cH;

  const linePath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ');

  const areaPath = (vals: number[]) => {
    const base = PAD.t + cH;
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ')
      + ` L${xPos(data.length - 1).toFixed(1)},${base} L${xPos(0).toFixed(1)},${base} Z`;
  };

  const yTicks = [0, Math.round(maxVal / 2), maxVal];
  const labelStep = Math.max(1, Math.floor(data.length / 5));
  const xLabels = data.filter((_, i) => i === 0 || i === data.length - 1 || i % labelStep === 0);

  const activeVals = data.map(d => d.active);
  const trialVals  = data.map(d => d.trial);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id="grad-active" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="grad-trial" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map(v => (
        <g key={v}>
          <line x1={PAD.l} y1={yPos(v)} x2={W - PAD.r} y2={yPos(v)} stroke="var(--border)" strokeWidth="0.5" />
          <text x={PAD.l - 6} y={yPos(v) + 4} textAnchor="end" fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)">{v}</text>
        </g>
      ))}
      <path d={areaPath(trialVals)}  fill="url(#grad-trial)" />
      <path d={areaPath(activeVals)} fill="url(#grad-active)" />
      <path d={linePath(trialVals)}  fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <path d={linePath(activeVals)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {xLabels.map(d => {
        const i = data.indexOf(d);
        return (
          <text key={d.date} x={xPos(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)">
            {d.date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

// ── Hourly bar chart ────────────────────────────────────────────────────────
function HourlyChart({ hourly }: { hourly: number[] }) {
  const max = Math.max(...hourly, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 50 }}>
      {hourly.map((v, h) => {
        const height = Math.max(2, (v / max) * 46);
        const isAM   = h < 12;
        const label  = h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
        const showLabel = h % 6 === 0;
        return (
          <div key={h} title={`${label}: ${v} events`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: '100%', height,
              background: isAM ? 'var(--accent)' : '#60a5fa',
              opacity: v === 0 ? 0.15 : 0.85,
              transition: 'height 0.3s ease',
            }} />
            {showLabel && (
              <span style={{ fontSize: 7, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 2, whiteSpace: 'nowrap' }}>
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Flag emoji from ISO country code ───────────────────────────────────────
function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍';
  const offset = 0x1F1E6 - 0x41;
  return String.fromCodePoint(code.toUpperCase().charCodeAt(0) + offset) +
         String.fromCodePoint(code.toUpperCase().charCodeAt(1) + offset);
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', BR: 'Brazil', MX: 'Mexico', IN: 'India',
  JP: 'Japan', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', SE: 'Sweden',
  NO: 'Norway', DK: 'Denmark', FI: 'Finland', PL: 'Poland', PH: 'Philippines',
  NG: 'Nigeria', ZA: 'South Africa', NZ: 'New Zealand', SG: 'Singapore',
};

// ── Summary card ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div style={{
      flex: 1, padding: '14px 16px',
      background: 'var(--surface-2, var(--surface))',
      border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent)' : 'var(--text)', lineHeight: 1.2 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{sub}</span>}
    </div>
  );
}

// ── Panel wrapper ───────────────────────────────────────────────────────────
function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '16px 18px', ...style }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 14 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Main dashboard ──────────────────────────────────────────────────────────
export function AnalyticsDashboard({ session, onClose }: { session: Session; onClose: () => void }) {
  const [period, setPeriod] = useState<30 | 7 | 90>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((days: number) => {
    setLoading(true);
    setError(null);
    fetch(`/api/analytics?days=${days}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AnalyticsData>;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e.message)); setLoading(false); });
  }, [session.token]);

  useEffect(() => { load(period); }, [period, load]);

  const formatHour = (h: number) => {
    if (h === 0) return '12:00 AM';
    if (h < 12) return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      overflowY: 'auto',
      padding: '40px 20px 60px',
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 960,
        background: 'var(--bg, #111)',
        border: '1px solid var(--border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '0.04em' }}>
              ANALYTICS
            </span>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent)', background: 'rgba(var(--accent-rgb,255,200,0),0.1)', border: '1px solid var(--accent)', padding: '1px 6px', letterSpacing: '0.08em' }}>
              CREATOR
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {([7, 30, 90] as const).map(d => (
              <button
                key={d}
                onClick={() => setPeriod(d)}
                style={{
                  height: 24, padding: '0 10px',
                  background: period === d ? 'var(--accent)' : 'transparent',
                  border: '1px solid', borderColor: period === d ? 'var(--accent)' : 'var(--border)',
                  color: period === d ? '#111' : 'var(--text-dim)',
                  fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {d}D
              </button>
            ))}
            <button
              onClick={onClose}
              style={{
                marginLeft: 8, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
                color: 'var(--text-dim)', transition: 'color 0.12s, border-color 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--text)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-dim)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '80px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              Loading analytics...
            </div>
          )}

          {error && (
            <div style={{ textAlign: 'center', padding: '80px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: '#f87171' }}>
              {error}
            </div>
          )}

          {data && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Summary cards */}
              <div style={{ display: 'flex', gap: 10 }}>
                <StatCard label="Unique Users" value={data.summary.uniqueUsers} sub={`Last ${period} days`} accent />
                <StatCard label="App Opens" value={data.summary.appOpenCount} sub="Session verifications" />
                <StatCard label="Logins" value={data.summary.loginCount} sub="OAuth completions" />
                <StatCard label="Peak Hour" value={formatHour(data.summary.peakHour)} sub="UTC time" />
              </div>

              {/* Subscription row */}
              <div style={{ display: 'flex', gap: 10 }}>
                <StatCard label="Active Subs" value={data.subscriptions.active} accent />
                <StatCard label="Trials" value={data.subscriptions.trial} />
                <StatCard label="Paused" value={data.subscriptions.paused} />
                <StatCard label="Cancelled" value={data.subscriptions.cancelled} />
                <StatCard label="Total Subs" value={data.subscriptions.total} />
              </div>

              {/* Trend chart */}
              <Panel title={`Daily Activity — Last ${period} Days`}>
                <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Unique Users</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: '#60a5fa', borderRadius: 1, opacity: 0.6 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>App Opens</span>
                  </div>
                </div>
                <TrendChart data={data.dailyTrend} days={period} />
              </Panel>

              {/* Device + Countries row */}
              <div style={{ display: 'flex', gap: 16 }}>
                <Panel title="Device Breakdown" style={{ flex: '0 0 280px' }}>
                  <DonutChart
                    desktop={data.devices.desktop ?? 0}
                    mobile={data.devices.mobile ?? 0}
                    tablet={data.devices.tablet ?? 0}
                  />
                </Panel>

                <Panel title="Top Countries" style={{ flex: 1 }}>
                  {data.countries.length === 0 ? (
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>No geographic data yet</div>
                  ) : (() => {
                    const max = data.countries[0].count;
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {data.countries.map(({ country, count }) => (
                          <div key={country} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 14, flexShrink: 0, width: 22 }}>{countryFlag(country)}</span>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {COUNTRY_NAMES[country.toUpperCase()] ?? country}
                            </span>
                            <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text)', width: 28, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </Panel>
              </div>

              {/* Subscription trend */}
              <Panel title="Subscription Trend (Daily Snapshots)">
                <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Active</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: '#a78bfa', borderRadius: 1, opacity: 0.7 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Trial</span>
                  </div>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Snapshotted daily at 6:00 AM UTC
                  </span>
                </div>
                <SubTrendChart data={data.subTrend} />
              </Panel>

              {/* Hourly activity */}
              <Panel title="Hourly Activity (UTC)">
                <HourlyChart hourly={data.hourly} />
                <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, background: 'var(--accent)', borderRadius: 1 }} />
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>AM</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, background: '#60a5fa', borderRadius: 1 }} />
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>PM</span>
                  </div>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    Peak: {formatHour(data.summary.peakHour)} UTC
                  </span>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
