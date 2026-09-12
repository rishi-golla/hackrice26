import path from 'node:path';
import { createWorker } from 'tesseract.js';
import type { Frame, OcrWord } from './types';
type Paths = { langPath?: string; workerPath?: string; corePath?: string; timeoutMs?: number };
let worker: any;
let pending: Promise<OcrWord[]> | undefined;
let currentPaths = '';
export async function recognize(frame: Frame, options: Paths = {}): Promise<OcrWord[]> {
  const key = JSON.stringify(options);
  if (!worker || currentPaths !== key) { await disposeRecognizer(); currentPaths = key; worker = await createWorker('eng', 1, { langPath: options.langPath ?? path.join(process.cwd(), 'dist/ocr'), workerPath: options.workerPath, corePath: options.corePath, logger: () => {} }); }
  if (pending) throw new Error('OCR already running');
  const task = worker.recognize(frame.png).then((result: any) => flatten(result.data?.blocks ?? []));
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs ?? 5_000); });
  pending = Promise.race([task.then((value: OcrWord[]) => ({ kind: 'value' as const, value })), timeout.then((value: 'timeout') => ({ kind: value as 'timeout' }))]).then(async result => {
    if (result.kind === 'timeout') {
      await disposeRecognizer();
      await new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(0); });
      throw new Error('OCR timed out after five seconds');
    }
    return result.value;
  });
  pending.catch(() => undefined);
  try { return await pending; } catch (error) { if (!String(error).includes('timed out')) await disposeRecognizer(); throw error; } finally { clearTimeout(timer!); pending = undefined; }
}
function flatten(blocks: any[]): OcrWord[] {
  const output: OcrWord[] = [];
  blocks.forEach((block, bi) => {
    block.paragraphs?.forEach((paragraph: any, pi: number) => {
      paragraph.lines?.forEach((line: any, li: number) => {
        line.words?.forEach((word: any) => output.push({
          text: String(word.text ?? '').trim(), confidence: Number(word.confidence ?? 0),
          box: { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 },
          lineId: `${bi}:${pi}:${li}`,
        }));
      });
    });
  });
  return output.filter(word => word.text);
}
export async function disposeRecognizer() { if (worker) { const old = worker; worker = undefined; pending = undefined; await old.terminate?.(); } }
