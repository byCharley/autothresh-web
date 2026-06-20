import { create } from 'zustand';
import type { LayerConfig, PatternConfig, ProcessedLayer, ImageAdjustments, SeparationMode } from '../engine/imageProcessor';
import type { TextureType } from '../engine/textureGenerator';

const DEFAULT_IMAGE_ADJ: ImageAdjustments = {
  exposure: 0, contrast: 0, shadows: 0, highlights: 0, blur: 0,
};

const DEFAULT_GLOBAL_PATTERN: PatternConfig = {
  pattern: 'noise',
  patternScale: 1,
  patternAngle: 45,
  patternDensity: 50,
};

const DEFAULT_LAYERS: LayerConfig[] = [
  {
    id: 'shadows', name: 'Shadows', color: '#0A0A0A', visible: true,
    thresholdMin: 0, thresholdMax: 64,
    exposure: 0, blur: 0,
    useGlobalPattern: true,
    pattern: 'noise', patternScale: 1, patternAngle: 45, patternDensity: 80,
  },
  {
    id: 'midtones', name: 'Midtones', color: '#8B1A1A', visible: true,
    thresholdMin: 65, thresholdMax: 140,
    exposure: 0, blur: 0,
    useGlobalPattern: true,
    pattern: 'noise', patternScale: 1, patternAngle: 45, patternDensity: 75,
  },
  {
    id: 'highlights', name: 'Highlights', color: '#FF6B1A', visible: true,
    thresholdMin: 141, thresholdMax: 210,
    exposure: 0, blur: 0,
    useGlobalPattern: true,
    pattern: 'halftone-round', patternScale: 4, patternAngle: 45, patternDensity: 70,
  },
  {
    id: 'specular', name: 'Specular', color: '#F5F0E8', visible: true,
    thresholdMin: 211, thresholdMax: 255,
    exposure: 0, blur: 0,
    useGlobalPattern: true,
    pattern: 'none', patternScale: 1, patternAngle: 0, patternDensity: 60,
  },
];

// Layer order for palette assignment (dark → light)
const PALETTE_LAYER_ORDER = ['shadows', 'midtones', 'highlights', 'specular'];

interface AppState {
  theme: 'dark' | 'light';

  originalImage: ImageData | null;
  previewImage: ImageData | null;
  imageFileName: string;

  layers: LayerConfig[];
  selectedLayerId: string | null;
  knockoutEnabled: boolean;

  globalPattern: PatternConfig;

  bgRemovalEnabled: boolean;
  bgTolerance: number;
  bgMask: Uint8Array | null;

  showRegistrationMarks: boolean;
  regMarkPadding: number;  // inches from document corner to mark center

  textureEnabled: boolean;
  textureType: TextureType;
  textureIntensity: number;
  textureScale: number;
  textureWidth: number;
  textureSeed: number;

  canvasColor: string;
  showFabricBg: boolean;
  documentDpi: number;
  documentWidthIn: number;
  documentHeightIn: number;
  imageAdjustments: ImageAdjustments;

  palettePool: string[][];
  activePaletteIdx: number;

  separationMode: SeparationMode;
  cmykLpi: number;
  cmykVisibility: Record<string, boolean>;

  processedLayers: ProcessedLayer[];
  isProcessing: boolean;

  setTheme: (theme: 'dark' | 'light') => void;
  setOriginalImage: (img: ImageData, preview: ImageData, name: string) => void;
  clearImage: () => void;
  updateLayer: (id: string, updates: Partial<LayerConfig>) => void;
  selectLayer: (id: string | null) => void;
  setKnockoutEnabled: (v: boolean) => void;
  updateGlobalPattern: (updates: Partial<PatternConfig>) => void;
  setBgRemovalEnabled: (v: boolean) => void;
  setBgTolerance: (v: number) => void;
  setBgMask: (mask: Uint8Array | null) => void;
  setShowRegistrationMarks: (v: boolean) => void;
  setRegMarkPadding: (v: number) => void;
  setTextureEnabled: (v: boolean) => void;
  setTextureType: (v: TextureType) => void;
  setTextureIntensity: (v: number) => void;
  setTextureScale: (v: number) => void;
  setTextureWidth: (v: number) => void;
  setTextureSeed: (v: number) => void;

  setCanvasColor: (color: string) => void;
  setShowFabricBg: (v: boolean) => void;
  setDocumentDpi: (dpi: number) => void;
  setDocumentWidth: (v: number) => void;
  setDocumentHeight: (v: number) => void;
  setImageAdjustment: (key: keyof ImageAdjustments, value: number) => void;
  resetImageAdjustments: () => void;
  setPalettePool: (palettes: string[][]) => void;
  applyPalette: (idx: number) => void;
  setSeparationMode: (v: SeparationMode) => void;
  setCmykLpi: (v: number) => void;
  setCmykLayerVisible: (id: string, v: boolean) => void;

