import { parseUSD } from '../domain/money';
import { toDesktopRect } from './coordinates';
import type { CursorSample, Frame, OcrWord, PurchaseCandidate, Rect } from './types';

const finalLabels = new Set(['total', 'grand total', 'order total']);
const purchaseWords = new Set(['buy', 'checkout', 'order', 'purchase', 'complete', 'place']);
const unsupported = /(?:€|£|¥|eur|gbp|cad|aud|jpy)/i;
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const distance = (a: Rect, b: CursorSample) => Math.hypot(center(a).x - b.x, center(a).y - b.y);
const lineText = (words: OcrWord[]) => words.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim();

export function extractPurchase(words: OcrWord[], frame: Frame, cursor: CursorSample, now = Date.now()): PurchaseCandidate {
  if (cursor.displayId !== frame.displayId) return { amountCents: null, sourceText: '', state: 'no-candidate', reason: 'missing-button', totalBox: null, buttonBox: null };
  const lines = new Map<string, OcrWord[]>();
  for (const word of words) (lines.get(word.lineId) ?? (lines.set(word.lineId, []), lines.get(word.lineId)!)).push(word);
  const labels = [...lines.values()].filter(line => finalLabels.has(line.map(w => w.text.toLowerCase()).join(' ').trim()));
  const amountLines = [...lines.values()].filter(line => {
    const text = lineText(line);
    return /\$\s?\d/.test(text) && !/subtotal|savings|discount|installment|payment/i.test(text);
  });
  const currencies = words.filter(w => unsupported.test(w.text));
  if (currencies.length) return { amountCents: null, sourceText: lineText(currencies), state: 'no-candidate', reason: 'unsupported-currency', totalBox: null, buttonBox: null };
  const buttons = [...lines.values()].filter(line => /^(?:buy now|checkout|place order|complete purchase)$/i.test(lineText(line)) || purchaseWords.has(lineText(line).toLowerCase()));
  const button = buttons.find(line => {
    const rect = toDesktopRect(union(line.map(w => w.box)), frame);
    return distance(rect, cursor) <= 80;
  });
  if (!button) {
    const first = amountLines[0];
    if (buttons.length === 0) return { amountCents: null, sourceText: first ? lineText(first) : '', state: 'no-candidate', reason: 'missing-button', totalBox: first ? toDesktopRect(union(first.map(w => w.box)), frame) : null, buttonBox: null };
    return { amountCents: first ? safeAmount(first) : null, sourceText: first ? lineText(first) : '', state: first ? 'confirm' : 'no-candidate', reason: 'missing-button', totalBox: first ? toDesktopRect(union(first.map(w => w.box)), frame) : null, buttonBox: null };
  }
  const labelled = amountLines.filter(line => /(?:order|grand)?\s*total/i.test(lineText(line)));
  const candidates = labelled.length ? labelled : amountLines;
  const values = candidates.map(line => ({ line, cents: safeAmount(line) })).filter(item => item.cents !== null) as { line: OcrWord[]; cents: number }[];
  const distinct = [...new Map(values.map(item => [item.cents, item])).values()];
  const total = distinct.length === 1 ? distinct[0] : undefined;
  const totalLine = total?.line ?? values[0]?.line;
  if (distinct.length !== 1) return { amountCents: null, sourceText: values.map(v => lineText(v.line)).join(' / '), state: 'confirm', reason: distinct.length > 1 ? 'ambiguous' : 'missing-total', totalBox: totalLine ? toDesktopRect(union(totalLine.map(w => w.box)), frame) : null, buttonBox: toDesktopRect(union(button.map(w => w.box)), frame) };
  if (!total) throw new Error('Unreachable total candidate');
  const totalBox = toDesktopRect(union(total.line.map(w => w.box)), frame);
  const buttonBox = toDesktopRect(union(button.map(w => w.box)), frame);
  const fresh = now - frame.capturedAt <= 3_000;
  const confidence = [...total.line, ...button].every(word => word.confidence >= 90);
  return { amountCents: total.cents, sourceText: lineText(total.line), state: fresh && confidence ? 'preview' : 'confirm', reason: fresh && confidence ? 'single-total' : 'low-confidence', totalBox, buttonBox };
}

function safeAmount(line: OcrWord[]): number | null { try { const match = lineText(line).match(/\$\s?[0-9][0-9,]*(?:\.\d{1,2})?/); return match ? parseUSD(match[0]) : null; } catch { return null; } }
function union(rects: Rect[]): Rect { return { x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)), width: Math.max(...rects.map(r => r.x + r.width)) - Math.min(...rects.map(r => r.x)), height: Math.max(...rects.map(r => r.y + r.height)) - Math.min(...rects.map(r => r.y)) }; }
