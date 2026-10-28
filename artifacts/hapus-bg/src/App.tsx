import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import type {
  BackgroundRemovalRequest,
  BackgroundRemovalResponse,
  BackgroundRemovalResult,
} from './backgroundRemoval.worker';
import { Download, ImagePlus, LoaderCircle, LockKeyhole, RotateCcw, Upload } from 'lucide-react';

type Phase = 'idle' | 'ready' | 'processing' | 'complete' | 'error';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type ProcessingErrorDetails = { name: string; message: string };
type PendingJob = {
  resolve: (result: BackgroundRemovalResult) => void;
  reject: (error: Error) => void;
};

function getProcessingErrorDetails(error: unknown): ProcessingErrorDetails {
  if (error !== null && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown };
    return {
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
    };
  }
  if (typeof error === 'string') return { name: 'Error', message: error };
  return { name: 'UnknownError', message: String(error) };
}

function waitForBrowserPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => window.setTimeout(resolve, 50));
  });
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [processingError, setProcessingError] = useState<ProcessingErrorDetails | null>(null);
  const [processingStage, setProcessingStage] = useState<'resize' | 'download' | 'process'>('resize');
  const [isDragging, setIsDragging] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const pendingJobsRef = useRef(new Map<string, PendingJob>());

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./backgroundRemoval.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      console.error('Background-removal worker could not start:', error);
      return;
    }

    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<BackgroundRemovalResponse>) => {
      const message = event.data;
      if (message.type === 'preload-complete') {
        document.documentElement.dataset.imglyModelReady = 'true';
        return;
      }
      if (message.type === 'preload-error') {
        console.warn('Background-removal model preload failed:', message.name, message.message);
        return;
      }

      if (message.requestId === activeRequestIdRef.current && message.type === 'progress') {
        setProcessingStage(message.stage);
        setProgress(message.percent);
        if (message.stage === 'resize') {
          setStatusMessage('Memperkecil gambar...');
        } else if (message.stage === 'download') {
          setStatusMessage(`Mengunduh model... ${message.percent}%`);
        } else {
          setStatusMessage(`Memproses... ${message.percent}%`);
        }
        return;
      }

      const pending = pendingJobsRef.current.get(message.requestId);
      if (!pending) return;
      pendingJobsRef.current.delete(message.requestId);
      activeRequestIdRef.current = null;

      if (message.type === 'result') {
        pending.resolve(message);
      } else if (message.type === 'error') {
        const error = new Error(message.message);
        error.name = message.name;
        pending.reject(error);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Web Worker gagal dijalankan.');
      for (const pending of pendingJobsRef.current.values()) pending.reject(error);
      pendingJobsRef.current.clear();
      activeRequestIdRef.current = null;
    };

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    let idleHandle: number | undefined;
    let fallbackHandle: number | undefined;
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const startPreload = () => worker.postMessage({ type: 'preload' } satisfies BackgroundRemovalRequest);
    if (!connection?.saveData) {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(startPreload, { timeout: 5000 });
      } else {
        fallbackHandle = window.setTimeout(startPreload, 1200);
      }
    }

    return () => {
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      if (fallbackHandle !== undefined) window.clearTimeout(fallbackHandle);
      for (const pending of pendingJobsRef.current.values()) {
        pending.reject(new Error('Pemrosesan dihentikan karena halaman ditutup.'));
      }
      pendingJobsRef.current.clear();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!originalUrl) return;
    return () => URL.revokeObjectURL(originalUrl);
  }, [originalUrl]);

  useEffect(() => {
    if (!resultUrl) return;
    return () => URL.revokeObjectURL(resultUrl);
  }, [resultUrl]);

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    setProcessingError(null);
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setStatusMessage('Formatnya belum cocok. Coba JPG, PNG, atau WebP ya.');
      setPhase('error');
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setStatusMessage('Ukuran gambar terlalu besar. Maksimal 10 MB ya.');
      setPhase('error');
      return;
    }
    if (nextFile.size === 0) {
      setStatusMessage('File ini kosong. Coba pilih gambar lain.');
      setPhase('error');
      return;
    }
    setFile(nextFile);
    setOriginalUrl(URL.createObjectURL(nextFile));
    setResultUrl('');
    setProgress(0);
    setPhase('ready');
    setStatusMessage(`Gambar siap: ${nextFile.name}`);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    chooseFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (phase === 'processing') return;
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const processImage = async () => {
    if (!file || phase === 'processing') return;
    setPhase('processing');
    setProcessingStage('resize');
    setProgress(0);
    setProcessingError(null);
    setStatusMessage('Memperkecil gambar...');
    try {
      await waitForBrowserPaint();
      const worker = workerRef.current;
      if (!worker) throw new Error('Web Worker tidak tersedia di browser ini.');

      const requestId = crypto.randomUUID();
      activeRequestIdRef.current = requestId;
      const result = await new Promise<BackgroundRemovalResult>((resolve, reject) => {
        pendingJobsRef.current.set(requestId, { resolve, reject });
        const request: BackgroundRemovalRequest = { type: 'process', requestId, file };
        worker.postMessage(request);
      });
      const transparentImage = result.blob;
      if (!(transparentImage instanceof Blob) || transparentImage.size === 0) {
        throw new Error('Hasil gambar tidak tersedia.');
      }
      setResultUrl(URL.createObjectURL(transparentImage));
      setProgress(100);
      setPhase('complete');
      setStatusMessage('Selesai! Background gambarmu sudah dihapus.');
    } catch (error) {
      console.error('Background removal failed:', error);
      setProcessingError(getProcessingErrorDetails(error));
      setPhase('error');
      setStatusMessage('Belum berhasil memproses gambar. Coba lagi atau pilih gambar lain.');
    }
  };

  const selectAnother = () => {
    setFile(null);
    setOriginalUrl('');
    setResultUrl('');
    setProgress(0);
    setProcessingError(null);
    setPhase('idle');
    setStatusMessage('');
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  };

  const isBusy = phase === 'processing';

  return (
    <main className="paper-noise min-h-[100dvh] px-4 pb-10 pt-5 sm:px-7 sm:pt-8">
      <div className="mx-auto w-full max-w-[940px]">
        <header className="mb-7 flex items-center gap-3 sm:mb-9">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt="Logo Hapus Background"
            className="h-11 w-11 shrink-0 object-contain"
            width="44"
            height="44"
          />
          <div>
            <p className="font-['Fredoka'] text-[21px] font-semibold leading-none tracking-tight">Hapus Background</p>
            <p className="mt-1 text-sm text-[#54483c]">
              oleh{' '}
              <a
                href="https://www.instagram.com/fly_rafly_208"
                target="_blank"
                rel="noopener noreferrer"
                className="font-sans text-[#54483c] no-underline hover:underline focus-visible:underline active:underline"
              >
                Rafly Novensa
              </a>
            </p>
          </div>
        </header>

        <section aria-labelledby="page-title">
          <div className="mb-4">
            <h1 id="page-title" className="font-['Fredoka'] text-[29px] font-semibold leading-tight sm:text-[34px]">Yuk, pilih gambar</h1>
            <p className="mt-1 text-sm text-[#76695c]">JPG, PNG, atau WebP · maksimal 10 MB</p>
          </div>

          <div
            data-testid="dropzone-image"
            onDragOver={(event) => { event.preventDefault(); if (!isBusy) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-[14px] border-2 border-dashed border-[#2B2118] bg-[#FFD3B6] px-5 py-7 transition-[transform,background-color] sm:px-8 sm:py-9 ${isDragging ? 'scale-[1.01] bg-[#fbc09a]' : ''}`}
          >
            <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-[#2B2118] bg-[#FFF8EE]" aria-hidden="true">
                  <ImagePlus size={27} />
                </div>
                <div>
                  <p className="font-['Fredoka'] text-xl font-semibold">{file ? file.name : 'Taruh gambar di sini'}</p>
                  <p className="mt-1 text-sm text-[#54483c]">{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB · siap diproses` : 'Atau pilih dari perangkatmu'}</p>
                </div>
              </div>
              <button
                type="button"
                data-testid="button-select-image"
                onClick={() => inputRef.current?.click()}
                disabled={isBusy}
                className="pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] border-2 border-[#2B2118] bg-[#FFF8EE] px-5 font-bold sm:w-auto"
              >
                <Upload size={18} />
                Pilih gambar
              </button>
            </div>
            <input
              ref={inputRef}
              data-testid="input-image-file"
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Pilih gambar untuk menghapus background"
              disabled={isBusy}
              onChange={handleInput}
            />
          </div>

          {statusMessage && (
            <div
              role={phase === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              data-testid="status-processing"
              data-processing-stage={isBusy ? processingStage : undefined}
              className={`mt-4 flex min-h-12 items-center gap-3 rounded-[12px] border-2 border-[#2B2118] px-4 py-2 text-sm font-semibold ${phase === 'error' ? 'bg-[#FFD3B6]' : phase === 'complete' ? 'bg-[#CDEBD8]' : 'bg-[#FFF8EE]'}`}
            >
              {isBusy ? <LoaderCircle className="shrink-0 animate-spin" size={19} /> : phase === 'error' ? <span aria-hidden="true">!</span> : <LockKeyhole className="shrink-0" size={18} />}
              <div className="min-w-0 flex-1">
                <p>{statusMessage}</p>
                {phase === 'error' && processingError && (
                  <p
                    data-testid="status-error-details"
                    className="mt-1 break-all text-xs font-normal leading-relaxed text-[#54483c]"
                  >
                    <span className="font-semibold">err.name:</span> {processingError.name}
                    <br />
                    <span className="font-semibold">err.message:</span>{' '}
                    {processingError.message || '(kosong)'}
                  </p>
                )}
                {isBusy && (
                  <p className="mt-1 text-xs font-normal leading-relaxed text-[#54483c]">
                    Sedang memproses, halaman mungkin terasa berat. Jangan tutup atau pindah tab.
                  </p>
                )}
              </div>
              {isBusy && (
                <div className="w-[78px] shrink-0 text-right text-xs font-bold" aria-label={`Progress ${progress}%`}>
                  <span className="block">{progress}%</span>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full border border-[#2B2118] bg-[#FFF8EE]">
                    <span className="block h-full bg-[#2B2118] transition-[width] duration-300" style={{ width: `${progress}%` }} />
                  </span>
                </div>
              )}
            </div>
          )}

          {file && (
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              {phase !== 'complete' && (
                <button
                  type="button"
                  data-testid="button-remove-background"
                  onClick={processImage}
                  disabled={isBusy}
                  className="pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] border-2 border-[#2B2118] bg-[#FFD3B6] px-6 font-bold sm:w-auto"
                >
                  {isBusy ? <LoaderCircle size={19} className="animate-spin" /> : <ImagePlus size={19} />}
                  {isBusy ? 'Memproses...' : 'Hapus background'}
                </button>
              )}
              {phase === 'complete' && resultUrl && (
                <a
                  data-testid="button-download-png"
                  href={resultUrl}
                  download={`${file.name.replace(/\.[^.]+$/, '') || 'gambar'}-tanpa-background.png`}
                  className="pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] border-2 border-[#2B2118] bg-[#FFD3B6] px-6 font-bold no-underline sm:w-auto"
                >
                  <Download size={19} />
                  Unduh PNG
                </a>
              )}
              {(phase === 'complete' || phase === 'error') && (
                <button
                  type="button"
                  data-testid="button-select-another"
                  onClick={selectAnother}
                  disabled={isBusy}
                  className="pressable inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] border-2 border-[#2B2118] bg-[#FFF8EE] px-5 font-bold sm:w-auto"
                >
                  <RotateCcw size={17} />
                  Pilih gambar lain
                </button>
              )}
            </div>
          )}

          {file && (
            <section aria-label="Perbandingan gambar" className="mt-8 pop-in">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-['Fredoka'] text-2xl font-semibold">Lihat hasilnya</h2>
                  <p className="mt-0.5 text-sm text-[#76695c]">Asli dan versi tanpa background.</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <figure className="overflow-hidden rounded-[14px] border-2 border-[#2B2118] bg-[#FFD3B6]">
                  <figcaption className="flex h-11 items-center justify-between border-b-2 border-[#2B2118] px-4 text-sm font-bold">
                    <span>Asli</span><span className="text-xs font-medium text-[#54483c]">Sebelum</span>
                  </figcaption>
                  <div className="flex h-[250px] items-center justify-center p-4 sm:h-[300px]">
                    <img src={originalUrl} alt={`Gambar asli ${file.name}`} className="max-h-full max-w-full object-contain" />
                  </div>
                </figure>
                <figure className="overflow-hidden rounded-[14px] border-2 border-[#2B2118] bg-[#CDEBD8]">
                  <figcaption className="flex h-11 items-center justify-between border-b-2 border-[#2B2118] px-4 text-sm font-bold">
                    <span>Tanpa background</span><span className="text-xs font-medium text-[#54483c]">Sesudah</span>
                  </figcaption>
                  <div className="checkerboard flex h-[250px] items-center justify-center p-4 sm:h-[300px]">
                    {resultUrl ? (
                      <img data-testid="image-transparent-result" src={resultUrl} alt={`Hasil transparan ${file.name}`} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <div data-testid="status-result-placeholder" className="mx-3 max-w-[230px] rounded-[12px] border-2 border-[#2B2118] bg-[#FFF8EE] px-4 py-3 text-center text-sm font-medium">
                        {isBusy ? `Sedang diproses${progress ? ` · ${progress}%` : ''}` : 'Hasil transparan muncul di sini'}
                      </div>
                    )}
                  </div>
                </figure>
              </div>
            </section>
          )}
        </section>

        <footer className="mt-9 flex items-start gap-2 border-t-2 border-[#2B2118]/15 pt-4 text-xs leading-relaxed text-[#76695c]">
          <LockKeyhole size={15} className="mt-0.5 shrink-0" />
          <p>Gambarmu diproses langsung di browser ini. File tidak diunggah dan tidak disimpan.</p>
        </footer>
      </div>
    </main>
  );
}

export default App;
