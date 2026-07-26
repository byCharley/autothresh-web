// Web Worker: DTG halftone computation
// Receives scaled ImageData from the main thread, runs applyDtgHalftone +
// halftoneDownsample (both pure TypedArray math, no DOM), returns the
// downsampled result. Runs off the main thread so the UI stays responsive
// while the halftone is computing.

import { applyDtgHalftone, halftoneDownsample } from './dtgEngine';
import type { DtgSettings } from './dtgEngine';

export interface DtgWorkerRequest {
  id: number;
  pixels: ArrayBuffer;   // Uint8ClampedArray data (transferred, not copied)
  width: number;
  height: number;
  settings: DtgSettings;
  dpi: number;
  targetW: number;       // output dimensions after downsampling
  targetH: number;
}

export interface DtgWorkerResponse {
  id: number;
  pixels: ArrayBuffer;   // downsampled result (transferred back)
  width: number;
  height: number;
}

self.onmessage = (e: MessageEvent<DtgWorkerRequest>) => {
  const { id, pixels, width, height, settings, dpi, targetW, targetH } = e.data;

  // Reconstruct ImageData from transferred buffer
  const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

  // Halftone computation (expensive — this is why we're in a worker)
  const high = applyDtgHalftone(imageData, settings, null, dpi);

  // Binary-preserving downsample back to preview resolution (keeps dot edges crisp)
  const down = halftoneDownsample(high, targetW, targetH);

  // Transfer result buffer back (zero-copy)
  (self as unknown as Worker).postMessage(
    { id, pixels: down.data.buffer, width: down.width, height: down.height } satisfies DtgWorkerResponse,
    [down.data.buffer],
  );
};
