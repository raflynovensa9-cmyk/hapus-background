import { preload, removeBackground } from '@imgly/background-removal';

const MAX_PROCESSING_EDGE = 1024;
const IMGLY_PUBLIC_PATH =
  'https://staticimgly.com/@imgly/background-removal-data/${PACKAGE_VERSION}/dist/';

export type BackgroundRemovalRequest =
  | { type: 'preload' }
  | { type: 'process'; requestId: string; file: File };

export type BackgroundRemovalResult = {
  type: 'result';
  requestId: string;
  blob: Blob;
  width: number;
  height: number;
  resized: boolean;
};

export type BackgroundRemovalResponse =
  | { type: 'preload-complete' }
  | { type: 'preload-error'; name: string; message: string }
  | {
      type: 'progress';
      requestId: string;
      stage: 'resize' | 'download' | 'process';
      percent: number;
    }
  | BackgroundRemovalResult
  | { type: 'error'; requestId: string; name: string; message: string };

type WorkerScope = {
  onmessage: ((event: MessageEvent<BackgroundRemovalRequest>) => void) | null;
  postMessage: (message: BackgroundRemovalResponse) => void;
};

const workerScope = self as unknown as WorkerScope;
let activeRequestId: string | null = null;
let modelReady = false;
let modelPromise: Promise<void> | null = null;

function sendProgress(
  stage: 'resize' | 'download' | 'process',
  percent = 0,
) {
  if (!activeRequestId) return;
  workerScope.postMessage({
    type: 'progress',
    requestId: activeRequestId,
    stage,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
  });
}

function getErrorDetails(error: unknown) {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown };
    return {
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
    };
  }
  return {
    name: typeof error === 'string' ? 'Error' : 'UnknownError',
    message: String(error),
  };
}

async function withSingleThreadedWasmWhenNeeded<T>(run: () => Promise<T>): Promise<T> {
  if (globalThis.crossOriginIsolated || navigator.hardwareConcurrency === 1) {
    return run();
  }

  // IMG.LY 1.7.0 has no numThreads config; cap the worker's WASM session to one thread.
  const previousDescriptor = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
  let overridden = false;
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 1,
    });
    overridden = true;
    return await run();
  } finally {
    if (overridden) {
      if (previousDescriptor) {
        Object.defineProperty(navigator, 'hardwareConcurrency', previousDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'hardwareConcurrency');
      }
    }
  }
}

const config = {
  publicPath: IMGLY_PUBLIC_PATH,
  model: 'isnet_quint8' as const,
  progress: (key: string, current: number, total: number) => {
    if (!activeRequestId) return;
    const stage = key.startsWith('fetch:') ? 'download' : 'process';
    sendProgress(stage, total > 0 ? (current / total) * 100 : 0);
  },
};

function ensureModelReady(): Promise<void> {
  if (!modelPromise) {
    modelPromise = withSingleThreadedWasmWhenNeeded(() => preload(config))
      .then(() => {
        modelReady = true;
      })
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}

async function resizeImage(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
  resized: boolean;
}> {
  const bitmap = await createImageBitmap(file);
  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    if (longestEdge <= MAX_PROCESSING_EDGE) {
      return {
        blob: file,
        width: bitmap.width,
        height: bitmap.height,
        resized: false,
      };
    }

    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas tidak tersedia untuk memperkecil gambar di worker.');
    }

    const scale = MAX_PROCESSING_EDGE / longestEdge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas tidak dapat digunakan untuk memperkecil gambar.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const resizedBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.92,
    });

    return { blob: resizedBlob, width, height, resized: true };
  } finally {
    bitmap.close();
  }
}

async function processImage(request: Extract<BackgroundRemovalRequest, { type: 'process' }>) {
  activeRequestId = request.requestId;
  try {
    sendProgress('resize');
    const resized = await resizeImage(request.file);

    if (!modelReady) sendProgress('download');
    await ensureModelReady();
    sendProgress('process');

    const blob = await removeBackground(resized.blob, config);
    workerScope.postMessage({
      type: 'result',
      requestId: request.requestId,
      blob,
      width: resized.width,
      height: resized.height,
      resized: resized.resized,
    });
  } catch (error) {
    const details = getErrorDetails(error);
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      ...details,
    });
  } finally {
    activeRequestId = null;
  }
}

workerScope.onmessage = (event) => {
  if (event.data.type === 'preload') {
    void ensureModelReady()
      .then(() => workerScope.postMessage({ type: 'preload-complete' }))
      .catch((error) => {
        const details = getErrorDetails(error);
        workerScope.postMessage({ type: 'preload-error', ...details });
      });
    return;
  }
  void processImage(event.data);
};
