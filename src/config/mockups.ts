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
];
