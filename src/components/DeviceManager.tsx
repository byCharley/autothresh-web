import { useEffect, useState } from 'react';
import { getDeviceId } from '../lib/deviceId';

export interface LicenseDevice {
  id: string;
  device_id: string;
  device_name: string;
  last_seen_at: string;
  created_at: string;
  isCurrent?: boolean;
}

function fmtWhen(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Props {
  token: string;
  devices?: LicenseDevice[];
  currentDeviceId?: string;
  message?: string;
  onActivated?: () => Promise<boolean> | boolean | void;
}

export function DeviceManager({ token, devices: initial, currentDeviceId, message, onActivated }: Props) {
  const [devices, setDevices] = useState<LicenseDevice[]>(initial ?? []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const thisDevice = currentDeviceId || getDeviceId();

  useEffect(() => {
    if (initial?.length) setDevices(initial);
  }, [initial]);

  useEffect(() => {
    if (initial?.length || !token) return;
    fetch('/api/license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'devices', token, deviceId: thisDevice }),
    })
      .then(r => r.json() as Promise<{ devices?: LicenseDevice[] }>)
      .then(data => { if (data.devices) setDevices(data.devices); })
      .catch(() => {});
  }, [token, thisDevice, initial?.length]);

  const remove = async (deviceId: string) => {
    setBusyId(deviceId);
    setError('');
    try {
      const r = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', token, deviceId: thisDevice, removeDeviceId: deviceId }),
      });
      const data = await r.json() as { ok?: boolean; devices?: LicenseDevice[]; error?: string };
      if (data.devices) setDevices(data.devices);
      if (!data.ok && data.error) setError(data.error);
      await onActivated?.();
    } catch {
      setError('Could not remove that device. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 16 }}>
        {message || 'Each license can be active on 2 devices. Remove one here to free a slot.'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {devices.length === 0 && (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
            No devices registered yet.
          </div>
        )}
        {devices.map(d => {
          const current = d.isCurrent || d.device_id === thisDevice;
          return (
            <div
              key={d.device_id || d.id}
              style={{
                border: `1px solid ${current ? 'var(--accent)' : 'var(--border)'}`,
                padding: '12px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {d.device_name || 'Device'}{current ? ' · this device' : ''}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  Last used {fmtWhen(d.last_seen_at) || 'recently'}
                </div>
              </div>
              <button
                onClick={() => void remove(d.device_id)}
                disabled={busyId === d.device_id}
                style={{
                  flexShrink: 0,
                  background: 'none',
                  border: '1px solid var(--border)',
                  color: '#f87171',
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  padding: '6px 10px',
                  cursor: busyId === d.device_id ? 'default' : 'pointer',
                  opacity: busyId === d.device_id ? 0.5 : 1,
                }}
              >
                {busyId === d.device_id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          );
        })}
      </div>
      {error && (
        <div style={{ marginTop: 12, fontSize: 11, color: '#f87171', fontFamily: 'var(--font-mono)' }}>{error}</div>
      )}
    </div>
  );
}
