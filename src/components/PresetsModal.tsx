import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import type { PresetData } from '../store/useStore';

type PresetMode = 'threshold' | 'palette' | 'color-sep';

interface SavedPreset {
  id: string;
  name: string;
  data: PresetData;
  created_at: string;
  updated_at: string;
}

interface Props {
  token: string;
  onClose: () => void;
}

export function PresetsModal({ token, onClose }: Props) {
  const { loadPreset, capturePreset, separationMode } = useStore();

  const [presets, setPresets]           = useState<SavedPreset[]>([]);
  const [loading, setLoading]           = useState(true);
  const [apiAvailable, setApiAvailable] = useState(true);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState('');
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [newName, setNewName]           = useState('');
  const [loadedId, setLoadedId]         = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<PresetMode>(() => {
    if (separationMode === 'palette')   return 'palette';
    if (separationMode === 'color-sep') return 'color-sep';
    return 'threshold';
  });

  useEffect(() => { fetchPresets(); }, []);

  async function fetchPresets() {
    setLoading(true);
    try {
      const r = await fetch('/api/presets', { headers: { Authorization: token } });
      if (!r.ok) throw new Error('not ok');
      setPresets(await r.json());
      setApiAvailable(true);
    } catch {
      setApiAvailable(false);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!newName.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      const data = capturePreset();
      const r = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({ name: newName.trim(), data }),
      });
      if (!r.ok) throw new Error('Failed to save preset');
      const saved = await r.json() as SavedPreset;
      setPresets((prev) => [{ ...saved, data }, ...prev]);
      setNewName('');
      setApiAvailable(true);
    } catch {
      setSaveError('Could not save. Make sure you\'re connected and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/presets?id=${id}`, { method: 'DELETE', headers: { Authorization: token } });
      if (!r.ok) throw new Error('Delete failed');
      setPresets((prev) => prev.filter((p) => p.id !== id));
      if (loadedId === id) setLoadedId(null);
    } catch {
      // leave preset in list if delete failed
    } finally {
      setDeletingId(null);
    }
  }

  function handleLoad(preset: SavedPreset) {
    loadPreset(preset.data);
    setLoadedId(preset.id);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getPresetMode(data: PresetData): PresetMode {
    const m = data.separationMode ?? data.mode;
    if (m === 'palette')   return 'palette';
    if (m === 'color-sep') return 'color-sep';
    return 'threshold';
  }

  const tabPresets = presets.filter((p) => getPresetMode(p.data) === activeTab);
  const isEmpty = !loading && tabPresets.length === 0;

  const TAB_LABELS: Record<PresetMode, string> = {
    threshold:   'Threshold',
    palette:     'Dither',
    'color-sep': 'Color',
  };

  const MODE_DESCRIPTIONS: Record<PresetMode, string> = {
    threshold:   'Saves layers, colors, thresholds, patterns, texture, and document settings.',
    palette:     'Saves dither style, ink colors, scale, color mode, and image adjustments.',
    'color-sep': 'Saves color count, priority, pattern, locked colors, and image adjustments.',
  };

  const currentModeLabel: Record<string, string> = {
    threshold: 'Threshold', palette: 'Dither', 'color-sep': 'Color', vector: 'Vector',
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          width: 680, maxWidth: '94vw', maxHeight: '80vh',
          display: 'flex', flexDirection: 'column', zIndex: 51,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', height: 44, borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
            My Presets
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Left: saved presets list */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

            {/* Mode tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {(['threshold', 'palette', 'color-sep'] as PresetMode[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, height: 36, fontSize: 10, fontFamily: 'var(--font-mono)',
                    fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                    cursor: 'pointer', border: 'none',
                    borderBottom: `2px solid ${activeTab === tab ? 'var(--accent)' : 'transparent'}`,
                    background: activeTab === tab ? 'var(--accent-dim)' : 'transparent',
                    color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                    transition: 'all 0.15s',
                  }}
                >
                  {TAB_LABELS[tab]}
                  {!loading && (
                    <span style={{
                      marginLeft: 6, fontSize: 9, opacity: 0.6,
                      background: activeTab === tab ? 'var(--accent)' : 'var(--surface-2)',
                      color: activeTab === tab ? '#000' : 'var(--text-dim)',
                      padding: '1px 5px', borderRadius: 3,
                    }}>
                      {presets.filter((p) => getPresetMode(p.data) === tab).length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {loading ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>Loading…</span>
              </div>
            ) : isEmpty ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, textAlign: 'center' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-dim)', opacity: 0.4 }}>
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', fontWeight: 600 }}>
                  No {TAB_LABELS[activeTab]} presets saved yet
                </div>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.7, maxWidth: 220 }}>
                  {apiAvailable
                    ? `Switch to ${TAB_LABELS[activeTab]} mode, set up your settings, then save a preset from the right panel.`
                    : 'Save a preset to get started. Your settings will sync to your account once connected.'}
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: '8px 14px 6px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
                  {TAB_LABELS[activeTab]} Presets ({tabPresets.length})
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
                  {tabPresets.map((preset) => {
                    const isLoaded = loadedId === preset.id;
                    return (
                      <div
                        key={preset.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 10px', marginBottom: 2,
                          borderLeft: `2px solid ${isLoaded ? 'var(--accent)' : 'transparent'}`,
                          background: isLoaded ? 'var(--accent-dim)' : 'transparent',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: isLoaded ? 'var(--accent)' : 'var(--text)', fontWeight: isLoaded ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {preset.name}
                            </span>
                          </div>
                          <div style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginTop: 2 }}>
                            {formatDate(preset.updated_at)}
                          </div>
                        </div>
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleLoad(preset)}
                          style={{ fontSize: 10, fontFamily: 'var(--font-mono)', height: 24, padding: '0 10px', flexShrink: 0, color: isLoaded ? 'var(--accent)' : undefined }}
                        >
                          {isLoaded ? '✓ Loaded' : 'Load'}
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          onClick={() => handleDelete(preset.id)}
                          disabled={deletingId === preset.id}
                          title="Delete preset"
                          style={{ opacity: deletingId === preset.id ? 0.3 : 0.5, flexShrink: 0 }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = deletingId === preset.id ? '0.3' : '0.5')}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Right: save form */}
          <div style={{ width: 240, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Save Current Settings
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 8px', background: 'var(--surface-2)',
              border: '1px solid var(--border)', alignSelf: 'flex-start',
            }}>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Mode:
              </span>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {currentModeLabel[separationMode] ?? separationMode}
              </span>
            </div>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', lineHeight: 1.7 }}>
              {MODE_DESCRIPTIONS[separationMode as PresetMode] ?? 'Saves current mode settings.'}
            </div>
            <input
              type="text"
              placeholder="e.g. Knight's Tale Setup"
              value={newName}
              maxLength={60}
              autoFocus
              onChange={(e) => { setNewName(e.target.value); setSaveError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 11,
                padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!newName.trim() || saving}
              style={{ width: '100%', height: 32, opacity: newName.trim() && !saving ? 1 : 0.4, color: '#1a1a1a', fontSize: 11, fontFamily: 'var(--font-mono)', gap: 6 }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              {saving ? 'Saving…' : 'Save Preset'}
            </button>

            {saveError && (
              <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#e05c5c', lineHeight: 1.5 }}>
                {saveError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
