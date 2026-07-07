export interface ColorVariant {
  name: string;
  hex: string;   // swatch color shown in the UI
  file: string;  // path to the PNG under /public/
}

export interface MockupDef {
  id: string;
  brand: string;
  model: string;
  name: string;
  category: string;
  view: string;
  variants: ColorVariant[];
  credit?: { handle: string; url: string };
}

export const MOCKUPS: MockupDef[] = [
  {
    id: 'la-1801-front',
    brand: 'LA Apparel',
    model: '1801',
    name: 'Heavyweight Tee',
    category: 'T-Shirt',
    view: 'Front',
    variants: [
      { name: 'White',       hex: '#FFFFFF', file: '/mockups/LosAngelesApparel_1801_Front_White.png' },
      { name: 'Black',       hex: '#141414', file: '/mockups/LosAngelesApparel_1801_Front.png' },
    ],
  },
  {
    id: 'la-1801-back',
    brand: 'LA Apparel',
    model: '1801',
    name: 'Heavyweight Tee',
    category: 'T-Shirt',
    view: 'Back',
    variants: [
      { name: 'White',       hex: '#FFFFFF', file: '/mockups/LosAngelesApparel_1801_Back_White.png' },
      { name: 'Black',       hex: '#141414', file: '/mockups/LosAngelesApparel_1801_Back.png' },
    ],
  },
  {
    id: 'elwood-core-front',
    brand: 'Elwood',
    model: 'Core Tee',
    name: 'Core Tee',
    category: 'T-Shirt',
    view: 'Front',
    variants: [
      { name: 'Black',       hex: '#141414', file: '/mockups/Elwood_Black_Front.png' },
      { name: 'Thrift Black',hex: '#3A3633', file: '/mockups/Elwood_ThriftBlack_Front.png' },
      { name: 'Dusty White', hex: '#E8E2D8', file: '/mockups/Elwood_DustyWhite_Front.png' },
      { name: 'Faded Brown', hex: '#8A6B50', file: '/mockups/Elwood_FadedBrown_Front.png' },
      { name: 'Red',         hex: '#C0392B', file: '/mockups/Elwood_Red_Front.png' },
    ],
  },
  {
    id: 'elwood-core-back',
    brand: 'Elwood',
    model: 'Core Tee',
    name: 'Core Tee',
    category: 'T-Shirt',
    view: 'Back',
    variants: [
      { name: 'Black',       hex: '#141414', file: '/mockups/Elwood_Black_Back.png' },
      { name: 'Thrift Black',hex: '#3A3633', file: '/mockups/Elwood_ThriftBlack_Back.png' },
      { name: 'Dusty White', hex: '#E8E2D8', file: '/mockups/Elwood_DustyWhite_Back.png' },
      { name: 'Faded Brown', hex: '#8A6B50', file: '/mockups/Elwood_FadedBrown_Back.png' },
      { name: 'Red',         hex: '#C0392B', file: '/mockups/Elwood_Red_Back.png' },
    ],
  },
  {
    id: 'premium-hoodie-front',
    brand: 'Premium',
    model: 'Hoodie',
    name: 'Premium Hoodie',
    category: 'Hoodie',
    view: 'Front',
    credit: { handle: '@chazmadethat', url: 'https://www.instagram.com/chazmadethat' },
    variants: [
      { name: 'White',      hex: '#F0EDE8', file: '/mockups/PremiumHoodie__White_Front_byChazemadethat.png' },
      { name: 'Black',      hex: '#1A1A1A', file: '/mockups/PremiumHoodie__Black_Front_byChazemadethat.png' },
      { name: 'Dark Grey',  hex: '#3D3D3D', file: '/mockups/PremiumHoodie__DarkGrey_Front_byChazemadethat.png' },
      { name: 'Brown',      hex: '#7A5C45', file: '/mockups/PremiumHoodie__Brown_Front_byChazemadethat.png' },
    ],
  },
  {
    id: 'premium-hoodie-back',
    brand: 'Premium',
    model: 'Hoodie',
    name: 'Premium Hoodie',
    category: 'Hoodie',
    view: 'Back',
    credit: { handle: '@chazmadethat', url: 'https://www.instagram.com/chazmadethat' },
    variants: [
      { name: 'White',      hex: '#F0EDE8', file: '/mockups/PremiumHoodie__White_Back_byChazemadethat.png' },
      { name: 'Black',      hex: '#1A1A1A', file: '/mockups/PremiumHoodie__Black_Back_byChazemadethat.png' },
      { name: 'Dark Grey',  hex: '#3D3D3D', file: '/mockups/PremiumHoodie__DarkGrey_Back_byChazemadethat.png' },
      { name: 'Brown',      hex: '#7A5C45', file: '/mockups/PremiumHoodie__Brown_Back_byChazemadethat.png' },
    ],
  },
];
