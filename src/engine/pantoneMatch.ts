import pantoneData from 'pantone-colors';

// Named Pantone Coated colors not in the numeric set
const NAMED: Record<string, string> = {
  'Yellow C': 'FEDD00',
  'Yellow 012 C': 'FFD700',
  'Orange 021 C': 'FE5000',
  'Warm Red C': 'F9423A',
  'Red 032 C': 'EF3340',
  'Rubine Red C': 'CE0058',
  'Rhodamine Red C': 'E10098',
  'Purple C': 'BB29BB',
  'Violet C': '440099',
  'Blue 072 C': '10069F',
  'Reflex Blue C': '001489',
  'Process Blue C': '0085CA',
  'Green C': '00AB84',
  'Black C': '2D2926',
  'White': 'FFFFFF',
};

type Entry = { name: string; lab: [number, number, number]; hex: string };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = toLinear(r), gl = toLinear(g), bl = toLinear(b);
  const X = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const Y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
  const Z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Build lookup once at module init
const ENTRIES: Entry[] = [];
for (const [key, hex] of Object.entries(pantoneData as Record<string, string>)) {
  const [r, g, b] = hexToRgb(hex);
  ENTRIES.push({ name: `PMS ${key} C`, lab: rgbToLab(r, g, b), hex });
}
for (const [name, hex] of Object.entries(NAMED)) {
  const [r, g, b] = hexToRgb(hex);
  ENTRIES.push({ name, lab: rgbToLab(r, g, b), hex: `#${hex.toLowerCase()}` });
}

export interface PantoneMatch {
  name: string;
  hex: string;
  deltaE: number;
}

export function nearestPantone(r: number, g: number, b: number): PantoneMatch {
  const [L, a, bv] = rgbToLab(r, g, b);
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < ENTRIES.length; i++) {
    const [lL, la, lb] = ENTRIES[i].lab;
    const d = Math.sqrt((L - lL) ** 2 + (a - la) ** 2 + (bv - lb) ** 2);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return { name: ENTRIES[best].name, hex: ENTRIES[best].hex, deltaE: Math.round(bestDist * 10) / 10 };
}

export function hexToPantone(hex: string): PantoneMatch {
  const [r, g, b] = hexToRgb(hex);
  return nearestPantone(r, g, b);
}

export function nearestPantoneRgb(r: number, g: number, b: number): [number, number, number] {
  const h = nearestPantone(r, g, b).hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Shadow detection: luminance < 60/255 ≈ 24% brightness
export function isShadowColor(r: number, g: number, b: number): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 60;
}
