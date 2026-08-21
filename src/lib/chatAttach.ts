const IMAGE_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif',
]);

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  tif: 'image/tiff', tiff: 'image/tiff',
  psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript',
};

const MAX_DIRECT_BYTES = 2.5 * 1024 * 1024; // stay under Vercel ~4.5 MB JSON body
const MAX_EDGE = 1600;

export function inferMime(file: File): string {
  const raw = (file.type || '').toLowerCase();
  if (raw === 'image/jpg') return 'image/jpeg';
  if (raw && raw !== 'application/octet-stream') return raw;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? '';
}

export function isDisplayImage(mime: string): boolean {
  return IMAGE_MIME.has(mime) && mime !== 'image/heic' && mime !== 'image/heif';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function compressImage(file: File, mime: string): Promise<{ blob: Blob; mimeType: string }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Safari HEIC / odd types: try HTMLImageElement
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not read this image. Try exporting as JPG or PNG.'));
        el.src = url;
      });
      return drawToJpeg(img.naturalWidth, img.naturalHeight, (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  try {
    const keepPng = mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif';
    return drawToJpeg(bitmap.width, bitmap.height, (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h), keepPng && file.size < MAX_DIRECT_BYTES);
  } finally {
    bitmap.close();
  }
}

function drawToJpeg(
  srcW: number,
  srcH: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  preferPng = false,
): Promise<{ blob: Blob; mimeType: string }> {
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH, 1));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not process image.'));
  draw(ctx, w, h);
  const mime = preferPng ? 'image/png' : 'image/jpeg';
  const quality = preferPng ? undefined : 0.82;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Could not process image.')); return; }
      resolve({ blob, mimeType: mime });
    }, mime, quality);
  });
}

export async function uploadChatAttachment(opts: {
  file: File;
  ticketId: string;
  headers: Record<string, string>;
}): Promise<{ url: string; isImage: boolean; fileName: string }> {
  const mime = inferMime(opts.file);
  if (!mime) throw new Error('Unsupported file type. Use JPG, PNG, GIF, WebP, TIFF, PSD, or AI.');

  const raster = IMAGE_MIME.has(mime);
  let uploadBlob: Blob = opts.file;
  let uploadMime = mime;

  if (raster) {
    try {
      const compressed = await compressImage(opts.file, mime);
      uploadBlob = compressed.blob;
      uploadMime = compressed.mimeType;
    } catch (err) {
      if (mime === 'image/heic' || mime === 'image/heif') {
        throw err instanceof Error ? err : new Error('Could not read this photo. Save it as JPG and try again.');
      }
      // Fall through with the original if compression isn't needed/possible
      if (opts.file.size > MAX_DIRECT_BYTES) throw new Error('Image is too large. Try a smaller JPG or PNG.');
    }
  }

  if (uploadBlob.size > MAX_DIRECT_BYTES) {
    const signed = await fetch('/api/chat-upload', {
      method: 'POST',
      headers: opts.headers,
      body: JSON.stringify({
        action: 'sign',
        mimeType: uploadMime,
        ticketId: opts.ticketId,
        fileName: opts.file.name,
      }),
    });
    const signedData = await signed.json() as { uploadUrl?: string; publicUrl?: string; error?: string };
    if (!signed.ok || !signedData.uploadUrl || !signedData.publicUrl) {
      throw new Error(signedData.error || 'Upload failed. File may be too large.');
    }
    const put = await fetch(signedData.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': uploadMime, 'x-upsert': 'true' },
      body: uploadBlob,
    });
    if (!put.ok) throw new Error('Upload failed. Try a smaller file or a JPG/PNG.');
    return { url: signedData.publicUrl, isImage: isDisplayImage(uploadMime), fileName: opts.file.name };
  }

  const base64 = await blobToBase64(uploadBlob);
  const r = await fetch('/api/chat-upload', {
    method: 'POST',
    headers: opts.headers,
    body: JSON.stringify({ imageData: base64, mimeType: uploadMime, ticketId: opts.ticketId }),
  });
  const data = await r.json() as { url?: string; error?: string };
  if (!r.ok || !data.url) throw new Error(data.error || 'Upload failed.');
  return { url: data.url, isImage: isDisplayImage(uploadMime), fileName: opts.file.name };
}
