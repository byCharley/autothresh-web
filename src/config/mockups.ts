export interface MockupDef {
  id: string;
  name: string;
  file: string;   // path under /public/
  isDark: boolean;
  color: string;  // approximate swatch color
}

export const MOCKUPS: MockupDef[] = [
  { id: 'la-black-front', name: 'Black Front', file: '/mockups/LosAngelesApparel_1801_Front.png',       isDark: true,  color: '#111111' },
  { id: 'la-black-back',  name: 'Black Back',  file: '/mockups/LosAngelesApparel_1801_Back.png',        isDark: true,  color: '#111111' },
  { id: 'la-white-front', name: 'White Front', file: '/mockups/LosAngelesApparel_1801_Front_White.png', isDark: false, color: '#F2F0EC' },
  { id: 'la-white-back',  name: 'White Back',  file: '/mockups/LosAngelesApparel_1801_Back_White.png',  isDark: false, color: '#F2F0EC' },
];
