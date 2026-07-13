export const ACCENTS = [
  { name: 'Orange',  accent: '#FF6B1A', h: '#E55A0A', dim: 'rgba(255,107,26,0.12)' },
  { name: 'Citrine', accent: '#D4A820', h: '#B8900A', dim: 'rgba(212,168,32,0.12)' },
  { name: 'Red',     accent: '#EF4444', h: '#DC2626', dim: 'rgba(239,68,68,0.12)'  },
  { name: 'Green',   accent: '#22C55E', h: '#16A34A', dim: 'rgba(34,197,94,0.12)'  },
  { name: 'Blue',    accent: '#3B82F6', h: '#2563EB', dim: 'rgba(59,130,246,0.12)' },
  { name: 'Grey',    accent: '#9CA3AF', h: '#6B7280', dim: 'rgba(156,163,175,0.12)'},
] as const;

export function applyAccentByHex(hex: string) {
  const found = ACCENTS.find(a => a.accent === hex);
  if (!found) return;
  const root = document.documentElement;
  root.style.setProperty('--accent',     found.accent);
  root.style.setProperty('--accent-h',   found.h);
  root.style.setProperty('--accent-dim', found.dim);
}
