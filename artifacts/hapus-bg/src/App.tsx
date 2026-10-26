import { type ChangeEvent, type DragEvent, useEffect, useRef, useState } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { Download, FileImage, ImagePlus, LoaderCircle, LockKeyhole, RotateCcw, Upload } from 'lucide-react';

type Phase = 'idle' | 'ready' | 'processing' | 'complete' | 'error';

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    };
  }, [originalUrl, resultUrl]);

  const chooseFile = (nextFile?: File) => {
    if (!nextFile) return;
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setStatusMessage('Formatnya belum cocok. Coba JPG, PNG, atau WebP ya.');
      setPhase('error');
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setStatusMessage('Ukuran gambar terlalu besar. Maksimal 30 MB ya.');
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
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0]);
  };

  const processImage = async () => {
    if (!file || phase === 'processing') return;
    setPhase('processing');
    setProgress(0);
    setStatusMessage('Memulai pemrosesan di browser...');
    try {
      const transparentImage = await removeBackground(file, {
        progress: (_key, current, total) => {
          if (total > 0) {
            const nextProgress = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
            setProgress(nextProgress);
            setStatusMessage(`Memproses... ${nextProgress}%`);
          } else {
            setStatusMessage('Memproses...');
          }
        },
      });
      if (!(transparentImage instanceof Blob) || transparentImage.size === 0) {
        throw new Error('Hasil gambar tidak tersedia.');
      }
      setResultUrl(URL.createObjectURL(transparentImage));
      setProgress(100);
      setPhase('complete');
      setStatusMessage('Selesai! Background gambarmu sudah dihapus.');
    } catch (error) {
      console.error('Background removal failed:', error);
      setPhase('error');
      setStatusMessage('Belum berhasil memproses gambar. Coba lagi atau pilih gambar lain.');
    }
  };

  const selectAnother = () => {
    setFile(null);
    setOriginalUrl('');
    setResultUrl('');
    setProgress(0);
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
          <div className="flex h-11 w-11 items-center justify-center rounded-[12px] border-2 border-[#2B2118] bg-[#FFD3B6] shadow-[3px_3px_0_#2B2118]" aria-hidden="true">
            <FileImage size={22} strokeWidth={2.2} />
          </div>
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
            <p className="mt-1 text-sm text-[#76695c]">JPG, PNG, atau WebP · maksimal 30 MB</p>
          </div>

          <div
            data-testid="dropzone-image"
            onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
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
              onChange={handleInput}
            />
          </div>

          {statusMessage && (
            <div
              role={phase === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              data-testid="status-processing"
              className={`mt-4 flex min-h-12 items-center gap-3 rounded-[12px] border-2 border-[#2B2118] px-4 py-2 text-sm font-semibold ${phase === 'error' ? 'bg-[#FFD3B6]' : phase === 'complete' ? 'bg-[#CDEBD8]' : 'bg-[#FFF8EE]'}`}
            >
              {isBusy ? <LoaderCircle className="shrink-0 animate-spin" size={19} /> : phase === 'error' ? <span aria-hidden="true">!</span> : <LockKeyhole className="shrink-0" size={18} />}
              <span className="min-w-0 flex-1">{statusMessage}</span>
              {isBusy && (
                <span className="w-[78px] shrink-0" aria-label={`Progress ${progress}%`}>
                  <span className="block h-2 overflow-hidden rounded-full border border-[#2B2118] bg-[#FFF8EE]">
                    <span className="block h-full bg-[#2B2118] transition-[width] duration-300" style={{ width: `${progress}%` }} />
                  </span>
                </span>
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
