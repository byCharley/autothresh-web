// Module-level cache shared between the overlay picker and CanvasView.
// Preloading on hover means the image is often already decoded by the time
// the user clicks "add", and CanvasView avoids a redundant network request.

const _cache = new Map<string, HTMLImageElement>();

export function preloadOverlay(path: string): void {
  if (_cache.has(path)) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload  = () => _cache.set(path, img);
  img.onerror = () => {};
  img.src = path;
}

export function getCachedOverlay(path: string): HTMLImageElement | undefined {
  return _cache.get(path);
}

export function setCachedOverlay(path: string, img: HTMLImageElement): void {
  _cache.set(path, img);
}
