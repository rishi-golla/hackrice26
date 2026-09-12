import { extractPurchase as extractImageCandidate } from './ocr/extract';
import { toDesktopRect } from './coordinates';
import type { CursorSample, Frame, OcrWord, PurchaseCandidate, Rect } from './types';

const MAX_FRAME_AGE_MS = 3_000;

function noCandidate(reason: PurchaseCandidate['reason']): PurchaseCandidate {
  return {
    amountCents: null,
    sourceText: '',
    state: 'no-candidate',
    reason,
    totalBox: null,
    buttonBox: null,
  };
}

function lineTextForBox(words: OcrWord[], target: Rect | null): string {
  if (!target) return '';
  const matched = words.find((word) => (
    word.box.x <= target.x
    && word.box.y <= target.y
    && word.box.x + word.box.width >= target.x + target.width
    && word.box.y + word.box.height >= target.y + target.height
  ));
  if (!matched) return '';
  return words
    .filter((word) => word.lineId === matched.lineId)
    .sort((left, right) => left.box.x - right.box.x)
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Adapts the image-space Part 2 extractor to the desktop service contract.
 * OCR remains conservative in image pixels; only the cursor and returned
 * boxes cross the display-coordinate boundary here.
 */
export function extractPurchase(words: OcrWord[], frame: Frame, cursor: CursorSample, now = Date.now()): PurchaseCandidate {
  if (cursor.displayId !== frame.displayId) return noCandidate('missing-button');
  if (frame.bounds.width <= 0 || frame.bounds.height <= 0 || frame.imageWidth <= 0 || frame.imageHeight <= 0) {
    return noCandidate('missing-total');
  }

  const cursorInImage = {
    x: (cursor.x - frame.bounds.x) * frame.imageWidth / frame.bounds.width,
    y: (cursor.y - frame.bounds.y) * frame.imageHeight / frame.bounds.height,
  };
  const dipToImageScale = frame.imageWidth / frame.bounds.width;
  const imageCandidate = extractImageCandidate(words, cursorInImage, { dipToImageScale });
  const totalBox = imageCandidate.totalBox ? toDesktopRect(imageCandidate.totalBox, frame) : null;
  const buttonBox = imageCandidate.buttonBox ? toDesktopRect(imageCandidate.buttonBox, frame) : null;
  const sourceText = imageCandidate.amountCents === null
    ? imageCandidate.sourceText
    : lineTextForBox(words, imageCandidate.totalBox) || imageCandidate.sourceText;
  const stale = frame.capturedAt !== undefined && now - frame.capturedAt > MAX_FRAME_AGE_MS;

  return {
    ...imageCandidate,
    sourceText,
    totalBox,
    buttonBox,
    state: stale && imageCandidate.state === 'preview' ? 'confirm' : imageCandidate.state,
    reason: stale && imageCandidate.state === 'preview' ? 'low-confidence' : imageCandidate.reason,
  };
}
