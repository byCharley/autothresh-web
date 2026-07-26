// AI background removal worker using RMBG-1.4 via Transformers.js
// Runs entirely in the browser — no server calls, no privacy leaks.
// First invocation downloads ~170MB model, cached in browser storage after that.

import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers';

// Disable proxy so the worker fetches directly (no SharedArrayBuffer dependency)
env.backends.onnx.wasm.proxy = false;

type InMsg =
  | { type: 'run'; imageData: ImageData }
  | { type: 'cancel' };

type OutMsg =
  | { type: 'progress'; progress: number; stage: string }
  | { type: 'complete'; mask: Float32Array; width: number; height: number }
  | { type: 'error'; error: string };

// Singleton model/processor — loaded once, reused for subsequent calls
let processor: InstanceType<typeof AutoProcessor> | null = null;
let model: InstanceType<typeof AutoModel> | null = null;

function send(msg: OutMsg, transfer?: Transferable[]) {
  if (transfer) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

const progressCallback = (p: { status: string; progress?: number; name?: string }) => {
  if (p.status === 'downloading' || p.status === 'initiate') {
    send({ type: 'progress', progress: (p.progress ?? 0) / 100, stage: `Downloading model${p.name ? ` (${p.name})` : ''}…` });
  } else if (p.status === 'loading') {
    send({ type: 'progress', progress: 0.9, stage: 'Loading model into memory…' });
  }
};

async function ensureModel() {
  if (model && processor) return;

  send({ type: 'progress', progress: 0, stage: 'Starting AI model download…' });

  processor = await AutoProcessor.from_pretrained('briaai/RMBG-1.4', {
    // Override config so Transformers.js handles RMBG-1.4's custom preprocessing
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      feature_extractor_type: 'ImageFeatureExtractor',
      image_std: [1.0, 1.0, 1.0],
      resample: 2,
      rescale_factor: 0.00392156862745098,
      size: { width: 1024, height: 1024 },
    },
    progress_callback: progressCallback,
  } as Parameters<typeof AutoProcessor.from_pretrained>[1]);

  model = await AutoModel.from_pretrained('briaai/RMBG-1.4', {
    config: { model_type: 'custom' },
    progress_callback: progressCallback,
  } as Parameters<typeof AutoModel.from_pretrained>[1]);
}

async function runInference(imageData: ImageData): Promise<void> {
  await ensureModel();

  send({ type: 'progress', progress: 0.92, stage: 'Analyzing image…' });

  // Build a RawImage from the ImageData pixel buffer (RGBA → RGB)
  const { width: w, height: h, data } = imageData;
  const rgb = new Uint8ClampedArray(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3]     = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  const rawImage = new RawImage(rgb, w, h, 3);

  // Preprocess → inference → get mask tensor
  const { pixel_values } = await (processor as any)(rawImage);
  const { output } = await (model as any)({ input: pixel_values });

  // output[0]: shape [1, 1, H', W'] with values in [0, 1]
  const maskTensor = output[0];
  const maskVals = maskTensor.data as Float32Array;
  const [, , mH, mW] = maskTensor.dims as number[];

  send({ type: 'progress', progress: 0.97, stage: 'Upscaling mask…' });

  // Nearest-neighbour resize to original image dimensions
  const result = new Float32Array(w * h);
  const scaleX = mW / w;
  const scaleY = mH / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mH - 1, Math.floor(y * scaleY));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mW - 1, Math.floor(x * scaleX));
      result[y * w + x] = maskVals[sy * mW + sx];
    }
  }

  send({ type: 'complete', mask: result, width: w, height: h }, [result.buffer]);
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  if (e.data.type !== 'run') return;
  try {
    await runInference(e.data.imageData);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'error', error: msg });
  }
};
