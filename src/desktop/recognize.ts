import path from 'node:path';
import { createWorker } from 'tesseract.js';
import {
  PersistentOcrRecognizer,
  type TesseractWorker,
  type TesseractWorkerConfig,
} from './ocr/recognize';
import type { OcrWord } from './ocr/extract';
import type { Frame } from './types';

type Paths = { langPath?: string; workerPath?: string; corePath?: string; timeoutMs?: number };

let recognizer: PersistentOcrRecognizer | undefined;
let recognizerKey = '';

function pathsFor(options: Paths): { langPath: string; workerPath?: string; corePath?: string; timeoutMs?: number } {
  return {
    langPath: options.langPath ?? path.join(process.cwd(), 'dist/ocr'),
    workerPath: options.workerPath,
    corePath: options.corePath,
    timeoutMs: options.timeoutMs,
  };
}

async function createRuntimeWorker(config: TesseractWorkerConfig): Promise<TesseractWorker> {
  // tesseract.js merges options as {...defaultOptions, ..._options}. Its own
  // defaultOptions.workerPath/corePath point at the correct bundled files;
  // including workerPath/corePath keys here even as `undefined` would
  // overwrite those working defaults (an explicit `undefined` value still
  // wins the spread) and crash `new Worker(undefined)`. Only pass them when
  // a caller actually supplied a real override.
  const overrides: { workerPath?: string; corePath?: string } = {};
  if (config.workerPath) overrides.workerPath = config.workerPath;
  if (config.corePath) overrides.corePath = config.corePath;
  const worker = await createWorker('eng', 1, {
    langPath: config.langPath,
    ...overrides,
    logger: () => {},
  });
  return worker as unknown as TesseractWorker;
}

export async function recognize(frame: Frame, options: Paths = {}): Promise<OcrWord[]> {
  const runtime = pathsFor(options);
  const key = JSON.stringify(runtime);
  if (!recognizer || recognizerKey !== key) {
    await disposeRecognizer();
    recognizer = new PersistentOcrRecognizer({
      assets: runtime,
      timeoutMs: runtime.timeoutMs,
      createWorker: createRuntimeWorker,
    });
    recognizerKey = key;
  }
  return recognizer.recognize(frame);
}

export async function disposeRecognizer(): Promise<void> {
  const current = recognizer;
  recognizer = undefined;
  recognizerKey = '';
  if (current) await current.terminate();
}