  setProcessedLayers: (layers: ProcessedLayer[]) => void;
  setIsProcessing: (v: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  theme: (localStorage.getItem('at-theme') as 'dark' | 'light') ?? 'dark',
  originalImage: null,
  previewImage: null,
  imageFileName: '',
  layers: DEFAULT_LAYERS,
  selectedLayerId: 'shadows',
  knockoutEnabled: true,
  globalPattern: DEFAULT_GLOBAL_PATTERN,
  bgRemovalEnabled: true,
  bgTolerance: 30,
  bgMask: null,
  showRegistrationMarks: false,
  regMarkPadding: 0.5,
  textureEnabled: false,
  textureType: 'plastisol-crack' as TextureType,
  textureIntensity: 40,
  textureScale: 1,
  textureWidth: 2,
  textureSeed: 42,

  canvasColor: '#ffffff',
  showFabricBg: true,
  documentDpi: 300,
  documentWidthIn: 12,
  documentHeightIn: 14,
  imageAdjustments: { ...DEFAULT_IMAGE_ADJ },
  palettePool: [],
  activePaletteIdx: 0,
  separationMode: 'threshold',
  cmykLpi: 45,
  cmykVisibility: { 'cmyk-k': true, 'cmyk-c': true, 'cmyk-m': true, 'cmyk-y': true },

  processedLayers: [],
  isProcessing: false,

  setTheme: (theme) => { localStorage.setItem('at-theme', theme); set({ theme }); },
  setOriginalImage: (originalImage, previewImage, imageFileName) =>
    set({ originalImage, previewImage, imageFileName, bgMask: null, palettePool: [], activePaletteIdx: 0 }),
  clearImage: () =>
    set({ originalImage: null, previewImage: null, processedLayers: [], imageFileName: '', bgMask: null, palettePool: [], activePaletteIdx: 0 }),
  updateLayer: (id, updates) =>
    set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)) })),
  selectLayer: (selectedLayerId) => set({ selectedLayerId }),
  setKnockoutEnabled: (knockoutEnabled) => set({ knockoutEnabled }),
  updateGlobalPattern: (updates) =>
    set((s) => ({ globalPattern: { ...s.globalPattern, ...updates } })),
  setBgRemovalEnabled: (bgRemovalEnabled) => set({ bgRemovalEnabled }),
  setBgTolerance: (bgTolerance) => set({ bgTolerance }),
  setBgMask: (bgMask) => set({ bgMask }),
  setShowRegistrationMarks: (showRegistrationMarks) => set({ showRegistrationMarks }),
  setRegMarkPadding: (regMarkPadding) => set({ regMarkPadding: Math.max(0.1, Math.min(3, regMarkPadding)) }),
  setTextureEnabled:   (textureEnabled)   => set({ textureEnabled }),
  setTextureType:      (textureType)      => set({ textureType }),
  setTextureIntensity: (textureIntensity) => set({ textureIntensity }),
  setTextureScale:     (textureScale)     => set({ textureScale }),
  setTextureWidth:     (textureWidth)     => set({ textureWidth }),
  setTextureSeed:      (textureSeed)      => set({ textureSeed }),

  setCanvasColor: (canvasColor) => set({ canvasColor }),
  setShowFabricBg: (showFabricBg) => set({ showFabricBg }),
  setDocumentDpi: (documentDpi) => set({ documentDpi }),
  setDocumentWidth: (documentWidthIn) => set({ documentWidthIn: Math.max(0.5, documentWidthIn) }),
  setDocumentHeight: (documentHeightIn) => set({ documentHeightIn: Math.max(0.5, documentHeightIn) }),
  setImageAdjustment: (key, value) =>
    set((s) => ({ imageAdjustments: { ...s.imageAdjustments, [key]: value } })),
  resetImageAdjustments: () => set({ imageAdjustments: { ...DEFAULT_IMAGE_ADJ } }),
  setPalettePool: (palettePool) => set({ palettePool }),
  applyPalette: (idx) => set((s) => {
    const palette = s.palettePool[idx];
    if (!palette || palette.length < 4) return { activePaletteIdx: idx };
    const updatedLayers = s.layers.map((l) => {
      const pi = PALETTE_LAYER_ORDER.indexOf(l.id);
      return pi >= 0 ? { ...l, color: palette[pi] } : l;
    });
    return { layers: updatedLayers, activePaletteIdx: idx };
  }),
  setSeparationMode: (separationMode) => set({ separationMode }),
  setCmykLpi: (cmykLpi) => set({ cmykLpi }),
  setCmykLayerVisible: (id, v) => set((s) => ({ cmykVisibility: { ...s.cmykVisibility, [id]: v } })),

  setProcessedLayers: (processedLayers) => set({ processedLayers }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
}));
