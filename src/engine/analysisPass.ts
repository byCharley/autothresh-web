// Importance map: Sobel edge detection + local variance (integral images) → [0,1] per pixel.
// High values mark edges and fine detail that all three engines use for adaptive processing.

export function buildImportanceMap(
  imageData: ImageData,
  bgMask: Uint8Array | null,
): Float32Array {
  const { data, width: w, height: h } = imageData;
  const n = w * h;

  // Luminance pass
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  // Sobel edge detection
  const edge = new Float32Array(n);
  let maxEdge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[(y - 1) * w + (x - 1)] - 2 * lum[y * w + (x - 1)] - lum[(y + 1) * w + (x - 1)]
        + lum[(y - 1) * w + (x + 1)] + 2 * lum[y * w + (x + 1)] + lum[(y + 1) * w + (x + 1)];
      const gy =
        -lum[(y - 1) * w + (x - 1)] - 2 * lum[(y - 1) * w + x] - lum[(y - 1) * w + (x + 1)]
        + lum[(y + 1) * w + (x - 1)] + 2 * lum[(y + 1) * w + x] + lum[(y + 1) * w + (x + 1)];
      edge[i] = Math.sqrt(gx * gx + gy * gy);
      if (edge[i] > maxEdge) maxEdge = edge[i];
    }
  }
  if (maxEdge > 0) {
    const inv = 1 / maxEdge;
    for (let i = 0; i < n; i++) edge[i] *= inv;
  }

  // Local variance via integral images (9×9 window, radius=4)
  // O(n) build, O(1) per window query.
  const VAR_R = 4;
  const W1 = w + 1;
  const intS  = new Float64Array(W1 * (h + 1));
  const intS2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      const p = (y + 1) * W1 + (x + 1);
      intS[p]  = v     + intS[y * W1 + (x + 1)] + intS[(y + 1) * W1 + x] - intS[y * W1 + x];
      intS2[p] = v * v + intS2[y * W1 + (x + 1)] + intS2[(y + 1) * W1 + x] - intS2[y * W1 + x];
    }
  }

  const varMap = new Float32Array(n);
  let maxVar = 0;
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - VAR_R), y2 = Math.min(h - 1, y + VAR_R);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - VAR_R), x2 = Math.min(w - 1, x + VAR_R);
      const cnt = (y2 - y1 + 1) * (x2 - x1 + 1);
      const s  = intS[(y2 + 1) * W1 + (x2 + 1)]  - intS[y1 * W1 + (x2 + 1)]  - intS[(y2 + 1) * W1 + x1]  + intS[y1 * W1 + x1];
      const s2 = intS2[(y2 + 1) * W1 + (x2 + 1)] - intS2[y1 * W1 + (x2 + 1)] - intS2[(y2 + 1) * W1 + x1] + intS2[y1 * W1 + x1];
      const variance = s2 / cnt - (s / cnt) * (s / cnt);
      varMap[y * w + x] = Math.max(0, variance);
      if (variance > maxVar) maxVar = variance;
    }
  }
  if (maxVar > 0) {
    const sqrtMax = Math.sqrt(maxVar);
    for (let i = 0; i < n; i++) varMap[i] = Math.sqrt(varMap[i]) / sqrtMax;
  }

  // Combine: max of edge and variance signals; zero out background pixels
  const imp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    imp[i] = bgMask && bgMask[i] === 255 ? 0 : Math.min(1, Math.max(edge[i], varMap[i]));
  }
  return imp;
}
