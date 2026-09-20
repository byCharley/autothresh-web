export async function getBrowserFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(',') ?? '',
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(screen.availWidth),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(navigator.hardwareConcurrency || 0),
    navigator.platform || '',
    String(navigator.maxTouchPoints || 0),
  ];
  try {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 40;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 220, 40);
      ctx.fillStyle = '#069';
      ctx.fillText('AutoThresh Web', 4, 12);
      parts.push(c.toDataURL());
    }
  } catch { /* ignore */ }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
