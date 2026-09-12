import { describe, expect, it, vi } from 'vitest';
import { PersistentOcrRecognizer, type TesseractWorker } from '../../src/desktop/ocr/recognize';
import type { Frame } from '../../src/desktop/coordinates';

function frame(): Frame {
  return {
    id: 'frame-1',
    capturedAt: Date.now(),
    displayId: 'display-1',
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    workArea: { x: 0, y: 0, width: 100, height: 100 },
    imageWidth: 100,
    imageHeight: 100,
    scaleFactor: 1,
    png: new Uint8Array([1, 2, 3]),
  };
}

function result(text = 'Total') {
  return {
    data: {
      words: [{
        text,
        confidence: 98,
        bbox: { x0: 4, y0: 5, x1: 44, y1: 25 },
        block_num: 1,
        par_num: 1,
        line_num: 2,
      }],
    },
  };
}

describe('persistent OCR worker', () => {
  it('initializes English once and maps word and line boxes', async () => {
    const worker: TesseractWorker = {
      recognize: vi.fn().mockResolvedValue(result()),
      terminate: vi.fn(),
    };
    const createWorker = vi.fn().mockResolvedValue(worker);
    const recognizer = new PersistentOcrRecognizer({
      createWorker,
      assets: { corePath: 'app://ocr/core.wasm', workerPath: 'app://ocr/worker.js', langPath: 'app://ocr' },
    });

    await expect(recognizer.recognize(frame())).resolves.toEqual([{
      text: 'Total',
      confidence: 98,
      box: { x: 4, y: 5, width: 40, height: 20 },
      lineId: '1:1:2',
    }]);
    await recognizer.recognize(frame());

    expect(createWorker).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledWith({
      language: 'eng',
      corePath: 'app://ocr/core.wasm',
      workerPath: 'app://ocr/worker.js',
      langPath: 'app://ocr',
    });
    expect(worker.recognize).toHaveBeenCalledTimes(2);
  });

  it('rejects late output after cancellation', async () => {
    let resolveRecognition!: (value: ReturnType<typeof result>) => void;
    const worker: TesseractWorker = {
      recognize: vi.fn(() => new Promise<ReturnType<typeof result>>((resolve) => { resolveRecognition = resolve; })),
      terminate: vi.fn(),
    };
    const recognizer = new PersistentOcrRecognizer({ createWorker: vi.fn().mockResolvedValue(worker) });

    const pending = recognizer.recognize(frame());
    await Promise.resolve();
    await Promise.resolve();
    recognizer.cancel();
    resolveRecognition(result('Buy'));

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('times out and terminates the worker', async () => {
    const worker: TesseractWorker = {
      recognize: vi.fn(() => new Promise<ReturnType<typeof result>>(() => {})),
      terminate: vi.fn(),
    };
    const recognizer = new PersistentOcrRecognizer({
      createWorker: vi.fn().mockResolvedValue(worker),
      timeoutMs: 10,
    });

    await expect(recognizer.recognize(frame())).rejects.toMatchObject({ code: 'timeout' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not allow concurrent OCR jobs', async () => {
    let resolveRecognition!: (value: ReturnType<typeof result>) => void;
    const worker: TesseractWorker = {
      recognize: vi.fn(() => new Promise<ReturnType<typeof result>>((resolve) => { resolveRecognition = resolve; })),
      terminate: vi.fn(),
    };
    const recognizer = new PersistentOcrRecognizer({ createWorker: vi.fn().mockResolvedValue(worker) });

    const first = recognizer.recognize(frame());
    await expect(recognizer.recognize(frame())).rejects.toMatchObject({ code: 'busy' });
    resolveRecognition(result());
    await first;
  });
});
