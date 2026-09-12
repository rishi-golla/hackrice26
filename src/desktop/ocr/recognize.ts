import type { Frame } from '../coordinates';
import type { OcrWord } from './extract';

export type TesseractAssetPaths = {
  /** Local paths/URLs packaged with the application; no first-use download is required. */
  corePath?: string;
  workerPath?: string;
  langPath?: string;
};

export type TesseractWorkerConfig = TesseractAssetPaths & {
  language: 'eng';
};

export type TesseractWord = {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  lineId?: string;
  block_num?: number;
  par_num?: number;
  line_num?: number;
};

export type TesseractRecognitionResult = {
  data?: {
    words?: TesseractWord[];
    blocks?: unknown[];
  };
};

export type TesseractWorker = {
  /**
   * The third (output-configuration) argument matters: tesseract.js only
   * populates `data.blocks` (and therefore word-level boxes) when called as
   * `recognize(image, {}, { blocks: true })`. Without it `data.blocks` is
   * `null` and `data.words` doesn't exist in tesseract.js@^6, so mapWords()
   * below would always throw 'invalid-result' on a real worker.
   */
  recognize(image: Uint8Array, params?: Record<string, unknown>, opts?: { blocks?: boolean }): Promise<TesseractRecognitionResult>;
  terminate(): Promise<void> | void;
  /** Present in older Tesseract.js versions; newer versions do this in createWorker. */
  loadLanguage?(language: 'eng'): Promise<void> | void;
  initialize?(language: 'eng'): Promise<void> | void;
};

export type TesseractWorkerFactory = (config: TesseractWorkerConfig) => Promise<TesseractWorker> | TesseractWorker;

export type RecognizerOptions = {
  createWorker: TesseractWorkerFactory;
  assets?: TesseractAssetPaths;
  timeoutMs?: number;
};

export class OcrRecognitionError extends Error {
  public constructor(
    public readonly code: 'unavailable' | 'busy' | 'timeout' | 'cancelled' | 'invalid-result',
    message: string,
  ) {
    super(message);
    this.name = 'OcrRecognitionError';
  }
}

type WorkerWithState = {
  worker: TesseractWorker;
};

function imageBoxToRect(box: TesseractWord['bbox']): OcrWord['box'] | null {
  if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) return null;
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  if (width < 0 || height < 0) return null;
  return { x: box.x0, y: box.y0, width, height };
}

function lineIdFor(word: TesseractWord, index: number): string {
  if (word.lineId) return word.lineId;
  if (word.block_num !== undefined || word.par_num !== undefined || word.line_num !== undefined) {
    return `${word.block_num ?? 0}:${word.par_num ?? 0}:${word.line_num ?? 0}`;
  }
  return `line-${index}`;
}

function blockWords(blocks: unknown[]): TesseractWord[] {
  const output: TesseractWord[] = [];
  blocks.forEach((blockValue, blockIndex) => {
    const block = blockValue as { paragraphs?: unknown[] };
    block.paragraphs?.forEach((paragraphValue, paragraphIndex) => {
      const paragraph = paragraphValue as { lines?: unknown[] };
      paragraph.lines?.forEach((lineValue, lineIndex) => {
        const line = lineValue as { words?: unknown[] };
        line.words?.forEach((wordValue) => {
          const word = wordValue as Partial<TesseractWord>;
          output.push({
            text: String(word.text ?? ''),
            confidence: Number(word.confidence ?? 0),
            bbox: word.bbox ?? { x0: NaN, y0: NaN, x1: NaN, y1: NaN },
            lineId: `${blockIndex}:${paragraphIndex}:${lineIndex}`,
          });
        });
      });
    });
  });
  return output;
}

function mapWords(result: TesseractRecognitionResult): OcrWord[] {
  const words = result.data?.words ?? (result.data?.blocks ? blockWords(result.data.blocks) : undefined);
  if (!Array.isArray(words)) {
    throw new OcrRecognitionError('invalid-result', 'OCR returned no word data');
  }

  return words.flatMap((word, index) => {
    const box = imageBoxToRect(word.bbox);
    if (!box || typeof word.text !== 'string' || word.text.trim() === '' || !Number.isFinite(word.confidence)) {
      return [];
    }
    return [{
      text: word.text,
      confidence: Math.max(0, Math.min(100, word.confidence)),
      box,
      lineId: lineIdFor(word, index),
    }];
  });
}

async function terminateWorker(worker: TesseractWorker): Promise<void> {
  await worker.terminate();
}

function timeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new OcrRecognitionError('timeout', `OCR timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * A single-worker recognizer. The worker is initialized lazily and then reused
 * for subsequent frames. The caller supplies the Tesseract factory so the
 * desktop shell can provide bundled `eng`, worker, and core assets without
 * making OCR tests or the domain package network-dependent.
 */
export class PersistentOcrRecognizer {
  private workerPromise?: Promise<WorkerWithState>;
  private active?: WorkerWithState;
  private generation = 0;
  private busy = false;
  private stopped = false;

  public constructor(private readonly options: RecognizerOptions) {}

  public async recognize(frame: Frame): Promise<OcrWord[]> {
    if (this.stopped) {
      throw new OcrRecognitionError('unavailable', 'OCR worker has been terminated');
    }
    if (this.busy) {
      throw new OcrRecognitionError('busy', 'An OCR job is already running');
    }

    const capturedGeneration = this.generation;
    this.busy = true;
    let workerState: WorkerWithState | undefined;

    try {
      const workerPromise = this.getWorker();
      workerState = await workerPromise;
      this.active = workerState;

      if (this.stopped) {
        throw new OcrRecognitionError('unavailable', 'OCR worker has been terminated');
      }
      if (capturedGeneration !== this.generation) {
        throw new OcrRecognitionError('cancelled', 'OCR result was cancelled before recognition');
      }

      if (!frame.png) {
        throw new OcrRecognitionError('invalid-result', 'OCR frame has no captured image');
      }

      const result = await timeout(
        workerState.worker.recognize(frame.png, {}, { blocks: true }),
        this.options.timeoutMs ?? 5_000,
        () => {
          // A timed-out worker may still resolve later. Terminate it and clear
          // the cached promise so the next user-triggered capture gets a fresh
          // worker. Its late result is still ignored by the generation check.
          this.generation += 1;
          if (workerState) void terminateWorker(workerState.worker).catch(() => undefined);
          if (this.workerPromise === workerPromise) {
            this.workerPromise = undefined;
          }
        },
      );

      if (capturedGeneration !== this.generation) {
        throw new OcrRecognitionError('cancelled', 'OCR result was cancelled before publication');
      }
      return mapWords(result);
    } finally {
      this.busy = false;
      if (this.active === workerState) this.active = undefined;
    }
  }

  /** Invalidate an in-flight result without forcing a second OCR job. */
  public cancel(): void {
    this.generation += 1;
  }

  public async terminate(): Promise<void> {
    this.stopped = true;
    this.generation += 1;

    const workerState = this.active ?? (this.workerPromise ? await this.workerPromise.catch(() => undefined) : undefined);
    this.workerPromise = undefined;
    this.active = undefined;
    if (workerState) await workerState.worker.terminate();
  }

  private getWorker(): Promise<WorkerWithState> {
    if (!this.workerPromise) {
      this.workerPromise = Promise.resolve(this.options.createWorker({
        language: 'eng',
        ...this.options.assets,
      })).then((worker) => ({ worker }));
    }
    return this.workerPromise;
  }
}

/**
 * Adapter for the public Tesseract.js `createWorker` shape. Keeping this
 * small boundary typed lets the app pin a compatible Tesseract.js version and
 * pass packaged asset paths at startup.
 */
export type TesseractModule = {
  createWorker(
    language: 'eng',
    oem?: number,
    options?: TesseractAssetPaths,
  ): Promise<TesseractWorker> | TesseractWorker;
};

export function createTesseractRecognizer(
  tesseract: TesseractModule,
  assets: TesseractAssetPaths = {},
): PersistentOcrRecognizer {
  return new PersistentOcrRecognizer({
    assets,
    createWorker: async (config) => {
      // See the matching comment in src/desktop/recognize.ts: only pass
      // corePath/workerPath when actually set, or an explicit `undefined`
      // overwrites tesseract.js's own working defaults via object-spread.
      const overrides: { corePath?: string; workerPath?: string } = {};
      if (config.corePath) overrides.corePath = config.corePath;
      if (config.workerPath) overrides.workerPath = config.workerPath;
      const worker = await tesseract.createWorker('eng', undefined, {
        ...overrides,
        langPath: config.langPath,
      });

      // Tesseract.js v5+ initializes from createWorker's language argument;
      // this keeps the adapter compatible with versions that expose the
      // explicit two-step lifecycle as well.
      if (worker.loadLanguage) await worker.loadLanguage('eng');
      if (worker.initialize) await worker.initialize('eng');
      return worker;
    },
  });
}

let defaultRecognizer: PersistentOcrRecognizer | undefined;

/** Configure the process-wide recognizer used by the desktop pipeline. */
export function configureRecognizer(recognizer: PersistentOcrRecognizer): void {
  defaultRecognizer = recognizer;
}

/** The narrow runtime entry point consumed by the capture pipeline. */
export function recognize(frame: Frame): Promise<OcrWord[]> {
  if (!defaultRecognizer) {
    return Promise.reject(new OcrRecognitionError('unavailable', 'OCR worker is not configured'));
  }
  return defaultRecognizer.recognize(frame);
}

export function cancelRecognition(): void {
  defaultRecognizer?.cancel();
}

export async function terminateRecognizer(): Promise<void> {
  await defaultRecognizer?.terminate();
  defaultRecognizer = undefined;
}
