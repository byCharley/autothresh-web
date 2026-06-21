import { useState } from 'react';
import { useStore } from '../store/useStore';
import { extractPalette } from '../engine/imageProcessor';

// ─── Icons ────────────────────────────────────────────────────────────────────

function EyeIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="16 3 21 3 21 8"/>
      <line x1="4" y1="20" x2="21" y2="3"/>
      <polyline points="21 16 21 21 16 21"/>
      <line x1="15" y1="15" x2="21" y2="21"/>
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '0 12px', height: 32,
        background: 'none', border: 'none', borderTop: '1px solid var(--border)',
        cursor: 'pointer', color: 'var(--text-muted)',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
        {title}
      </span>
      <ChevronIcon open={open} />
    </button>
  );
}

function SwitchRow({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {label}
      </span>
      <label className="switch" style={{ flexShrink: 0 }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <div className="switch-track" /><div className="switch-thumb" />
      </label>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number;
  step?: number; onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ width: '100%' }}
        onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

// ─── Brand fabric palettes ────────────────────────────────────────────────────

const BRAND_PALETTES: { brand: string; colors: { hex: string; name: string }[] }[] = [
  {
    brand: 'Bella Canvas',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#F4EED4', name: 'Cream' },
      { hex: '#E5D4B2', name: 'Natural' },
      { hex: '#F0E8D8', name: 'Soft Crème' },
      { hex: '#B8BCC0', name: 'Athletic Heather' },
      { hex: '#C8C9CC', name: 'Silver' },
      { hex: '#CEC9C5', name: 'Ash' },
      { hex: '#6B6B76', name: 'Dark Grey Heather' },
      { hex: '#4A4A55', name: 'Charcoal' },
      { hex: '#3C3C44', name: 'Dark Grey' },
      { hex: '#0D0D0D', name: 'Black' },
      { hex: '#A5C8DE', name: 'Baby Blue' },
      { hex: '#7EB0D4', name: 'Carolina Blue' },
      { hex: '#1B62A8', name: 'True Royal' },
      { hex: '#1A5C8A', name: 'Ocean' },
      { hex: '#2C3D5C', name: 'Heather Navy' },
      { hex: '#1C2848', name: 'Navy' },
      { hex: '#228C8C', name: 'Teal' },
      { hex: '#1A7A30', name: 'Kelly Green' },
      { hex: '#426840', name: 'Leaf' },
      { hex: '#1A4828', name: 'Forest' },
      { hex: '#8A9A76', name: 'Sage' },
      { hex: '#5A5A24', name: 'Olive' },
      { hex: '#D2A828', name: 'Yellow Gold' },
      { hex: '#BA9810', name: 'Mustard' },
      { hex: '#E85C1C', name: 'Orange' },
      { hex: '#CC1E1E', name: 'Red' },
      { hex: '#9A1818', name: 'Cardinal' },
      { hex: '#6A0E18', name: 'Maroon' },
      { hex: '#781A44', name: 'Berry' },
      { hex: '#BC7880', name: 'Mauve' },
      { hex: '#F4B0C0', name: 'Light Pink' },
      { hex: '#9898CC', name: 'Lavender Blue' },
      { hex: '#BFA8D8', name: 'Lilac' },
      { hex: '#5A1A7A', name: 'Purple' },
    ],
  },
  {
    brand: 'Comfort Colors',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#F2E8D0', name: 'Ivory' },
      { hex: '#F2DC88', name: 'Butter' },
      { hex: '#ECC81A', name: 'Citrus' },
      { hex: '#E8C520', name: 'Yellow' },
      { hex: '#C89820', name: 'Mustard' },
      { hex: '#F4A088', name: 'Melon' },
      { hex: '#F07040', name: 'Tangerine' },
      { hex: '#E86020', name: 'Orange' },
      { hex: '#C41C1C', name: 'Pepper' },
      { hex: '#C01A1A', name: 'Red' },
      { hex: '#9A2818', name: 'Brick' },
      { hex: '#9E1A30', name: 'Crimson' },
      { hex: '#CC3858', name: 'Watermelon' },
      { hex: '#781845', name: 'Berry' },
      { hex: '#841830', name: 'Garnet' },
      { hex: '#681030', name: 'Wine' },
      { hex: '#D898A8', name: 'Blossom' },
      { hex: '#E87898', name: 'Candy Pink' },
      { hex: '#A0D8BE', name: 'Chalky Mint' },
      { hex: '#3ABE88', name: 'Spearmint' },
      { hex: '#1E9878', name: 'Island Green' },
      { hex: '#58CAA8', name: 'Seafoam' },
      { hex: '#6E7858', name: 'Artichoke' },
      { hex: '#687838', name: 'Moss' },
      { hex: '#386090', name: 'Blue Jean' },
      { hex: '#1E50A8', name: 'Cobalt' },
      { hex: '#1A2A50', name: 'True Navy' },
      { hex: '#98C0D8', name: 'Ice Blue' },
      { hex: '#4878A0', name: 'Steel Blue' },
      { hex: '#7898B8', name: 'Washed Denim' },
      { hex: '#5830A0', name: 'Violet' },
      { hex: '#581A80', name: 'Purple' },
      { hex: '#B878C8', name: 'Orchid' },
      { hex: '#ADADB5', name: 'Grey' },
      { hex: '#8888A0', name: 'Pewter' },
      { hex: '#484860', name: 'Graphite' },
      { hex: '#191919', name: 'Black' },
    ],
  },
  {
    brand: 'Gildan',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#EDE0C9', name: 'Natural' },
      { hex: '#D0CCCC', name: 'Ice Grey' },
      { hex: '#A09E9E', name: 'Sport Grey' },
      { hex: '#5A5A5E', name: 'Graphite Heather' },
      { hex: '#40404A', name: 'Dark Heather' },
      { hex: '#404040', name: 'Charcoal' },
      { hex: '#1A1A1A', name: 'Black' },
      { hex: '#8ABDE0', name: 'Light Blue' },
      { hex: '#80B4D8', name: 'Carolina Blue' },
      { hex: '#90C8E8', name: 'Sky' },
      { hex: '#1A5CAA', name: 'Royal' },
      { hex: '#2050B0', name: 'Cobalt' },
      { hex: '#1A4C8A', name: 'Sapphire' },
      { hex: '#1A2440', name: 'Navy' },
      { hex: '#1A9870', name: 'Jade Dome' },
      { hex: '#1A8030', name: 'Kelly Green' },
      { hex: '#20A040', name: 'Irish Green' },
      { hex: '#205030', name: 'Forest Green' },
      { hex: '#5A6030', name: 'Military Green' },
      { hex: '#F0E000', name: 'Safety Yellow' },
      { hex: '#F0D840', name: 'Daisy' },
      { hex: '#D4A810', name: 'Gold' },
      { hex: '#E85A14', name: 'Orange' },
      { hex: '#F07800', name: 'Safety Orange' },
      { hex: '#E8600A', name: 'Tennessee Orange' },
      { hex: '#C01818', name: 'Red' },
      { hex: '#B01020', name: 'Cherry Red' },
      { hex: '#601020', name: 'Maroon' },
      { hex: '#8A1830', name: 'Garnet' },
      { hex: '#CC2860', name: 'Heliconia' },
      { hex: '#E0789A', name: 'Azalea' },
      { hex: '#F0B8C4', name: 'Light Pink' },
      { hex: '#5C1C82', name: 'Purple' },
      { hex: '#6030A8', name: 'Violet' },
      { hex: '#C8B898', name: 'Sand' },
    ],
  },
  {
    brand: 'Hanes',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#D0CCCC', name: 'Ash' },
      { hex: '#B8B8BE', name: 'Light Steel' },
      { hex: '#9A989A', name: 'Smoke Grey' },
      { hex: '#585860', name: 'Charcoal Heather' },
      { hex: '#1C1C1E', name: 'Black' },
      { hex: '#AA1820', name: 'Deep Red' },
      { hex: '#E8607A', name: 'Wow Pink' },
      { hex: '#D4A820', name: 'Gold' },
      { hex: '#E8601A', name: 'Orange' },
      { hex: '#386898', name: 'Denim Blue' },
      { hex: '#1A5CAA', name: 'Athletic Royal' },
      { hex: '#1A2748', name: 'Navy' },
      { hex: '#1E4A28', name: 'Deep Forest' },
      { hex: '#5A6030', name: 'Fatigue' },
    ],
  },
  {
    brand: 'Alstyle',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#C0C0C8', name: 'Silver' },
      { hex: '#9A9898', name: 'Sport Grey' },
      { hex: '#424248', name: 'Charcoal' },
      { hex: '#1A1A1A', name: 'Black' },
      { hex: '#1A5CA8', name: 'Royal' },
      { hex: '#1A2448', name: 'Navy' },
      { hex: '#CC1820', name: 'Red' },
      { hex: '#601020', name: 'Maroon' },
      { hex: '#3A2018', name: 'Dark Chocolate' },
      { hex: '#80B4D8', name: 'Carolina Blue' },
      { hex: '#205030', name: 'Forest Green' },
      { hex: '#E8601A', name: 'Orange' },
      { hex: '#1A8030', name: 'Kelly Green' },
    ],
  },
  {
    brand: 'Tultex',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#B5B9BD', name: 'Athletic Heather' },
      { hex: '#B8B8BC', name: 'Heather Grey' },
      { hex: '#5A5A60', name: 'Charcoal Heather' },
      { hex: '#1A1A1A', name: 'Black' },
      { hex: '#2D3D5C', name: 'Heather Navy' },
      { hex: '#1A2448', name: 'Navy' },
      { hex: '#BC3A40', name: 'Heather Red' },
      { hex: '#CC1820', name: 'Red' },
      { hex: '#3A68B0', name: 'Heather Royal' },
      { hex: '#1A5CA8', name: 'Royal' },
      { hex: '#3A6038', name: 'Heather Forest' },
      { hex: '#1E4A28', name: 'Forest' },
      { hex: '#9898CC', name: 'Heather Lavender' },
    ],
  },
  {
    brand: 'Delta',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#C8C8CC', name: 'Silver' },
      { hex: '#D0CCCC', name: 'Light Grey' },
      { hex: '#B0AEB0', name: 'Athletic Grey' },
      { hex: '#404048', name: 'Charcoal' },
      { hex: '#1A1A1A', name: 'Black' },
      { hex: '#1A2448', name: 'Navy' },
      { hex: '#1A5CA8', name: 'Royal' },
      { hex: '#CC1820', name: 'Red' },
      { hex: '#601020', name: 'Maroon' },
      { hex: '#1E4A28', name: 'Forest' },
      { hex: '#D4A820', name: 'Gold' },
      { hex: '#CC5010', name: 'Burnt Orange' },
    ],
  },
  {
    brand: 'AS Colour',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#F0E8D4', name: 'Cream' },
      { hex: '#E0D4BC', name: 'Natural' },
      { hex: '#E8E0D0', name: 'Bone' },
      { hex: '#C8C4BE', name: 'Birch Heather' },
      { hex: '#B0ACB0', name: 'Grey Marle' },
      { hex: '#6A6870', name: 'Dark Grey' },
      { hex: '#484850', name: 'Charcoal' },
      { hex: '#0A0A0A', name: 'Black' },
      { hex: '#AACCE0', name: 'Pale Blue' },
      { hex: '#6AAACE', name: 'Sky Blue' },
      { hex: '#3A70B0', name: 'Mid Blue' },
      { hex: '#1A5C9A', name: 'Pacific Blue' },
      { hex: '#1C2A50', name: 'Navy' },
      { hex: '#1A7888', name: 'Teal Blue' },
      { hex: '#2A5030', name: 'Forest' },
      { hex: '#8A9A78', name: 'Sage' },
      { hex: '#B89060', name: 'Tan' },
      { hex: '#C8A060', name: 'Camel' },
      { hex: '#6A4030', name: 'Brown' },
      { hex: '#985030', name: 'Terra' },
      { hex: '#C84820', name: 'Rust' },
      { hex: '#E86020', name: 'Orange' },
      { hex: '#E03050', name: 'Watermelon' },
      { hex: '#C81A20', name: 'Red' },
      { hex: '#781828', name: 'Burgundy' },
      { hex: '#681840', name: 'Mulberry' },
      { hex: '#B82050', name: 'Raspberry' },
      { hex: '#D8A0A8', name: 'Dusty Pink' },
      { hex: '#F0C0C8', name: 'Baby Pink' },
      { hex: '#A8A0CC', name: 'Lavender' },
      { hex: '#C8B8D8', name: 'Lilac' },
      { hex: '#5A1878', name: 'Purple' },
    ],
  },
  {
    brand: 'Shaka Wear',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#F0E4CC', name: 'Natural' },
      { hex: '#D8C8A0', name: 'Sand' },
      { hex: '#B8B8BC', name: 'Heather Grey' },
      { hex: '#6A6A72', name: 'Dark Heather' },
      { hex: '#484850', name: 'Charcoal' },
      { hex: '#0A0A0A', name: 'Black' },
      { hex: '#C81A1A', name: 'Red' },
      { hex: '#8A1818', name: 'Cardinal' },
      { hex: '#601018', name: 'Maroon' },
      { hex: '#701830', name: 'Burgundy' },
      { hex: '#D4A010', name: 'Gold' },
      { hex: '#E8D020', name: 'Yellow' },
      { hex: '#E86018', name: 'Orange' },
      { hex: '#FF6600', name: 'Neon Orange' },
      { hex: '#DCEE00', name: 'Neon Yellow' },
      { hex: '#FF2880', name: 'Neon Pink' },
      { hex: '#00CC44', name: 'Neon Green' },
      { hex: '#1A5CA8', name: 'Royal Blue' },
      { hex: '#A0C8E0', name: 'Baby Blue' },
      { hex: '#1A2448', name: 'Navy' },
      { hex: '#2050B0', name: 'Cobalt' },
      { hex: '#205030', name: 'Forest' },
      { hex: '#1A7830', name: 'Kelly' },
      { hex: '#5A1878', name: 'Purple' },
      { hex: '#D82060', name: 'Hot Pink' },
      { hex: '#F0A0B8', name: 'Pink' },
      { hex: '#1A8080', name: 'Teal' },
    ],
  },
  {
    brand: 'LA Apparel',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#F2E8D4', name: 'Cream' },
      { hex: '#F0E8D8', name: 'Off White' },
      { hex: '#C4C4C8', name: 'Silver' },
      { hex: '#ACACB2', name: 'Heather Grey' },
      { hex: '#888898', name: 'Slate' },
      { hex: '#484850', name: 'Charcoal' },
      { hex: '#0A0A0A', name: 'Black' },
      { hex: '#98C8E0', name: 'Light Blue' },
      { hex: '#507098', name: 'Denim' },
      { hex: '#1858A8', name: 'Royal Blue' },
      { hex: '#1A2448', name: 'Navy' },
      { hex: '#206030', name: 'Forest Green' },
      { hex: '#1E4828', name: 'Hunter Green' },
      { hex: '#5A6028', name: 'Army Green' },
      { hex: '#CC1A1A', name: 'Red' },
      { hex: '#901830', name: 'Cranberry' },
      { hex: '#701828', name: 'Burgundy' },
      { hex: '#8A2820', name: 'Brick' },
      { hex: '#E86020', name: 'Orange' },
      { hex: '#D0A020', name: 'Gold' },
      { hex: '#E8D028', name: 'Yellow' },
      { hex: '#F0A8B8', name: 'Pink' },
      { hex: '#D82058', name: 'Hot Pink' },
      { hex: '#C07880', name: 'Mauve' },
      { hex: '#A8A0CC', name: 'Lavender' },
      { hex: '#5A1878', name: 'Purple' },
      { hex: '#6A4030', name: 'Brown' },
      { hex: '#C0A070', name: 'Tan' },
    ],
  },
  {
    brand: 'Independent Trading',
    colors: [
      { hex: '#FFFFFF', name: 'White' },
      { hex: '#EDE4D0', name: 'Natural' },
      { hex: '#E8DECE', name: 'Bone' },
      { hex: '#D8CEB8', name: 'Oatmeal Heather' },
      { hex: '#B8B8BC', name: 'Heather Grey' },
      { hex: '#6A6A72', name: 'Graphite Heather' },
      { hex: '#484850', name: 'Charcoal' },
      { hex: '#0A0A0A', name: 'Black' },
      { hex: '#A0C8E0', name: 'Light Blue' },
      { hex: '#6AAAD0', name: 'Sky Blue' },
      { hex: '#6070A0', name: 'Slate Blue' },
      { hex: '#1860A8', name: 'True Royal' },
      { hex: '#789AB0', name: 'Dusty Blue' },
      { hex: '#1E2A50', name: 'Navy' },
      { hex: '#1A7A80', name: 'Teal' },
      { hex: '#205030', name: 'Forest Green' },
      { hex: '#889878', name: 'Sage' },
      { hex: '#6A7850', name: 'Cactus' },
      { hex: '#6A4028', name: 'Chocolate Brown' },
      { hex: '#C8A060', name: 'Camel' },
      { hex: '#C84818', name: 'Rust' },
      { hex: '#E86018', name: 'Orange' },
      { hex: '#CC1A1A', name: 'Red' },
      { hex: '#8E1828', name: 'Cranberry' },
      { hex: '#601018', name: 'Maroon' },
      { hex: '#D8A0A8', name: 'Dusty Pink' },
      { hex: '#F0C0C8', name: 'Light Pink' },
      { hex: '#C89888', name: 'Rose Gold' },
      { hex: '#B87880', name: 'Mauve' },
      { hex: '#A8A0CC', name: 'Lavender' },
      { hex: '#5A1878', name: 'Purple' },
      { hex: '#D0A020', name: 'Gold' },
    ],
  },
];

