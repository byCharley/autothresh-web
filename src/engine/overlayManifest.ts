export interface OverlayEntry {
  label: string;
  path: string;
}

export interface OverlayCategory {
  id: string;
  label: string;
  items: OverlayEntry[];
}

const CDN = 'https://fsmqocvxzzokcmcnnspj.supabase.co/storage/v1/object/public/overlays';

function range(count: number, label: string, folder: string, prefix: string, ext: string, start = 1, pad = 2): OverlayEntry[] {
  const encodedFolder = encodeURIComponent(folder);
  return Array.from({ length: count }, (_, i) => {
    const n = start + i;
    const num = String(n).padStart(pad, '0');
    return { label: `${label} ${String(n).padStart(2, '0')}`, path: `${CDN}/${encodedFolder}/${prefix}${num}${ext}` };
  });
}

export const OVERLAY_CATEGORIES: OverlayCategory[] = [
  {
    id: 'grunge',
    label: 'Grunge',
    items: range(250, 'Grunge', 'grunge', '', '.jpg', 1, 3),
  },
  {
    id: 'chalkboard',
    label: 'Chalkboard',
    items: [
      ...range(99, 'Chalk', 'chalkboard', '', '.jpg', 1, 2),
      { label: 'Chalk 100', path: `${CDN}/chalkboard/100.jpg` },
    ],
  },
  {
    id: 'noise',
    label: 'Noise',
    items: range(100, 'Noise', 'noise textures', '', '.png', 1, 3),
  },
  {
    id: 'film',
    label: 'Film',
    items: Array.from({ length: 10 }, (_, i) => ({
      label: `Film ${String(i + 1).padStart(2, '0')}`,
      path: `${CDN}/film/AU-FG-Texture${i + 1}-8K.jpg`,
    })),
  },
  {
    id: 'halftones',
    label: 'Halftone',
    items: Array.from({ length: 10 }, (_, i) => ({
      label: `Halftone ${String(i + 1).padStart(2, '0')}`,
      path: `${CDN}/halftones/Texture-${String(i + 1).padStart(2, '0')}.png`,
    })),
  },
  {
    id: 'rust',
    label: 'Rust',
    items: Array.from({ length: 50 }, (_, i) => ({
      label: `Rust ${String(i + 1).padStart(2, '0')}`,
      path: `${CDN}/rust/${i + 1}.jpg`,
    })),
  },
];
