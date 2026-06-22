import { create } from 'zustand';
import type { LayerConfig, PatternConfig, ProcessedLayer, ImageAdjustments, SeparationMode } from '../engine/imageProcessor';
import { DEFAULT_CMYK_ANGLES } from '../engine/imageProcessor';
import type { TextureType } from '../engine/textureGenerator';

export interface PresetData {
  layers: LayerConfig[];
  globalPattern: PatternConfig;
  knockoutEnabled: boolean;
  bgRemovalEnabled: boolean;
  bgTolerance: number;
  textureEnabled: boolean;
  textureType: TextureType;
  textureIntensity: number;
  textureScale: number;
  textureWidth: number;
  textureSeed: number;
  canvasColor: string;
  documentDpi: number;
  documentWidthIn: number;
  documentHeightIn: number;
  imageAdjustments: ImageAdjustments;
  separationMode: SeparationMode;
}

const DEFAULT_IMAGE_ADJ: ImageAdjustments = {
  exposure: 0, contrast: 0, shadows: 0, highlights: 0, blur: 0,
};

function redistributeThresholds(layers: LayerConfig[]): LayerConfig[] {
  const n = layers.length;
  return layers.map((l, i) => ({
    ...l,
    thresholdMin: i === 0 ? 0 : Math.floor(i * 256 / n),
    thresholdMax: i === n - 1 ? 255 : Math.floor((i + 1) * 256 / n) - 1,
  }));
}

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

  paintMasks: Record<string, Uint8Array | null>;
  paintMode: 'off' | 'paint' | 'erase';
  brushSize: number;

  separationMode: SeparationMode;
  cmykLpi: number;
  cmykVisibility: Record<string, boolean>;
  cmykAngles: Record<string, number>;

  processedLayers: ProcessedLayer[];
  processedLayerDims: { w: number; h: number } | null;
  isProcessing: boolean;
  soloLayerId: string | null;
  mockupOpen: boolean;

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

  addLayer: () => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  setPaintMask: (layerId: string, mask: Uint8Array | null) => void;
  clearPaintMask: (layerId: string) => void;
  setPaintMode: (mode: 'off' | 'paint' | 'erase') => void;
  setBrushSize: (size: number) => void;

  setSeparationMode: (v: SeparationMode) => void;
  setCmykLpi: (v: number) => void;
  setCmykLayerVisible: (id: string, v: boolean) => void;
  setCmykAngle: (id: string, angle: number) => void;

  setProcessedLayers: (layers: ProcessedLayer[]) => void;
  setProcessedLayerDims: (dims: { w: number; h: number } | null) => void;
  setIsProcessing: (v: boolean) => void;
  setSoloLayerId: (id: string | null) => void;
  setMockupOpen: (v: boolean) => void;
  presetsOpen: boolean;
  setPresetsOpen: (v: boolean) => void;
  loadPreset: (data: PresetData) => void;
  capturePreset: () => PresetData;
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
  paintMasks: {},
  paintMode: 'off',
  brushSize: 20,
  separationMode: 'threshold',
  cmykLpi: 65,
  cmykVisibility: { 'cmyk-k': true, 'cmyk-c': false, 'cmyk-m': false, 'cmyk-y': false },
  cmykAngles: { ...DEFAULT_CMYK_ANGLES },

  processedLayers: [],
  processedLayerDims: null,
  isProcessing: false,
  soloLayerId: null,
  mockupOpen: false,
  presetsOpen: false,

  setTheme: (theme) => { localStorage.setItem('at-theme', theme); set({ theme }); },
  setOriginalImage: (originalImage, previewImage, imageFileName) =>
    set({ originalImage, previewImage, imageFileName, bgMask: null, palettePool: [], activePaletteIdx: 0 }),
  clearImage: () =>
    set({ originalImage: null, previewImage: null, processedLayers: [], imageFileName: '', bgMask: null, palettePool: [], activePaletteIdx: 0, paintMasks: {} }),
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
    if (!palette || palette.length === 0) return { activePaletteIdx: idx };
    const updatedLayers = s.layers.map((l, i) => ({
      ...l,
      color: i < palette.length ? palette[i] : l.color,
    }));
    return { layers: updatedLayers, activePaletteIdx: idx };
  }),
  addLayer: () => set((s) => {
    if (s.layers.length >= 6) return s;
    const DEFAULT_NEW_COLORS = ['#1A3A5C', '#6B4C9A', '#C84B1E', '#2A8C5A', '#E8C520', '#C84880'];
    const newLayer: LayerConfig = {
      id: `layer-${Date.now()}`,
      name: `Layer ${s.layers.length + 1}`,
      color: DEFAULT_NEW_COLORS[s.layers.length % DEFAULT_NEW_COLORS.length],
      visible: true,
      thresholdMin: 0, thresholdMax: 0,
      exposure: 0, blur: 0,
      useGlobalPattern: true,
      pattern: 'halftone-round', patternScale: 4, patternAngle: 45, patternDensity: 70,
    };
    // Insert immediately above the selected layer so the new layer occupies
    // the right knockout position: layers above it still knock it out, and it
    // knocks out layers below it. Without a selection, append at the top.
    const selIdx = s.selectedLayerId
      ? s.layers.findIndex((l) => l.id === s.selectedLayerId)
      : -1;
    const insertAt = selIdx >= 0 ? selIdx + 1 : s.layers.length;
    const newLayers = [
      ...s.layers.slice(0, insertAt),
      newLayer,
      ...s.layers.slice(insertAt),
    ];
    return { layers: newLayers, selectedLayerId: newLayer.id };
  }),
  removeLayer: (id) => set((s) => {
    if (s.layers.length <= 1) return s;
    const newLayers = s.layers.filter((l) => l.id !== id);
    const { [id]: _removed, ...remainingMasks } = s.paintMasks;
    return {
      layers: redistributeThresholds(newLayers),
      paintMasks: remainingMasks,
      selectedLayerId: s.selectedLayerId === id
        ? (newLayers[newLayers.length - 1]?.id ?? null)
        : s.selectedLayerId,
    };
  }),
  duplicateLayer: (id) => set((s) => {
    if (s.layers.length >= 6) return s;
    const src = s.layers.find((l) => l.id === id);
    if (!src) return s;
    // Numbered naming: "Shadows" → "Shadows 01", "Shadows 01" → "Shadows 02"
    const stemMatch = src.name.match(/^(.*?)\s+(\d+)$/);
    const stem = stemMatch ? stemMatch[1] : src.name;
    const stemEsc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${stemEsc}\\s+(\\d+)$`);
    const usedNums = s.layers
      .map(l => { const m = l.name.match(re); return m ? parseInt(m[1], 10) : null; })
      .filter((n): n is number => n !== null);
    const nextNum = usedNums.length === 0 ? 1 : Math.max(...usedNums) + 1;
    const newName = `${stem} ${String(nextNum).padStart(2, '0')}`;
    const copy: typeof src = { ...src, id: `layer-${Date.now()}`, name: newName };
    const idx = s.layers.indexOf(src);
    return {
      layers: [...s.layers.slice(0, idx + 1), copy, ...s.layers.slice(idx + 1)],
      selectedLayerId: copy.id,
    };
  }),
  setPaintMask: (layerId, mask) => set((s) => ({ paintMasks: { ...s.paintMasks, [layerId]: mask } })),
  clearPaintMask: (layerId) => set((s) => ({ paintMasks: { ...s.paintMasks, [layerId]: null } })),
  setPaintMode: (paintMode) => set({ paintMode }),
  setBrushSize: (brushSize) => set({ brushSize: Math.max(2, Math.min(120, brushSize)) }),
  setSeparationMode: (separationMode) => set((s) => ({
    separationMode,
    // Reset to K-only plate view each time CMYK mode is entered
    cmykVisibility: separationMode === 'cmyk'
      ? { 'cmyk-k': true, 'cmyk-c': false, 'cmyk-m': false, 'cmyk-y': false }
      : s.cmykVisibility,
  })),
  setCmykLpi: (cmykLpi) => set({ cmykLpi }),
  setCmykLayerVisible: (id, v) => set((s) => ({ cmykVisibility: { ...s.cmykVisibility, [id]: v } })),
  setCmykAngle: (id, angle) => set((s) => ({ cmykAngles: { ...s.cmykAngles, [id]: Math.max(0, Math.min(180, angle)) } })),

  setProcessedLayers: (processedLayers) => set({ processedLayers }),
  setProcessedLayerDims: (processedLayerDims) => set({ processedLayerDims }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setSoloLayerId: (soloLayerId) => set({ soloLayerId }),
  setMockupOpen: (mockupOpen) => set({ mockupOpen }),
  setPresetsOpen: (presetsOpen) => set({ presetsOpen }),
  loadPreset: (data) => set({
    layers:           data.layers,
    globalPattern:    data.globalPattern,
    knockoutEnabled:  data.knockoutEnabled,
    bgRemovalEnabled: data.bgRemovalEnabled,
    bgTolerance:      data.bgTolerance,
    textureEnabled:   data.textureEnabled,
    textureType:      data.textureType,
    textureIntensity: data.textureIntensity,
    textureScale:     data.textureScale,
    textureWidth:     data.textureWidth,
    textureSeed:      data.textureSeed,
    canvasColor:      data.canvasColor,
    documentDpi:      data.documentDpi,
    documentWidthIn:  data.documentWidthIn,
    documentHeightIn: data.documentHeightIn,
    imageAdjustments: data.imageAdjustments,
    separationMode:   data.separationMode,
  }),
  capturePreset: () => {
    const s = useStore.getState();
    return {
      layers:           s.layers,
      globalPattern:    s.globalPattern,
      knockoutEnabled:  s.knockoutEnabled,
      bgRemovalEnabled: s.bgRemovalEnabled,
      bgTolerance:      s.bgTolerance,
      textureEnabled:   s.textureEnabled,
      textureType:      s.textureType,
      textureIntensity: s.textureIntensity,
      textureScale:     s.textureScale,
      textureWidth:     s.textureWidth,
      textureSeed:      s.textureSeed,
      canvasColor:      s.canvasColor,
      documentDpi:      s.documentDpi,
      documentWidthIn:  s.documentWidthIn,
      documentHeightIn: s.documentHeightIn,
      imageAdjustments: s.imageAdjustments,
      separationMode:   s.separationMode,
    };
  },
}));