// ─── Fabric Section ───────────────────────────────────────────────────────────

function FabricSection() {
  const [open, setOpen] = useState(true);
  const [brand, setBrand] = useState('Bella Canvas');
  const { canvasColor, setCanvasColor, showFabricBg, setShowFabricBg } = useStore();

  const palette = BRAND_PALETTES.find((b) => b.brand === brand)?.colors ?? [];
  const matchedColor = palette.find((c) => c.hex.toLowerCase() === canvasColor.toLowerCase());

  return (
    <>
      <SectionHeader title="Fabric" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwitchRow label="Show Background" checked={showFabricBg} onChange={setShowFabricBg} />

          <div style={{ opacity: showFabricBg ? 1 : 0.45, pointerEvents: showFabricBg ? 'auto' : 'none', transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Brand selector */}
            <select className="at-select" value={brand} onChange={(e) => setBrand(e.target.value)}>
              {BRAND_PALETTES.map((b) => (
                <option key={b.brand} value={b.brand}>{b.brand}</option>
              ))}
            </select>

            {/* Color picker row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="color-swatch-btn" style={{ background: canvasColor, width: 26, height: 26, flexShrink: 0 }}>
                <input type="color" value={canvasColor} onChange={(e) => setCanvasColor(e.target.value)} />
              </div>
              <input
                className="color-hex"
                type="text"
                value={canvasColor}
                maxLength={7}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setCanvasColor(e.target.value);
                }}
              />
            </div>

            {/* Matched color name */}
            {matchedColor && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: -4 }}>
                {matchedColor.name}
              </div>
            )}

            {/* Swatch grid */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {palette.map(({ hex, name }) => (
                <button
                  key={hex + name}
                  onClick={() => setCanvasColor(hex)}
                  title={name}
                  style={{
                    width: 20, height: 20, background: hex, cursor: 'pointer', flexShrink: 0,
                    border: canvasColor.toLowerCase() === hex.toLowerCase() ? '2px solid var(--accent)' : '1px solid var(--border-2)',
                    boxShadow: canvasColor.toLowerCase() === hex.toLowerCase() ? '0 0 0 1px var(--accent)' : 'none',
                    transition: 'border 0.1s, box-shadow 0.1s',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Texture Section ──────────────────────────────────────────────────────────

function TextureSection() {
  const [open, setOpen] = useState(true);
  const {
    originalImage,
    textureEnabled, textureIntensity, textureScale, textureSeed,
    setTextureEnabled, setTextureIntensity, setTextureScale, setTextureSeed,
  } = useStore();
  if (!originalImage) return null;

  return (
    <>
      <SectionHeader title="Plastisol Texture" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwitchRow label="Enable" checked={textureEnabled} onChange={setTextureEnabled} />

          <div style={{ opacity: textureEnabled ? 1 : 0.4, pointerEvents: textureEnabled ? 'auto' : 'none', transition: 'opacity 0.2s', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Slider label="Intensity" value={textureIntensity} min={0} max={100} step={1}
              onChange={setTextureIntensity} unit="%" />
            <Slider label="Scale" value={textureScale} min={0.25} max={4} step={0.25}
              onChange={setTextureScale} />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Seed: {textureSeed}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 10, height: 24, padding: '0 8px' }}
                onClick={() => setTextureSeed(Math.floor(Math.random() * 99999))}
              >
                Randomize
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Background Removal Section ───────────────────────────────────────────────

function ArtworkSection() {
  const [open, setOpen] = useState(true);
  const { originalImage, bgRemovalEnabled, bgTolerance, setBgRemovalEnabled, setBgTolerance } = useStore();
  if (!originalImage) return null;

  return (
    <>
      <SectionHeader title="Background" open={open} onToggle={() => setOpen(!open)} />
      {open && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SwitchRow label="Remove BG" checked={bgRemovalEnabled} onChange={setBgRemovalEnabled} />
          {bgRemovalEnabled && (
            <Slider label="Tolerance" value={bgTolerance} min={1} max={100}
              onChange={setBgTolerance} unit="%" />
          )}
        </div>
      )}
    </>
  );
}

// ─── CMYK Channel Definitions ─────────────────────────────────────────────────

const CMYK_CARD_DEFS = [
  { id: 'cmyk-k', name: 'K · Black',   color: '#0a0a0a' },
  { id: 'cmyk-c', name: 'C · Cyan',    color: '#00aeef' },
  { id: 'cmyk-m', name: 'M · Magenta', color: '#ec008c' },
  { id: 'cmyk-y', name: 'Y · Yellow',  color: '#fff200' },
];

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function LayerPanel() {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const commitLayerName = (id: string) => {
    if (editValue.trim()) updateLayer(id, { name: editValue.trim() });
    setEditingLayerId(null);
    setEditValue('');
  };

  const {
    layers, selectedLayerId, selectLayer, updateLayer,
    previewImage, palettePool, activePaletteIdx, setPalettePool, applyPalette,
    separationMode, setSeparationMode,
    cmykVisibility, setCmykLayerVisible, cmykAngles,
    addLayer, removeLayer, duplicateLayer, paintMasks, paintMode,
    globalPattern,
  } = useStore();

  const handleAutoPalette = () => {
    if (!previewImage) return;
    const palettes = [
      extractPalette(previewImage, 4),
      extractPalette(previewImage, 4),
      extractPalette(previewImage, 4),
    ];
    setPalettePool(palettes);
    applyPalette(0);
  };

  const handleShuffle = () => {
    if (palettePool.length === 0) return;
    applyPalette((activePaletteIdx + 1) % palettePool.length);
  };

  return (
    <aside className="panel-left">
      <div className="panel-header">
        <span className="panel-title">Layers</span>
        {separationMode === 'threshold' && (
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {layers.filter(l => l.visible).length}/{layers.length}
          </span>
        )}
      </div>

      {/* Single scrollable column */}
      <div className="left-scroll">
        {/* Mode Switcher — CMYK only visible in local dev */}
        <div style={{ display: 'flex', padding: '6px 8px', gap: 4, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {(['threshold', ...(import.meta.env.DEV ? ['cmyk'] : [])] as ('threshold' | 'cmyk')[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSeparationMode(mode)}
              style={{
                flex: 1, height: 28, fontSize: 10, fontFamily: 'var(--font-mono)',
                fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                cursor: 'pointer', border: '1px solid var(--border)',
                background: separationMode === mode ? 'var(--accent)' : 'var(--surface-2)',
                color: separationMode === mode ? '#000' : 'var(--text-muted)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {mode === 'threshold' ? 'Threshold' : 'CMYK'}
            </button>
          ))}
        </div>

        {separationMode === 'cmyk' ? (
          <>
            {/* CMYK layer cards */}
            <div style={{ padding: '8px 8px 0px' }}>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 6, lineHeight: 1.5 }}>
                Click a plate to view its halftone screen. All plates on = color proof.
              </div>
              {[...CMYK_CARD_DEFS].reverse().map(({ id, name, color }) => {
                const visible = cmykVisibility[id] ?? false;
                const isSolo = visible && Object.entries(cmykVisibility).filter(([, v]) => v).length === 1;
                const angle = cmykAngles[id] ?? 0;
                return (
                  <div
                    key={id}
                    className="layer-card"
                    style={{ marginBottom: 4, cursor: 'pointer', outline: isSolo ? '1px solid var(--accent)' : 'none' }}
                    onClick={() => {
                      // Solo this channel (turn off all others)
                      const allOff = { 'cmyk-k': false, 'cmyk-c': false, 'cmyk-m': false, 'cmyk-y': false };
                      if (isSolo) {
                        // Already soloed — turn all on (composite proof)
                        setCmykLayerVisible('cmyk-k', true);
                        setCmykLayerVisible('cmyk-c', true);
                        setCmykLayerVisible('cmyk-m', true);
                        setCmykLayerVisible('cmyk-y', true);
                      } else {
                        Object.keys(allOff).forEach((k) => setCmykLayerVisible(k, k === id));
                      }
                    }}
                  >
                    <div className="layer-swatch">
                      <div className="layer-swatch-inner" style={{ background: color }} />
                    </div>
                    <div className="layer-card-info">
                      <div className="layer-card-name">{name}</div>
                      <div className="layer-card-sub">{angle}° · {isSolo ? 'halftone plate' : visible ? 'color proof' : 'off'}</div>
                    </div>
                    <div className="layer-card-actions">
                      <button
                        className={`vis-btn ${!visible ? 'hidden-layer' : ''}`}
                        onClick={(e) => { e.stopPropagation(); setCmykLayerVisible(id, !visible); }}
                      >
                        <EyeIcon visible={visible} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Fabric color + bg toggle — still useful in CMYK mode */}
            <FabricSection />

            {/* Background removal — still useful in CMYK mode */}
            <ArtworkSection />
          </>
        ) : (
          <>
            {/* Knockout */}
            <div style={{ padding: '8px 12px 8px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Knockout
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
                  <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#22c55e', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Auto</span>
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                Ink overlap removed
              </div>
            </div>

            {/* Layer cards */}
            <div style={{ padding: '8px 8px 4px' }}>
              {[...layers].reverse().map((layer) => {
                const appliedPattern = layer.useGlobalPattern ? globalPattern.pattern : layer.pattern;
                const patternLabel = appliedPattern === 'none' ? '' : appliedPattern.startsWith('halftone') ? 'halftone' : appliedPattern;
                return (
                <div
                  key={layer.id}
                  className={`layer-card ${selectedLayerId === layer.id ? 'selected' : ''}`}
                  style={{ marginBottom: 4, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}
                  onClick={() => selectLayer(layer.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Primary color swatch */}
                    <div className="layer-swatch" title="Click to change color" style={{ flexShrink: 0 }}>
                      <div className="layer-swatch-inner" style={{ background: layer.color }} />
                      <input
                        type="color"
                        value={layer.color}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { e.stopPropagation(); updateLayer(layer.id, { color: e.target.value }); }}
                      />
                    </div>
                    <div className="layer-card-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="layer-card-name" style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                        {editingLayerId === layer.id ? (
                          <input
                            autoFocus
                            value={editValue}
                            style={{
                              background: 'none', border: 'none',
                              outline: '1px solid var(--accent)',
                              color: 'inherit', fontSize: 'inherit',
                              fontFamily: 'inherit', fontWeight: 'inherit',
                              padding: '0 2px', width: '100%', borderRadius: 2,
                            }}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => commitLayerName(layer.id)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitLayerName(layer.id);
                              if (e.key === 'Escape') { setEditingLayerId(null); setEditValue(''); }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            <span
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setEditingLayerId(layer.id);
                                setEditValue(layer.name);
                              }}
                              title={layer.name}
                              style={{ cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                            >
                              {layer.name}
                            </span>
                            {paintMasks[layer.id] && (
                              <div title="Has paint mask" style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: paintMode !== 'off' ? '#50c878' : 'var(--text-dim)',
                                flexShrink: 0,
                              }} />
                            )}
                          </>
                        )}
                      </div>
                      <div className="layer-card-sub">
                        {layer.thresholdMin}–{layer.thresholdMax}
                        {patternLabel && ` · ${patternLabel}`}
                      </div>
                    </div>
                    <div className="layer-card-actions">
                      {layers.length < 6 && (
                        <button
                          className="vis-btn"
                          title="Duplicate layer — copy range, then erase what you don't want"
                          onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id); }}
                          style={{ color: 'var(--text-dim)', opacity: 0.5 }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.5')}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                          </svg>
                        </button>
                      )}
                      {layers.length > 1 && (
                        <button
                          className="vis-btn"
                          title="Remove layer"
                          onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
                          style={{ color: 'var(--text-dim)', opacity: 0.5 }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.5')}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
                      <button
                        className={`vis-btn ${!layer.visible ? 'hidden-layer' : ''}`}
                        onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                        title={layer.visible ? 'Hide layer' : 'Show layer'}
                      >
                        <EyeIcon visible={layer.visible} />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>

            {/* Add layer button */}
            {layers.length < 6 && (
              <button
                className="btn btn-ghost"
                style={{ width: '100%', height: 28, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', marginTop: 2 }}
                onClick={() => addLayer()}
              >
                + Add Layer
              </button>
            )}

            {/* Auto Palette */}
            {previewImage && (
              <div style={{ padding: '4px 8px 8px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ flex: 1, fontSize: 10, height: 26 }}
                    onClick={handleAutoPalette}
                  >
                    Auto Palette
                  </button>
                  {palettePool.length > 1 && (
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={handleShuffle}
                      title={`Shuffle (${activePaletteIdx + 1}/${palettePool.length})`}
                      style={{ width: 26, height: 26 }}
                    >
                      <ShuffleIcon />
                    </button>
                  )}
                </div>
                {palettePool.length > 0 && (
                  <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                    {palettePool[activePaletteIdx]?.map((c, i) => (
                      <div key={i} style={{ flex: 1, height: 8, background: c, border: '1px solid var(--border-2)', borderRadius: 1 }} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Texture overlay */}
            <TextureSection />

            {/* Fabric color + bg toggle */}
            <FabricSection />

            {/* Background removal (image only) */}
            <ArtworkSection />
          </>
        )}
      </div>

    </aside>
  );
}
