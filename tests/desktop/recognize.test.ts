import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(),
}));
const createWorker = vi.hoisted(() => vi.fn());

vi.mock('tesseract.js', () => ({ createWorker }));

import { disposeRecognizer, recognize } from '../../src/desktop/recognize';
import type { Frame } from '../../src/desktop/types';

const frame: Frame = {
  id: 'frame',
  capturedAt: 0,
  displayId: 'primary',
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  workArea: { x: 0, y: 0, width: 100, height: 100 },
  imageWidth: 100,
  imageHeight: 100,
  png: new Uint8Array([137, 80, 78, 71]),
};

const paths = {
  langPath: '/app/dist/ocr/lang',
  workerPath: '/app/dist/ocr/worker.js',
  corePath: '/app/dist/ocr/core',
};

beforeEach(async () => {
  await disposeRecognizer();
  vi.clearAllMocks();
  createWorker.mockResolvedValue(worker);
  worker.terminate.mockResolvedValue(undefined);
  worker.recognize.mockResolvedValue({
    data: {
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [
                    { text: 'Total', confidence: 98, bbox: { x0: 10, y0: 20, x1: 50, y1: 35 } },
                    { text: '$20.00', confidence: 97, bbox: { x0: 55, y0: 20, x1: 95, y1: 35 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await disposeRecognizer();
});

describe('recognize', () => {
  it('uses one persistent local worker and returns word boxes with stable line IDs', async () => {
    const first = await recognize(frame, { ...paths, timeoutMs: 100 });
    const second = await recognize(frame, { ...paths, timeoutMs: 100 });

    expect(first).toEqual([
      { text: 'Total', confidence: 98, lineId: '0:0:0', box: { x: 10, y: 20, width: 40, height: 15 } },
      { text: '$20.00', confidence: 97, lineId: '0:0:0', box: { x: 55, y: 20, width: 40, height: 15 } },
    ]);
    expect(second).toEqual(first);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(createWorker).toHaveBeenCalledWith(
      'eng',
      1,
      expect.objectContaining(paths),
    );
  });

  it('times out after five seconds and terminates the stuck worker', async () => {
    vi.useFakeTimers();
    worker.recognize.mockReturnValue(new Promise(() => {}));

    const pending = recognize(frame, { ...paths });
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(5_000);

    await assertion;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
