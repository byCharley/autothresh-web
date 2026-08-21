import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { invalidateAppVersion } from '../hooks/useAppVersion';

function useMobile(bp = 640) {
  const [m, setM] = useState(false);
  useLayoutEffect(() => {
    const h = () => setM(window.innerWidth < bp);
    h();
    window.addEventListener('resize', h, { passive: true });
    return () => window.removeEventListener('resize', h);
  }, [bp]);
  return m;
}
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
      flex: '1 1 130px', minWidth: 0, padding: '14px 16px',
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

// ── Chat panel ──────────────────────────────────────────────────────────────

interface SupportTicket {
  id: string;
  subject: string;
  status: 'open' | 'pending' | 'solved';
  user_email: string;
  user_name: string;
  created_at: string;
  last_message_at: string;
  unread_by_creator: number;
  unread_by_user: number;
}

interface SupportMessage {
  id: number;
  created_at: string;
  sender: 'user' | 'creator' | 'system';
  message: string;
  read_at: string | null;
}

const TICKET_STATUS_COLOR = { open: '#4ade80', pending: '#faad14', solved: '#6b7280' } as const;
const TICKET_STATUS_LABEL = { open: 'Open', pending: 'Pending', solved: 'Solved' } as const;

function fmtMsgTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtMsgDate(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ChatPanel({ session }: { session: Session }) {
  const mobile = useMobile(768);
  const [tickets, setTickets]         = useState<SupportTicket[]>([]);
  const [active, setActive]           = useState<SupportTicket | null>(null);
  const [messages, setMessages]       = useState<SupportMessage[]>([]);
  const [reply, setReply]             = useState('');
  const [sendError, setSendError]     = useState('');
  const [sending, setSending]         = useState(false);
  const [loading, setLoading]         = useState(true);
  const [isOnline, setIsOnline]       = useState(false);
  const [toggling, setToggling]       = useState(false);
  const [showAll, setShowAll]         = useState(false);
  const [hoverMsgId, setHoverMsgId]   = useState<number | null>(null);
  const [editingId, setEditingId]     = useState<number | null>(null);
  const [editText, setEditText]       = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!lightboxUrl) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxUrl(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxUrl]);
  const [userTyping, setUserTyping]   = useState(false);
  const bottomRef                     = useRef<HTMLDivElement>(null);
  const lastTypingSentRef             = useRef(0);
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef                   = useRef<HTMLInputElement>(null);

  const H = useCallback(() => ({ Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }), [session.token]);

  const loadPresence = useCallback(() => {
    fetch('/api/chat?resource=status')
      .then(r => r.ok ? r.json() : null)
      .then((d: { is_online?: boolean } | null) => setIsOnline(!!d?.is_online))
      .catch(() => {});
  }, []);

  const loadTickets = useCallback(() => {
    const q = showAll ? '/api/chat?resource=tickets&all=1' : '/api/chat?resource=tickets';
    fetch(q, { headers: H() })
      .then(r => r.ok ? r.json() as Promise<SupportTicket[]> : Promise.resolve([] as SupportTicket[]))
      .then(ts => {
        setTickets(ts);
        setLoading(false);
        // Auto-select: first unread ticket, or first open ticket if none unread
        setActive(prev => {
          if (prev) return prev;
          const firstUnread = ts.find(t => t.unread_by_creator > 0);
          const firstOpen   = ts.find(t => t.status !== 'solved');
          return firstUnread ?? firstOpen ?? null;
        });
      })
      .catch(() => setLoading(false));
  }, [session.token, showAll]);

  const loadMessages = useCallback((ticketId: string) => {
    fetch(`/api/chat?resource=messages&ticket=${ticketId}`, { headers: H() })
      .then(r => r.ok ? r.json() as Promise<SupportMessage[]> : Promise.resolve([] as SupportMessage[]))
      .then(msgs => {
        setMessages(msgs);
        setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, unread_by_creator: 0 } : t));
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      })
      .catch(() => {});
  }, [session.token]);

  const loadTyping = useCallback((ticketId: string) => {
    fetch(`/api/chat?resource=typing&ticket=${ticketId}`, { headers: H() })
      .then(r => r.ok ? r.json() : null)
      .then((d: { userTypingAt?: string | null } | null) => {
        if (!d) return;
        const isTyping = !!d.userTypingAt && (Date.now() - new Date(d.userTypingAt).getTime() < 5000);
        setUserTyping(isTyping);
      })
      .catch(() => {});
  }, [H]);

  const sendTypingSignal = useCallback((ticketId: string) => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    fetch('/api/chat', {
      method: 'PATCH', headers: H(),
      body: JSON.stringify({ resource: 'typing', ticket_id: ticketId }),
    }).catch(() => {});
  }, [H]);

  useEffect(() => { loadPresence(); loadTickets(); }, [loadPresence, loadTickets]);
  useEffect(() => { const id = setInterval(loadTickets, 8_000); return () => clearInterval(id); }, [loadTickets]);
  useEffect(() => {
    if (!active) return;
    loadMessages(active.id);
    const id = setInterval(() => loadMessages(active.id), 5_000);
    return () => clearInterval(id);
  }, [active?.id, loadMessages]);
  useEffect(() => {
    if (!active || active.status === 'solved') { setUserTyping(false); return; }
    loadTyping(active.id);
    const id = setInterval(() => loadTyping(active.id), 2500);
    return () => clearInterval(id);
  }, [active?.id, active?.status, loadTyping]);

  async function toggleOnline() {
    setToggling(true);
    const next = !isOnline;
    setIsOnline(next);
    await fetch('/api/chat', { method: 'PATCH', headers: H(), body: JSON.stringify({ resource: 'presence', is_online: next }) });
    setToggling(false);
  }

  async function sendReply() {
    if (!reply.trim() || !active || sending) return;
    const text = reply.trim();
    setSending(true); setSendError(''); setReply('');
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: H(), body: JSON.stringify({ resource: 'message', ticket_id: active.id, message: text }) });
      if (!r.ok) {
        setReply(text);
        setSendError('Failed to send — please try again.');
      } else {
        loadMessages(active.id);
      }
    } catch {
      setReply(text);
      setSendError('Failed to send — check your connection.');
    }
    setSending(false);
  }

  async function setStatus(id: string, status: 'open' | 'pending' | 'solved') {
    await fetch('/api/chat', { method: 'PATCH', headers: H(), body: JSON.stringify({ resource: 'ticket', id, status }) });
    setTickets(prev => prev.map(t => t.id === id ? { ...t, status } : t));
    if (active?.id === id) setActive(prev => prev ? { ...prev, status } : prev);
  }

  async function editMessage(id: number, newText: string) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, message: newText.trim() } : m));
    setEditingId(null);
    await fetch('/api/chat', { method: 'PATCH', headers: H(), body: JSON.stringify({ resource: 'message', id, message: newText.trim() }) });
  }

  async function deleteMessage(id: number) {
    setMessages(prev => prev.filter(m => m.id !== id));
    await fetch(`/api/chat?resource=message&id=${id}`, { method: 'DELETE', headers: H() });
  }

  async function uploadImage(file: File) {
    if (!active) return;
    setImageUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/chat-upload', {
        method: 'POST',
        headers: H(),
        body: JSON.stringify({ imageData: base64, mimeType: file.type, ticketId: active.id }),
      });
      const data = await r.json() as { url?: string; error?: string };
      if (data.url) {
        await fetch('/api/chat', {
          method: 'POST',
          headers: H(),
          body: JSON.stringify({ resource: 'message', ticket_id: active.id, message: `[img]:${data.url}` }),
        });
        loadMessages(active.id);
      }
    } catch {}
    setImageUploading(false);
  }

  const totalUnread = tickets.reduce((s, t) => s + (t.unread_by_creator || 0), 0);

  return (
    <div style={{ display: 'flex', gap: 0, height: mobile ? 'min(70dvh, 560px)' : 560, minHeight: mobile ? 360 : 560, border: '1px solid var(--border)', overflow: 'hidden' }}>

      {/* Lightbox overlay */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          onKeyDown={e => { if (e.key === 'Escape') setLightboxUrl(null); }}
          tabIndex={-1}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img src={lightboxUrl} alt="full size" style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 4, boxShadow: '0 8px 40px rgba(0,0,0,0.6)' }} />
        </div>
      )}

      {/* Ticket list — hidden on mobile when a ticket is active */}
      <div style={{ width: mobile ? '100%' : 240, flexShrink: 0, borderRight: mobile ? 'none' : '1px solid var(--border)', display: mobile && active ? 'none' : 'flex', flexDirection: 'column' }}>
        {/* List header */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tickets</span>
            {totalUnread > 0 && <span style={{ minWidth: 16, height: 16, padding: '0 4px', background: '#f87171', color: '#000', fontSize: 9, fontWeight: 800, fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{totalUnread}</span>}
          </div>
          <button onClick={() => setShowAll(v => !v)} style={{ fontSize: 8, fontFamily: 'var(--font-mono)', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', textDecoration: 'underline' }}>
            {showAll ? 'Active only' : 'Show all'}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '20px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Loading…</div>}
          {!loading && tickets.length === 0 && <div style={{ padding: '20px 12px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>No tickets</div>}
          {tickets.map(t => (
            <button
              key={t.id}
              onClick={() => { setActive(t); setMessages([]); }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 12px',
                background: active?.id === t.id ? 'var(--surface)' : 'transparent',
                borderLeft: active?.id === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                borderRight: 'none', borderTop: 'none', borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: t.unread_by_creator > 0 ? 'var(--text)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{t.subject}</span>
                {t.unread_by_creator > 0 && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f87171', flexShrink: 0 }} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{t.user_name || t.user_email}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: TICKET_STATUS_COLOR[t.status] }} />
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{TICKET_STATUS_LABEL[t.status]}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Online toggle */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: isOnline ? '#4ade80' : '#6b7280' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <button
            onClick={toggleOnline}
            disabled={toggling}
            style={{
              height: 20, padding: '0 8px', fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.05em',
              background: isOnline ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.15)',
              border: `1px solid ${isOnline ? 'rgba(248,113,113,0.3)' : 'rgba(74,222,128,0.3)'}`,
              color: isOnline ? '#f87171' : '#4ade80', cursor: 'pointer',
            }}
          >
            {isOnline ? 'Go Offline' : 'Go Online'}
          </button>
        </div>
      </div>

      {/* Conversation */}
      {active ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Convo header */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {mobile && (
                <button onClick={() => setActive(null)} style={{ height: 26, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
                  ← Back
                </button>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.subject}</div>
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 2 }}>
                  {active.user_name ? `${active.user_name} · ` : ''}{active.user_email}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {active.status !== 'solved' && (
                <button onClick={() => setStatus(active.id, 'solved')} style={{ height: 26, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: '#4ade8022', border: '1px solid #4ade8044', color: '#4ade80', cursor: 'pointer' }}>
                  ✓ Solve
                </button>
              )}
              {active.status === 'solved' && (
                <button onClick={() => setStatus(active.id, 'open')} style={{ height: 26, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>
                  Reopen
                </button>
              )}
              {active.status === 'open' && (
                <button onClick={() => setStatus(active.id, 'pending')} style={{ height: 26, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer' }}>
                  Pending
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((msg, idx) => {
              if (msg.sender === 'system') {
                return (
                  <div key={msg.id} style={{ textAlign: 'center', padding: '6px 0', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                    {msg.message}
                  </div>
                );
              }
              const isCreator = msg.sender === 'creator';
              const showDate = idx === 0 || fmtMsgDate(messages[idx - 1].created_at) !== fmtMsgDate(msg.created_at);
              const isLast = idx === messages.length - 1;
              const isRead = isCreator && isLast && active.unread_by_user === 0;
              const isHovered = hoverMsgId === msg.id;
              const isEditing = editingId === msg.id;
              return (
                <div key={msg.id}>
                  {showDate && <div style={{ textAlign: 'center', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', margin: '4px 0 8px' }}>{fmtMsgDate(msg.created_at)}</div>}
                  <div
                    style={{ display: 'flex', justifyContent: isCreator ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 4 }}
                    onMouseEnter={() => setHoverMsgId(msg.id)}
                    onMouseLeave={() => setHoverMsgId(null)}
                  >
                    {/* Action buttons for creator messages */}
                    {isCreator && isHovered && !isEditing && (
                      <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
                        <button
                          onClick={() => { setEditingId(msg.id); setEditText(msg.message); }}
                          title="Edit"
                          style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-dim)' }}
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          title="Delete"
                          style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer', color: '#f87171' }}
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                    <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: 2, alignItems: isCreator ? 'flex-end' : 'flex-start' }}>
                      {!isCreator && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginLeft: 2 }}>{active.user_name || active.user_email}</span>}
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 260 }}>
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); editMessage(msg.id, editText); }
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            rows={3}
                            style={{ width: '100%', padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', border: '1px solid var(--accent)', color: 'var(--text)', resize: 'none', lineHeight: 1.5, boxSizing: 'border-box' }}
                          />
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button onClick={() => setEditingId(null)} style={{ height: 22, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={() => editMessage(msg.id, editText)} disabled={!editText.trim()} style={{ height: 22, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'var(--accent)', border: 'none', color: '#111', cursor: 'pointer' }}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{
                          padding: (() => { const m = msg.message; if (m.startsWith('[img]:')) return '4px'; const u = m.match(/(https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp)(?:\?\S*)?)/i); return (u && m.replace(u[0],'').trim() === '') ? '4px' : '8px 11px'; })(),
                          fontSize: 12, lineHeight: 1.55, fontFamily: 'var(--font-sans)',
                          background: isCreator ? 'var(--accent)' : 'var(--surface)',
                          color: isCreator ? '#111' : 'var(--text)',
                          border: isCreator ? 'none' : '1px solid var(--border)',
                          wordBreak: 'break-word',
                        }}>
                          {(() => {
                            const m = msg.message;
                            if (m.startsWith('[img]:')) return <img src={m.slice(6)} alt="attachment" onClick={() => setLightboxUrl(m.slice(6))} style={{ maxWidth: '100%', maxHeight: 200, display: 'block', objectFit: 'contain', cursor: 'zoom-in' }} />;
                            const urlMatch = m.match(/(https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp)(?:\?\S*)?)/i);
                            if (urlMatch) {
                              const text = m.replace(urlMatch[0], '').trim();
                              return <>{text && <div style={{ marginBottom: 4 }}>{text}</div>}<img src={urlMatch[0]} alt="attachment" onClick={() => setLightboxUrl(urlMatch[0])} style={{ maxWidth: '100%', maxHeight: 200, display: 'block', objectFit: 'contain', cursor: 'zoom-in' }} /></>;
                            }
                            return m;
                          })()}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{fmtMsgTime(msg.created_at)}</span>
                        {isCreator && isLast && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: isRead ? 'var(--accent)' : 'var(--text-dim)' }}>
                            {isRead ? '✓✓ Read' : '✓ Sent'}
                          </span>
                        )}
                        {!isCreator && msg.read_at && isLast && (
                          <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>✓✓ Read</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* User typing indicator */}
            {userTyping && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', gap: 4, marginTop: 4 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginLeft: 2 }}>Customer</span>
                  <div style={{ padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)', display: 'inline-block', animation: 'chat-typing 1.2s ease-in-out infinite' }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)', display: 'inline-block', animation: 'chat-typing 1.2s ease-in-out 0.4s infinite' }} />
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-dim)', display: 'inline-block', animation: 'chat-typing 1.2s ease-in-out 0.8s infinite' }} />
                  </div>
                </div>
              </div>
            )}
            <style>{`@keyframes chat-typing { 0%,60%,100%{opacity:.25;transform:translateY(0)} 30%{opacity:1;transform:translateY(-3px)} }`}</style>
            <div ref={bottomRef} />
          </div>

          {/* Reply box */}
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            {active.status === 'solved' ? (
              <div style={{ textAlign: 'center', fontSize: 10, fontFamily: 'var(--font-mono)', color: '#4ade80', padding: '4px 0' }}>✓ Ticket resolved — click Reopen to continue</div>
            ) : (
              <>
                {sendError && (
                  <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#f87171', marginBottom: 6 }}>⚠ {sendError}</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <textarea
                    placeholder="Reply to customer…"
                    value={reply}
                    onChange={e => { setReply(e.target.value); if (sendError) setSendError(''); if (active && e.target.value) sendTypingSignal(active.id); }}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
                    rows={2}
                    style={{ flex: 1, padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', border: `1px solid ${sendError ? '#f87171' : 'var(--border)'}`, color: 'var(--text)', resize: 'none', lineHeight: 1.5 }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={imageUploading}
                    title="Attach image"
                    style={{ width: 36, background: 'var(--surface-2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: imageUploading ? 0.4 : 0.7 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                  </button>
                  <button
                    onClick={sendReply}
                    disabled={sending || !reply.trim()}
                    style={{ width: 40, background: 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (!reply.trim() || sending) ? 0.4 : 1 }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ''; }} />
              </>
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5" opacity="0.4"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Select a ticket</span>
        </div>
      )}
    </div>
  );
}

// ── Videos panel ────────────────────────────────────────────────────────────

interface TutorialRow {
  id: number;
  title: string;
  description: string;
  duration: string;
  youtube_id: string;
  coming_soon: boolean;
  sort_order: number;
}

const EMPTY_FORM = { title: '', description: '', duration: '', youtube_id: '', coming_soon: false };

function youtubeThumb(id: string) {
  return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
}

function extractYoutubeId(input: string): string {
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return input.trim();
}

function VideosPanel({ session }: { session: Session }) {
  const [rows, setRows]         = useState<TutorialRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [acting, setActing]     = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Omit<TutorialRow, 'id' | 'sort_order'>>(EMPTY_FORM);
  const [addForm, setAddForm]   = useState(EMPTY_FORM);
  const [addError, setAddError] = useState<string | null>(null);
  const [showAdd, setShowAdd]   = useState(false);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/tutorials')
      .then(r => r.ok ? r.json() as Promise<TutorialRow[]> : Promise.reject(`HTTP ${r.status}`))
      .then(d => { setRows(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(id: number) {
    setActing(`save-${id}`);
    await fetch('/api/tutorials', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ id, ...editForm, youtube_id: extractYoutubeId(editForm.youtube_id) }),
    });
    setEditingId(null);
    load();
    setActing(null);
  }

  async function remove(id: number) {
    setActing(`del-${id}`);
    await fetch(`/api/tutorials?id=${id}`, { method: 'DELETE', headers });
    load();
    setActing(null);
  }

  async function move(id: number, dir: -1 | 1) {
    const idx = rows.findIndex(r => r.id === id);
    const swap = rows[idx + dir];
    if (!swap) return;
    setActing(`move-${id}`);
    await Promise.all([
      fetch('/api/tutorials', { method: 'PATCH', headers, body: JSON.stringify({ id, sort_order: swap.sort_order }) }),
      fetch('/api/tutorials', { method: 'PATCH', headers, body: JSON.stringify({ id: swap.id, sort_order: rows[idx].sort_order }) }),
    ]);
    load();
    setActing(null);
  }

  async function add() {
    setAddError(null);
    if (!addForm.title.trim()) { setAddError('Title is required'); return; }
    if (!addForm.youtube_id.trim() && !addForm.coming_soon) { setAddError('YouTube URL or ID is required (or mark as Coming Soon)'); return; }
    setActing('add');
    const r = await fetch('/api/tutorials', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...addForm,
        youtube_id: extractYoutubeId(addForm.youtube_id),
        sort_order: rows.length * 10,
      }),
    });
    if (r.ok) {
      setAddForm(EMPTY_FORM);
      setShowAdd(false);
      load();
    } else {
      setAddError('Failed to add video');
    }
    setActing(null);
  }

  const inputStyle: React.CSSProperties = {
    height: 28, padding: '0 8px', fontSize: 11,
    fontFamily: 'var(--font-mono)',
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    color: 'var(--text)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {rows.length} video{rows.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => { setShowAdd(v => !v); setAddError(null); }}
          style={{
            height: 28, padding: '0 14px', fontSize: 10,
            fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.04em',
            background: showAdd ? 'var(--surface-2)' : 'var(--accent)',
            border: showAdd ? '1px solid var(--border)' : 'none',
            color: showAdd ? 'var(--text-muted)' : '#000', cursor: 'pointer',
          }}
        >
          {showAdd ? 'Cancel' : '+ Add Video'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ padding: '14px 16px', border: '1px solid var(--accent)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>New Video</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input style={{ ...inputStyle, flex: '1 1 180px' }} placeholder="Title *" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))} />
            <input style={{ ...inputStyle, flex: '2 1 220px' }} placeholder="YouTube URL or video ID" value={addForm.youtube_id} onChange={e => setAddForm(f => ({ ...f, youtube_id: e.target.value }))} />
            <input style={{ ...inputStyle, width: 70 }} placeholder="Duration" value={addForm.duration} onChange={e => setAddForm(f => ({ ...f, duration: e.target.value }))} />
          </div>
          <input style={{ ...inputStyle, width: '100%' }} placeholder="Description (optional)" value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={addForm.coming_soon} onChange={e => setAddForm(f => ({ ...f, coming_soon: e.target.checked }))} />
              Mark as Coming Soon
            </label>
            <button
              onClick={add}
              disabled={acting === 'add'}
              style={{
                height: 28, padding: '0 20px', fontSize: 10,
                fontFamily: 'var(--font-mono)', fontWeight: 700,
                background: 'var(--accent)', border: 'none', color: '#000',
                cursor: 'pointer', opacity: acting === 'add' ? 0.5 : 1,
              }}
            >
              {acting === 'add' ? 'Adding…' : 'Add'}
            </button>
          </div>
          {addError && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#f87171' }}>{addError}</span>}
        </div>
      )}

      {loading && <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Loading…</div>}
      {error   && <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f87171' }}>{error}</div>}

      {!loading && rows.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
          No videos yet — add your first one above.
        </div>
      )}

      {/* Video rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map((row, idx) => {
          const isEditing = editingId === row.id;
          return (
            <div key={row.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              padding: '12px 14px',
            }}>
              {isEditing ? (
                /* Edit mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <input style={{ ...inputStyle, flex: '1 1 160px' }} placeholder="Title" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                    <input style={{ ...inputStyle, flex: '2 1 200px' }} placeholder="YouTube URL or video ID" value={editForm.youtube_id} onChange={e => setEditForm(f => ({ ...f, youtube_id: e.target.value }))} />
                    <input style={{ ...inputStyle, width: 70 }} placeholder="Duration" value={editForm.duration} onChange={e => setEditForm(f => ({ ...f, duration: e.target.value }))} />
                  </div>
                  <input style={{ ...inputStyle, width: '100%' }} placeholder="Description" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      <input type="checkbox" checked={editForm.coming_soon} onChange={e => setEditForm(f => ({ ...f, coming_soon: e.target.checked }))} />
                      Coming Soon
                    </label>
                    <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                      <button onClick={() => setEditingId(null)} style={{ height: 26, padding: '0 12px', fontSize: 10, fontFamily: 'var(--font-mono)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                      <button onClick={() => save(row.id)} disabled={acting === `save-${row.id}`} style={{ height: 26, padding: '0 14px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'var(--accent)', border: 'none', color: '#000', cursor: 'pointer', opacity: acting === `save-${row.id}` ? 0.5 : 1 }}>Save</button>
                    </div>
                  </div>
                </div>
              ) : (
                /* View mode */
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Thumbnail */}
                  {!row.coming_soon && row.youtube_id && (
                    <img
                      src={youtubeThumb(row.youtube_id)}
                      alt=""
                      style={{ width: 72, height: 40, objectFit: 'cover', flexShrink: 0, background: '#000' }}
                    />
                  )}
                  {row.coming_soon && (
                    <div style={{ width: 72, height: 40, flexShrink: 0, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', textAlign: 'center', lineHeight: 1.3 }}>COMING<br/>SOON</span>
                    </div>
                  )}

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.title}</span>
                      {row.coming_soon && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', padding: '1px 5px', background: 'rgba(250,173,20,0.12)', color: '#faad14', border: '1px solid rgba(250,173,20,0.3)', flexShrink: 0 }}>COMING SOON</span>}
                    </div>
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                      {row.youtube_id || '—'}{row.duration ? ` · ${row.duration}` : ''}
                    </span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                    {/* Up/Down */}
                    <button onClick={() => move(row.id, -1)} disabled={idx === 0 || !!acting} title="Move up" style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                    </button>
                    <button onClick={() => move(row.id, 1)} disabled={idx === rows.length - 1 || !!acting} title="Move down" style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: idx === rows.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === rows.length - 1 ? 0.3 : 1 }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <button
                      onClick={() => { setEditingId(row.id); setEditForm({ title: row.title, description: row.description, duration: row.duration, youtube_id: row.youtube_id, coming_soon: row.coming_soon }); }}
                      style={{ height: 24, padding: '0 10px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(row.id)}
                      disabled={acting === `del-${row.id}`}
                      title="Delete"
                      style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', color: '#f87171', cursor: 'pointer', opacity: acting === `del-${row.id}` ? 0.5 : 1 }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Version / Settings panel ────────────────────────────────────────────────

function VersionPanel({ session }: { session: Session }) {
  const [version, setVersion]   = useState('');
  const [saved,   setSaved]     = useState('');
  const [saving,  setSaving]    = useState(false);
  const [status,  setStatus]    = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/app-settings', { headers: { Authorization: `Bearer ${session.token}` } })
      .then(r => r.ok ? r.json() : {})
      .then((d: Record<string, string>) => {
        const v = d.app_version ?? '';
        setVersion(v);
        setSaved(v);
      })
      .catch(() => {});
  }, [session.token]);

  async function save() {
    if (!version.trim() || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await fetch('/api/app-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ key: 'app_version', value: version.trim() }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) { setSaved(version.trim()); setStatus('Saved'); invalidateAppVersion(); }
      else setStatus(d.error ?? 'Failed');
    } catch {
      setStatus('Request failed');
    } finally {
      setSaving(false);
    }
  }

  const dirty = version.trim() !== saved;

  return (
    <div style={{ maxWidth: 420 }}>
      <Panel title="App Version">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Set the current app version string shown to users (e.g. <span style={{ color: 'var(--accent)' }}>1.3.0</span>).
            Requires an <code style={{ fontSize: 10 }}>app_settings</code> table in Supabase:
          </p>
          <pre style={{ margin: 0, fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', background: 'var(--surface-2)', padding: '8px 10px', overflowX: 'auto', lineHeight: 1.6 }}>{`CREATE TABLE IF NOT EXISTS app_settings (
  key  text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
INSERT INTO app_settings (key, value)
  VALUES ('app_version', '1.0.0')
  ON CONFLICT (key) DO NOTHING;`}</pre>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={version}
              onChange={e => { setVersion(e.target.value); setStatus(null); }}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              placeholder="e.g. 1.3.0"
              style={{
                flex: 1, height: 32, padding: '0 10px',
                fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
                background: 'var(--surface-2)', border: `1px solid ${dirty ? 'var(--accent)' : 'var(--border)'}`,
                color: 'var(--text)',
              }}
            />
            <button
              onClick={save}
              disabled={!dirty || saving}
              style={{
                height: 32, padding: '0 16px',
                background: dirty ? 'var(--accent)' : 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: dirty ? '#000' : 'var(--text-dim)',
                fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                cursor: dirty ? 'pointer' : 'default',
                opacity: saving ? 0.6 : 1,
              }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
          {status && (
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: status === 'Saved' ? '#4ade80' : '#f87171' }}>
              {status === 'Saved' ? '✓ ' : '✗ '}{status}
            </span>
          )}
          {saved && (
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              Current: <span style={{ color: 'var(--accent)', fontWeight: 700 }}>v{saved}</span>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

// ── Security panel ──────────────────────────────────────────────────────────

interface SecurityFlag {
  id: number;
  created_at: string;
  email: string;
  ip: string | null;
  first_name: string | null;
  related_emails: string[];
  reason: string | null;
  confidence: 'low' | 'medium' | 'high';
  reviewed: boolean;
  expired: boolean;
  auto_flagged: boolean;
  notes: string | null;
}

interface SharedIpEntry {
  ip: string;
  emails: Array<{ email: string; firstSeen: string }>;
}

interface SecurityData {
  flags: SecurityFlag[];
  sharedIps: SharedIpEntry[];
  summary: {
    total: number;
    unreviewed: number;
    expired: number;
    highConfidence: number;
    sharedIpsLast7d: number;
  };
}

function ConfidenceBadge({ level }: { level: string }) {
  const color = level === 'high' ? '#f87171' : level === 'medium' ? '#faad14' : '#6b7280';
  return (
    <span style={{
      fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', padding: '2px 6px',
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>
      {level}
    </span>
  );
}

// ── Users Panel (all accounts + suspend) ──────────────────────────────────────

interface AppUser {
  email: string;
  firstSeen: string;
  lastSeen: string;
  opens: number;
  logins: number;
  device: string;
  country: string;
  blocked: boolean;
  blockReason: string;
  accessRole: string | null;
  accessStatus: string | null;
}

function UsersPanel({ session }: { session: Session }) {
  const mobile = useMobile(640);
  const [users, setUsers]     = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [query, setQuery]     = useState('');
  const [filter, setFilter]   = useState<'all' | 'active' | 'suspended'>('all');
  const [busy, setBusy]       = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch('/api/security?resource=users', { headers: { Authorization: `Bearer ${session.token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ users?: AppUser[]; error?: string }>; })
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setUsers(d.users ?? []);
      })
      .catch(e => setError(String(e.message)))
      .finally(() => setLoading(false));
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  async function setSuspended(email: string, suspend: boolean) {
    setBusy(email);
    try {
      const r = await fetch('/api/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          action: suspend ? 'expire' : 'unblock',
          email,
          notes: suspend ? 'Suspended from Users tab' : 'Restored from Users tab',
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = users.filter(u => {
    if (filter === 'suspended' && !u.blocked) return false;
    if (filter === 'active' && u.blocked) return false;
    if (q && !u.email.includes(q) && !u.country.toLowerCase().includes(q)) return false;
    return true;
  });
  const blockedCount = users.filter(u => u.blocked).length;

  function fmtDate(iso: string) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 10px' }}>
            {users.length} users
          </span>
          {blockedCount > 0 && (
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', padding: '3px 10px' }}>
              {blockedCount} suspended
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'active', 'suspended'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                height: 26, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
                background: filter === f ? 'var(--accent)' : 'transparent',
                border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border)'}`,
                color: filter === f ? '#111' : 'var(--text-dim)',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <input
        type="search"
        placeholder="Search email or country…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{
          height: 36, padding: '0 12px', fontSize: 12, fontFamily: 'var(--font-mono)',
          background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)',
          width: '100%', boxSizing: 'border-box',
        }}
      />

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Loading users…</div>
      )}
      {error && (
        <div style={{ padding: 16, fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          No users match.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)', border: '1px solid var(--border)' }}>
          {filtered.map(u => (
            <div
              key={u.email}
              style={{
                background: u.blocked ? 'rgba(248,113,113,0.04)' : 'var(--surface)',
                padding: mobile ? '12px' : '12px 14px',
                display: 'flex',
                flexDirection: mobile ? 'column' : 'row',
                alignItems: mobile ? 'stretch' : 'center',
                gap: mobile ? 10 : 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
                  color: u.blocked ? '#f87171' : 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {u.email}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.6 }}>
                  Last seen {fmtDate(u.lastSeen)}
                  {u.device ? ` · ${u.device}` : ''}
                  {u.country && u.country !== 'Unknown' ? ` · ${u.country}` : ''}
                  {` · ${u.opens + u.logins} visits`}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {u.blocked && (
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)' }}>Suspended</span>
                  )}
                  {u.accessRole && (
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', background: 'var(--surface-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      {u.accessRole}{u.accessStatus === 'paused' ? ' · paused' : ''}
                    </span>
                  )}
                  {u.blockReason && (
                    <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{u.blockReason}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSuspended(u.email, !u.blocked)}
                disabled={busy === u.email}
                style={{
                  height: 32, padding: '0 12px', flexShrink: 0,
                  fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.05em',
                  cursor: busy === u.email ? 'default' : 'pointer', opacity: busy === u.email ? 0.5 : 1,
                  background: u.blocked ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                  border: `1px solid ${u.blocked ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)'}`,
                  color: u.blocked ? '#4ade80' : '#f87171',
                  width: mobile ? '100%' : 'auto',
                }}
              >
                {busy === u.email ? '…' : u.blocked ? 'Restore access' : 'Suspend'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Access Panel ──────────────────────────────────────────────────────────────

interface AccessEntry {
  email: string;
  status: 'active' | 'paused';
  role: 'tester' | 'lifetime';
  notes: string | null;
  created_at: string;
}

function AccessPanel({ session }: { session: Session }) {
  const mobile = useMobile(640);
  const [testers, setTesters]   = useState<AccessEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addRole, setAddRole]   = useState<'tester' | 'lifetime'>('tester');
  const [adding, setAdding]     = useState(false);
  const [addErr, setAddErr]     = useState<string | null>(null);
  const [showAdd, setShowAdd]   = useState(false);
  const [busy, setBusy]         = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch('/api/security?resource=testers', { headers: { Authorization: `Bearer ${session.token}` } })
      .then(r => r.json() as Promise<{ testers?: AccessEntry[]; error?: string; setupRequired?: boolean }>)
      .then(d => {
        if (d.error) { setError(d.error); return; }
        if (d.setupRequired) { setError('⚠ Supabase testers table not found. Run this SQL in your Supabase SQL editor:\n\nCREATE TABLE testers (\n  email text PRIMARY KEY,\n  status text NOT NULL DEFAULT \'active\',\n  role text NOT NULL DEFAULT \'tester\',\n  notes text,\n  created_at timestamptz NOT NULL DEFAULT now()\n);\n\nIf the table exists but is missing the role column, run:\nALTER TABLE testers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT \'tester\';'); return; }
        setTesters(d.testers ?? []);
      })
      .catch(() => setError('Failed to load access list'))
      .finally(() => setLoading(false));
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  async function act(action: string, email: string) {
    setBusy(email + action);
    try {
      const r = await fetch('/api/security?resource=testers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action, email }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? 'Failed');
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd() {
    const email = addEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) { setAddErr('Enter a valid email'); return; }
    setAdding(true); setAddErr(null);
    try {
      const r = await fetch('/api/security?resource=testers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action: 'add', email, role: addRole, notes: addNotes.trim() || null }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!d.ok) throw new Error(d.error ?? 'Failed to add user');
      setAddEmail(''); setAddNotes(''); setAddRole('tester'); setShowAdd(false);
      load();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'Failed to add user');
    } finally {
      setAdding(false);
    }
  }

  const activeCount = testers.filter(t => t.status === 'active').length;
  const pausedCount = testers.filter(t => t.status === 'paused').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'rgba(82,196,26,0.12)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.3)', padding: '3px 10px' }}>
            {activeCount} active
          </span>
          {pausedCount > 0 && (
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', background: 'rgba(250,173,20,0.12)', color: '#faad14', border: '1px solid rgba(250,173,20,0.3)', padding: '3px 10px' }}>
              {pausedCount} paused
            </span>
          )}
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setAddErr(null); }}
          style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em', padding: '6px 14px', background: showAdd ? 'var(--surface-2)' : 'var(--accent)', color: showAdd ? 'var(--text-dim)' : '#000', border: '1px solid var(--accent)', cursor: 'pointer' }}
        >
          {showAdd ? 'Cancel' : '+ Add User'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 2 }}>Grant Access</div>
          <input
            type="email"
            placeholder="user@email.com"
            value={addEmail}
            onChange={e => { setAddEmail(e.target.value); setAddErr(null); }}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', background: 'var(--bg)', border: `1px solid ${addErr ? '#f87171' : 'var(--border)'}`, color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
          {/* Role selector */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['tester', 'lifetime'] as const).map(r => (
              <button key={r} onClick={() => setAddRole(r)}
                style={{ flex: 1, padding: '6px 0', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', cursor: 'pointer',
                  background: addRole === r ? (r === 'lifetime' ? 'rgba(251,191,36,0.15)' : 'rgba(var(--accent-rgb),0.15)') : 'var(--bg)',
                  border: `1px solid ${addRole === r ? (r === 'lifetime' ? '#fbbf24' : 'var(--accent)') : 'var(--border)'}`,
                  color: addRole === r ? (r === 'lifetime' ? '#fbbf24' : 'var(--accent)') : 'var(--text-dim)',
                }}>
                {r === 'tester' ? 'Tester' : 'Lifetime Member'}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Notes (optional)"
            value={addNotes}
            onChange={e => setAddNotes(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
          {addErr && <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#f87171' }}>{addErr}</div>}
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{ alignSelf: 'flex-end', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em', padding: '7px 18px', background: adding ? 'var(--surface-3)' : 'var(--accent)', color: '#000', border: 'none', cursor: adding ? 'default' : 'pointer' }}
          >
            {adding ? 'Adding...' : 'Grant Access →'}
          </button>
        </div>
      )}

      {/* States */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          Loading...
        </div>
      )}
      {error && (
        <div style={{ padding: '20px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f87171', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
          {error}
        </div>
      )}

      {/* Tester list */}
      {!loading && !error && testers.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          No users yet — grant access above.
        </div>
      )}

      {!loading && testers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--border)' }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr auto auto auto', gap: mobile ? 8 : 12, background: 'var(--surface-2)', padding: '8px 14px', alignItems: 'center' }}>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Email</span>
            {!mobile && (
              <>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Role</span>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Status</span>
                <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>Actions</span>
              </>
            )}
          </div>

          {testers.map(t => (
            <div
              key={t.email}
              style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr auto auto auto', gap: mobile ? 8 : 12, background: 'var(--surface)', padding: '12px 14px', alignItems: 'center' }}
            >
              {/* Email + notes + date */}
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', letterSpacing: '0.01em' }}>{t.email}</div>
                {t.notes && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{t.notes}</div>
                )}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>
                  Added {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>

              {/* Role badge */}
              <div>
                {t.role === 'lifetime' ? (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)', whiteSpace: 'nowrap' }}>Lifetime</span>
                ) : (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', background: 'rgba(139,92,246,0.12)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}>Tester</span>
                )}
              </div>

              {/* Status badge */}
              <div>
                {t.status === 'active' ? (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', background: 'rgba(82,196,26,0.12)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.3)' }}>Active</span>
                ) : (
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', background: 'rgba(250,173,20,0.12)', color: '#faad14', border: '1px solid rgba(250,173,20,0.3)' }}>Paused</span>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {t.status === 'active' ? (
                  <button
                    onClick={() => act('pause', t.email)}
                    disabled={busy === t.email + 'pause'}
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '4px 10px', background: 'none', border: '1px solid #faad14', color: '#faad14', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={() => act('resume', t.email)}
                    disabled={busy === t.email + 'resume'}
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '4px 10px', background: 'none', border: '1px solid #52c41a', color: '#52c41a', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
                  >
                    Resume
                  </button>
                )}
                <button
                  onClick={() => { if (confirm(`Remove ${t.email} from access list?`)) act('remove', t.email); }}
                  disabled={!!busy}
                  style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '4px 10px', background: 'none', border: '1px solid #f87171', color: '#f87171', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 4 }}>
        <b style={{ color: 'var(--text-dim)' }}>Tester</b> — full app access without a subscription. <b style={{ color: 'var(--text-dim)' }}>Lifetime Member</b> — grants lifetime access manually (use for LTD customers who can't authenticate through the store). Pausing revokes access immediately.
      </div>
    </div>
  );
}

function SecurityPanel({ session, onDataLoad }: { session: Session; onDataLoad?: (unreviewed: number) => void }) {
  const [data, setData]         = useState<SecurityData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [acting, setActing]     = useState<string | null>(null);
  const [notes, setNotes]       = useState<Record<string, string>>({});
  const [filter, setFilter]     = useState<'all' | 'unreviewed' | 'expired'>('all');
  const [manualEmail, setManualEmail] = useState('');
  const [manualNote, setManualNote]   = useState('');
  const [manualActing, setManualActing] = useState(false);
  const [manualError, setManualError]   = useState<string | null>(null);
  const [manualBlocked, setManualBlocked] = useState(false);

  const load = useCallback((isFirst = false) => {
    setLoading(true);
    fetch('/api/security', { headers: { Authorization: `Bearer ${session.token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<SecurityData>; })
      .then(d => {
        setData(d);
        setLoading(false);
        if (isFirst) onDataLoad?.(d.summary?.unreviewed ?? 0);
      })
      .catch(e => { setError(String(e.message)); setLoading(false); });
  }, [session.token, onDataLoad]);

  useEffect(() => { load(true); }, [load]);

  async function act(action: string, email: string) {
    setActing(email + action);
    try {
      await fetch('/api/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action, email, notes: notes[email] ?? null }),
      });
      load();
    } catch { /* ignore */ }
    setActing(null);
  }

  async function manualBlock(action: 'flag' | 'expire') {
    const email = manualEmail.trim().toLowerCase();
    if (!email) return;
    setManualActing(true);
    setManualError(null);
    try {
      const r = await fetch('/api/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ action, email, notes: manualNote || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setManualEmail('');
      setManualNote('');
      if (action === 'expire') {
        setManualBlocked(true);
        setTimeout(() => setManualBlocked(false), 3000);
      }
      load();
    } catch (e) {
      setManualError(e instanceof Error ? e.message : 'Failed');
    }
    setManualActing(false);
  }

  const filtered = data?.flags.filter(f => {
    if (filter === 'unreviewed') return !f.reviewed && !f.expired;
    if (filter === 'expired') return f.expired;
    return true;
  }) ?? [];

  const CONF_ORDER = { high: 0, medium: 1, low: 2 };
  // Unreviewed first, then blocked, then reviewed; within each group sort by confidence
  const STATUS_ORDER = (f: SecurityFlag) => f.expired ? 1 : !f.reviewed ? 0 : 2;
  const sorted = [...filtered].sort((a, b) =>
    STATUS_ORDER(a) - STATUS_ORDER(b) ||
    (CONF_ORDER[a.confidence] ?? 3) - (CONF_ORDER[b.confidence] ?? 3)
  );

  const STAT_ITEMS = data ? [
    { label: 'Flagged',       value: data.summary.total,          dot: data.summary.unreviewed > 0 ? '#faad14' : null },
    { label: 'Needs Review',  value: data.summary.unreviewed,     dot: data.summary.unreviewed > 0 ? '#faad14' : null },
    { label: 'High Conf.',    value: data.summary.highConfidence,  dot: data.summary.highConfidence > 0 ? '#f87171' : null },
    { label: 'Blocked',       value: data.summary.expired,         dot: null },
    { label: 'Shared IPs',    value: data.summary.sharedIpsLast7d, dot: data.summary.sharedIpsLast7d > 0 ? '#faad14' : null },
  ] : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', overflow: 'hidden' }}>

      {/* ── Top stat bar ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        {STAT_ITEMS.map(({ label, value, dot }, i) => (
          <div key={label} style={{
            flex: 1, padding: '10px 14px',
            borderRight: i < STAT_ITEMS.length - 1 ? '1px solid var(--border)' : 'none',
            display: 'flex', flexDirection: 'column', gap: 3,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {dot && <div style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
              <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {loading ? '—' : value}
              </span>
            </div>
            <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Manual block bar ────────────────────────────────────────────── */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--surface)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-dim)', flexShrink: 0, marginRight: 2 }}>
          Manual
        </span>
        <input
          type="email"
          placeholder="user@email.com"
          value={manualEmail}
          onChange={e => { setManualEmail(e.target.value); setManualError(null); }}
          style={{
            height: 26, padding: '0 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--text)', flex: '1 1 180px', minWidth: 160,
          }}
        />
        <input
          type="text"
          placeholder="Reason (optional)"
          value={manualNote}
          onChange={e => setManualNote(e.target.value)}
          style={{
            height: 26, padding: '0 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
            background: 'var(--surface-2)', border: '1px solid var(--border)',
            color: 'var(--text)', flex: '2 1 180px', minWidth: 140,
          }}
        />
        <button
          onClick={() => manualBlock('expire')}
          disabled={manualActing || manualBlocked || !manualEmail.trim()}
          style={{
            height: 26, padding: '0 14px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            background: manualBlocked ? '#4ade80' : '#f87171', border: 'none', color: '#000',
            cursor: !manualEmail.trim() || manualActing || manualBlocked ? 'not-allowed' : 'pointer',
            opacity: !manualEmail.trim() || manualActing ? 0.45 : 1, transition: 'background 0.15s', flexShrink: 0,
          }}
        >{manualBlocked ? '✓ Blocked' : manualActing ? '…' : 'Block'}</button>
        <button
          onClick={() => manualBlock('flag')}
          disabled={manualActing || !manualEmail.trim()}
          style={{
            height: 26, padding: '0 12px', fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
            cursor: !manualEmail.trim() || manualActing ? 'not-allowed' : 'pointer',
            opacity: !manualEmail.trim() || manualActing ? 0.45 : 1, flexShrink: 0,
          }}
        >Flag Only</button>
        {manualError && <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#f87171', flex: '1 0 100%' }}>{manualError}</span>}
      </div>

      {loading && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
          Loading…
        </div>
      )}
      {error && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* ── Shared IPs ──────────────────────────────────────────────── */}
          {data.sharedIps.length > 0 && (() => {
            const blockedEmails = new Set(data.flags.filter(f => f.expired).map(f => f.email.toLowerCase()));
            return (
              <div style={{ borderBottom: '1px solid var(--border)' }}>
                {/* Section header */}
                <div style={{
                  padding: '7px 14px', background: 'rgba(250,173,20,0.06)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#faad14', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#faad14' }}>
                    Shared IPs · Last 7 Days
                  </span>
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                    Multiple accounts from same IP
                  </span>
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {data.sharedIps.map(({ ip, emails }) => (
                    <div key={ip} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--text)', background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '1px 7px' }}>{ip}</span>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{emails.length} accounts</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4 }}>
                        {emails.map(({ email, firstSeen }, idx) => {
                          const isBlocked = blockedEmails.has(email.toLowerCase());
                          const signedUpAt = firstSeen
                            ? new Date(firstSeen).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
                            : null;
                          return (
                            <div key={email} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {idx > 0 && !isBlocked && (
                                <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#faad14', background: 'rgba(250,173,20,0.1)', border: '1px solid rgba(250,173,20,0.3)', padding: '1px 4px', flexShrink: 0 }}>#{idx + 1}</span>
                              )}
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: isBlocked ? '#f87171' : 'var(--text-muted)', textDecoration: isBlocked ? 'line-through' : 'none', opacity: isBlocked ? 0.65 : 1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</span>
                              {signedUpAt && <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0 }}>{signedUpAt}</span>}
                              {isBlocked
                                ? <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', color: '#f87171', flexShrink: 0 }}>Blocked</span>
                                : (
                                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                    <button onClick={() => act('flag', email)} disabled={acting === email + 'flag'} style={{ height: 20, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Flag</button>
                                    <button onClick={() => act('expire', email)} disabled={acting === email + 'expire'} style={{ height: 20, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171', cursor: 'pointer' }}>Block</button>
                                  </div>
                                )
                              }
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Filter tabs ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
            {(['unreviewed', 'all', 'expired'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '8px 16px', border: 'none',
                  borderBottom: filter === f ? '2px solid var(--accent)' : '2px solid transparent',
                  background: 'transparent',
                  color: filter === f ? 'var(--accent)' : 'var(--text-dim)',
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
                }}
              >
                {f === 'unreviewed' ? `Review (${data.summary.unreviewed})` : f === 'expired' ? `Blocked (${data.summary.expired})` : `All (${data.summary.total})`}
              </button>
            ))}
          </div>

          {/* ── Flag list ───────────────────────────────────────────────── */}
          {sorted.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              {filter === 'unreviewed' ? 'No accounts need review — all clear.' : 'No flagged accounts.'}
            </div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {sorted.map((flag, i) => (
                <div key={flag.id} style={{
                  padding: '11px 14px',
                  borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                  background: flag.expired
                    ? 'rgba(248,113,113,0.03)'
                    : flag.confidence === 'high' && !flag.reviewed
                      ? 'rgba(248,113,113,0.02)'
                      : 'transparent',
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {/* Row 1: email + badges + date + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Status dot */}
                    <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: flag.expired ? '#f87171' : !flag.reviewed ? '#faad14' : '#4ade80' }} />

                    {/* Email */}
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: flag.expired ? '#f87171' : 'var(--text)', flex: '1 1 200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {flag.email}
                    </span>

                    {/* Confidence + type badges */}
                    <ConfidenceBadge level={flag.confidence} />
                    {!flag.auto_flagged && (
                      <span style={{ fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.07em', padding: '2px 5px', background: 'rgba(168,85,247,0.1)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.2)', flexShrink: 0 }}>MANUAL</span>
                    )}

                    {/* Date */}
                    <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0, marginLeft: 'auto' }}>
                      {new Date(flag.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>

                    {/* Actions */}
                    {flag.expired ? (
                      <button
                        onClick={() => act('unblock', flag.email)}
                        disabled={acting === flag.email + 'unblock'}
                        style={{ height: 22, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', cursor: 'pointer', flexShrink: 0 }}
                      >Unblock</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => act('expire', flag.email)}
                          disabled={acting === flag.email + 'expire'}
                          style={{ height: 22, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.35)', color: '#f87171', cursor: 'pointer' }}
                        >{acting === flag.email + 'expire' ? '…' : 'Block'}</button>
                        <button
                          onClick={() => act('review', flag.email)}
                          disabled={acting === flag.email + 'review'}
                          style={{ height: 22, padding: '0 10px', fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >{acting === flag.email + 'review' ? '…' : 'Dismiss'}</button>
                        <button
                          onClick={() => act('unflag', flag.email)}
                          disabled={acting === flag.email + 'unflag'}
                          title="Remove flag entirely"
                          style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)', cursor: 'pointer' }}
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Row 2: identity + reason */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, paddingLeft: 14 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      {(flag.first_name || flag.ip) && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {[flag.first_name, flag.ip ? `IP ${flag.ip}` : null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                        {flag.reason}
                      </span>
                      {flag.related_emails?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          {flag.related_emails.map(e => (
                            <span key={e} style={{ fontSize: 9, fontFamily: 'var(--font-mono)', padding: '1px 6px', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>{e}</span>
                          ))}
                        </div>
                      )}
                      {flag.notes && (
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', fontStyle: 'italic', marginTop: 1 }}>Note: {flag.notes}</span>
                      )}
                    </div>
                    {/* Inline notes input for unresolved flags */}
                    {!flag.expired && (
                      <input
                        type="text"
                        placeholder="Add note…"
                        value={notes[flag.email] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [flag.email]: e.target.value }))}
                        style={{
                          height: 22, padding: '0 8px', fontSize: 9, fontFamily: 'var(--font-mono)',
                          background: 'var(--surface-2)', border: '1px solid var(--border)',
                          color: 'var(--text)', width: 140, flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main dashboard ──────────────────────────────────────────────────────────
type Preset = 7 | 14 | 30 | 90;
const PRESETS: Preset[] = [7, 14, 30, 90];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AnalyticsDashboard({ session, onClose }: { session: Session; onClose: () => void }) {
  const mobile = useMobile(768);
  const [preset, setPreset]   = useState<Preset | 'custom'>(30);
  const [customFrom, setCustomFrom] = useState(daysAgoStr(30));
  const [customTo,   setCustomTo]   = useState(todayStr);
  const [pendingFrom, setPendingFrom] = useState(daysAgoStr(30));
  const [pendingTo,   setPendingTo]   = useState(todayStr);
  const [data, setData]         = useState<AnalyticsData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const load = useCallback((params: { days: number } | { from: string; to: string }) => {
    setError(null);
    const qs = 'days' in params
      ? `days=${params.days}`
      : `from=${params.from}&to=${params.to}`;

    // Show cached data immediately if < 1 hour old
    const cacheKey = `at_analytics_${qs}`;
    let hasCache = false;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const { d: cached, ts } = JSON.parse(raw) as { d: AnalyticsData; ts: number };
        if (cached && Date.now() - ts < 3_600_000) {
          setData(cached);
          setLoading(false);
          setRefreshing(true);
          hasCache = true;
        }
      }
    } catch {}
    if (!hasCache) setLoading(true);

    fetch(`/api/analytics?${qs}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AnalyticsData>;
      })
      .then(d => {
        setData(d);
        setLoading(false);
        setRefreshing(false);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ d, ts: Date.now() })); } catch {}
      })
      .catch(e => { setError(String(e.message)); setLoading(false); setRefreshing(false); });
  }, [session.token]);

  useEffect(() => {
    if (preset === 'custom') load({ from: customFrom, to: customTo });
    else load({ days: preset });
  }, [preset, customFrom, customTo, load]);


  const prevChatUnread = useRef(0);
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);
  useEffect(() => {
    const load = () => {
      fetch('/api/chat?resource=tickets', { headers: { Authorization: `Bearer ${session.token}` } })
        .then(r => r.ok ? r.json() : null)
        .then((ts: Array<{ unread_by_creator?: number }> | null) => {
          if (!ts) return;
          const count = ts.reduce((s, t) => s + (t.unread_by_creator || 0), 0);
          setChatUnread(count);
          if (count > prevChatUnread.current && prevChatUnread.current >= 0 && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('New support message', {
              body: count === 1 ? 'You have 1 unread message' : `You have ${count} unread messages`,
              icon: '/favicon.ico',
            });
          }
          prevChatUnread.current = count;
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [session.token]);

  function applyCustom() {
    setCustomFrom(pendingFrom);
    setCustomTo(pendingTo);
    setPreset('custom');
  }

  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'security' | 'access' | 'videos' | 'chat' | 'settings'>('stats');
  const [securityUnreviewed, setSecurityUnreviewed] = useState(0);
  const [chatUnread, setChatUnread] = useState(0);

  const [snapping, setSnapping] = useState(false);
  const [snapMsg, setSnapMsg]   = useState<string | null>(null);

  function takeSnapshot() {
    setSnapping(true);
    setSnapMsg(null);
    fetch('/api/analytics?action=snapshot', {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(r => r.json() as Promise<{ ok?: boolean; snapshot?: Record<string, number>; error?: string }>)
      .then(d => {
        setSnapMsg(d.ok ? `Saved — Active: ${d.snapshot?.active}, Trial: ${d.snapshot?.trial}` : (d.error ?? 'Failed'));
        setSnapping(false);
        if (d.ok) {
          if (preset === 'custom') load({ from: customFrom, to: customTo });
          else load({ days: preset });
        }
      })
      .catch(() => { setSnapMsg('Request failed'); setSnapping(false); });
  }

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
      display: 'flex', alignItems: mobile ? 'stretch' : 'flex-start', justifyContent: 'center',
      overflowY: mobile ? 'hidden' : 'auto',
      padding: mobile ? 0 : '40px 20px 60px',
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 960,
        height: mobile ? '100dvh' : 'auto',
        maxHeight: mobile ? '100dvh' : 'none',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg, #111)',
        border: mobile ? 'none' : '1px solid var(--border)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
      }}>
        {/* Header */}
        <div style={{
          flexShrink: 0,
          display: 'flex', flexDirection: mobile ? 'column' : 'row',
          alignItems: mobile ? 'stretch' : 'center',
          justifyContent: 'space-between', gap: mobile ? 10 : 0,
          padding: mobile ? '10px 12px calc(10px + env(safe-area-inset-top, 0px))' : '16px 20px',
          paddingTop: mobile ? 'calc(10px + env(safe-area-inset-top, 0px))' : 16,
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <span style={{ fontSize: mobile ? 12 : 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', letterSpacing: '0.04em', flex: 1, minWidth: 0 }}>
              COMMAND CENTER
            </span>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent)', background: 'rgba(var(--accent-rgb,255,200,0),0.1)', border: '1px solid var(--accent)', padding: '1px 6px', letterSpacing: '0.08em', flexShrink: 0 }}>
              CREATOR
            </span>
            {mobile && (
            <button
              onClick={onClose}
              style={{
                height: 32, width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
                color: 'var(--text-dim)', flexShrink: 0, marginLeft: 'auto',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {activeTab === 'stats' && PRESETS.map(d => (
              <button
                key={d}
                onClick={() => setPreset(d)}
                style={{
                  height: 24, padding: '0 10px',
                  background: preset === d ? 'var(--accent)' : 'transparent',
                  border: '1px solid', borderColor: preset === d ? 'var(--accent)' : 'var(--border)',
                  color: preset === d ? '#111' : 'var(--text-dim)',
                  fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {d}D
              </button>
            ))}

            {/* Custom range */}
            {activeTab === 'stats' && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => { setPreset('custom'); setPendingFrom(customFrom); setPendingTo(customTo); }}
                style={{
                  height: 24, padding: '0 10px',
                  background: preset === 'custom' ? 'var(--accent)' : 'transparent',
                  border: '1px solid', borderColor: preset === 'custom' ? 'var(--accent)' : 'var(--border)',
                  color: preset === 'custom' ? '#111' : 'var(--text-dim)',
                  fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                Custom
              </button>
              {preset === 'custom' && (
                <>
                  <input
                    type="date"
                    value={pendingFrom}
                    max={pendingTo}
                    onChange={e => setPendingFrom(e.target.value)}
                    style={{
                      height: 24, padding: '0 6px', fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--surface-2, var(--surface))',
                      border: '1px solid var(--border)',
                      color: 'var(--text)', cursor: 'pointer',
                      colorScheme: 'dark',
                    }}
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>→</span>
                  <input
                    type="date"
                    value={pendingTo}
                    min={pendingFrom}
                    max={todayStr()}
                    onChange={e => setPendingTo(e.target.value)}
                    style={{
                      height: 24, padding: '0 6px', fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--surface-2, var(--surface))',
                      border: '1px solid var(--border)',
                      color: 'var(--text)', cursor: 'pointer',
                      colorScheme: 'dark',
                    }}
                  />
                  <button
                    onClick={applyCustom}
                    style={{
                      height: 24, padding: '0 10px',
                      background: 'var(--accent)', border: 'none',
                      color: '#111', fontSize: 10,
                      fontFamily: 'var(--font-mono)', fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Apply
                  </button>
                </>
              )}
            </div>}
            {!mobile && (
            <button
              onClick={onClose}
              style={{
                marginLeft: 8, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: '1px solid var(--border)', cursor: 'pointer',
                color: 'var(--text-dim)',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{
          flexShrink: 0,
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          padding: mobile ? '0 8px' : '0 20px',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        } as React.CSSProperties}>
          {(['stats', 'users', 'security', 'access', 'videos', 'chat', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                position: 'relative',
                padding: mobile ? '12px 12px' : '10px 16px',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-dim)',
                fontFamily: 'var(--font-mono)', fontSize: mobile ? 9 : 10, fontWeight: 700,
                letterSpacing: '0.07em', textTransform: 'uppercase',
                cursor: 'pointer', marginBottom: -1, flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {tab === 'stats' ? 'Stats'
                : tab === 'users' ? 'Users'
                : tab === 'security' ? (securityUnreviewed > 0 ? `Security (${securityUnreviewed > 99 ? '99+' : securityUnreviewed})` : 'Security')
                : tab === 'access' ? 'Access'
                : tab === 'videos' ? 'Videos'
                : tab === 'chat' ? (chatUnread > 0 ? `Chat (${chatUnread > 99 ? '99+' : chatUnread})` : 'Chat')
                : 'Settings'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: mobile
            ? (activeTab === 'chat' ? '0 0 calc(12px + env(safe-area-inset-bottom, 0px))' : '12px 12px calc(16px + env(safe-area-inset-bottom, 0px))')
            : '20px',
        } as React.CSSProperties}>
          {activeTab === 'security' && (
            <SecurityPanel session={session} onDataLoad={setSecurityUnreviewed} />
          )}

          {activeTab === 'users' && (
            <UsersPanel session={session} />
          )}

          {activeTab === 'access' && (
            <AccessPanel session={session} />
          )}

          {activeTab === 'videos' && (
            <VideosPanel session={session} />
          )}

          {activeTab === 'chat' && (
            <ChatPanel session={session} />
          )}

          {activeTab === 'settings' && (
            <VersionPanel session={session} />
          )}

          {activeTab === 'stats' && loading && (
            <div style={{ textAlign: 'center', padding: '80px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              Loading analytics...
            </div>
          )}

          {activeTab === 'stats' && error && (
            <div style={{ textAlign: 'center', padding: '80px 0', fontSize: 12, fontFamily: 'var(--font-mono)', color: '#f87171' }}>
              {error}
            </div>
          )}

          {activeTab === 'stats' && data && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {refreshing && (
                <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.06em', textAlign: 'right' }}>
                  Refreshing…
                </div>
              )}
              {/* Summary cards */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <StatCard label="Unique Users" value={data.summary.uniqueUsers} sub={preset === 'custom' ? `${customFrom} → ${customTo}` : `Last ${preset} days`} accent />
                <StatCard label="App Opens" value={data.summary.appOpenCount} sub="Session verifications" />
                <StatCard label="Logins" value={data.summary.loginCount} sub="OAuth completions" />
                <StatCard label="Peak Hour" value={formatHour(data.summary.peakHour)} sub="UTC time" />
              </div>

              {/* Subscription row */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <StatCard label="Active Subs" value={data.subscriptions.active} accent />
                <StatCard label="Trials" value={data.subscriptions.trial} />
                <StatCard label="Paused" value={data.subscriptions.paused} />
                <StatCard label="Cancelled" value={data.subscriptions.cancelled} />
                <StatCard label="Total Subs" value={data.subscriptions.total} />
              </div>

              {/* Trend chart */}
              <Panel title={preset === 'custom' ? `Daily Activity — ${customFrom} to ${customTo}` : `Daily Activity — Last ${preset} Days`}>
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
                <TrendChart data={data.dailyTrend} />
              </Panel>

              {/* Device + Countries row */}
              <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 12 }}>
                <Panel title="Device Breakdown" style={{ flex: mobile ? 'none' : '0 0 280px' }}>
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
                          <div key={country} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, flexShrink: 0, width: 22 }}>{countryFlag(country)}</span>
                            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', width: mobile ? 80 : 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                <div style={{ display: 'flex', gap: 16, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Active</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: '#a78bfa', borderRadius: 1, opacity: 0.7 }} />
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Trial</span>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {snapMsg && (
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{snapMsg}</span>
                    )}
                    <button
                      onClick={takeSnapshot}
                      disabled={snapping}
                      style={{
                        height: 22, padding: '0 10px',
                        background: 'transparent', border: '1px solid var(--border)',
                        color: 'var(--text-dim)', fontSize: 9,
                        fontFamily: 'var(--font-mono)', fontWeight: 700,
                        cursor: snapping ? 'default' : 'pointer', opacity: snapping ? 0.5 : 1,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                      }}
                    >
                      {snapping ? 'Saving…' : 'Snapshot Now'}
                    </button>
                  </div>
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
