export interface MockupDef {
  id: string;
  name: string;
  file: string;   // path under /public/
  isDark: boolean;
  color: string;  // approximate swatch color
}

// Add PNG files to /public/mockups/ and add entries here.
// isDark=true  → auto blend defaults to "screen"  (white/light inks show on dark fabric)
// isDark=false → auto blend defaults to "multiply" (ink blends with light fabric texture)
export const MOCKUPS: MockupDef[] = [
  { id: 'black-tee',  name: 'Black',  file: '/mockups/black-tee.png',  isDark: true,  color: '#111111' },
  { id: 'white-tee',  name: 'White',  file: '/mockups/white-tee.png',  isDark: false, color: '#F5F5F5' },
  { id: 'navy-tee',   name: 'Navy',   file: '/mockups/navy-tee.png',   isDark: true,  color: '#1A2448' },
  { id: 'grey-tee',   name: 'Grey',   file: '/mockups/grey-tee.png',   isDark: false, color: '#9A9898' },
  { id: 'red-tee',    name: 'Red',    file: '/mockups/red-tee.png',    isDark: true,  color: '#CC1820' },
  { id: 'forest-tee', name: 'Forest', file: '/mockups/forest-tee.png', isDark: true,  color: '#205030' },
];
