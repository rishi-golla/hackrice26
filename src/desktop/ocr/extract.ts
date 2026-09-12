import type { OcrWord, PurchaseCandidate, Rect } from '../types';
export type { OcrWord, PurchaseCandidate } from '../types';

export type PurchaseCandidateState = 'preview' | 'confirm' | 'no-candidate';

export type PurchaseCandidateReason =
  | 'single-total'
  | 'ambiguous'
  | 'missing-total'
  | 'missing-button'
  | 'unsupported-currency'
  | 'low-confidence'
  | 'stale-frame';

export type ExtractionOptions = {
  /** Age of the captured frame at publication time. */
  frameAgeMs?: number;
  /** Image pixels per DIP. Defaults to one when the caller already converted the cursor. */
  dipToImageScale?: number;
};

const AUTO_PREVIEW_CONFIDENCE = 90;
const MAX_CURSOR_DISTANCE_DIP = 80;
const MAX_FRAME_AGE_MS = 3_000;

type Token = {
  raw: string;
  normalized: string;
  word: OcrWord;
};

type LabelMatch = {
  start: number;
  end: number;
  words: OcrWord[];
  box: Rect;
  confidence: number;
};

type AmountMatch = {
  start: number;
  end: number;
  valueCents: number;
  sourceText: string;
  words: OcrWord[];
  box: Rect;
  confidence: number;
};

type FinalTotal = {
  amount: AmountMatch;
  label: LabelMatch;
};

type AmountForLabel =
  | { state: 'match'; amount: AmountMatch }
  | { state: 'ambiguous' }
  | { state: 'missing' };

const FINAL_LABELS = ['order total', 'grand total', 'total'] as const;
const PURCHASE_PHRASES = ['buy now', 'place order', 'complete purchase', 'checkout'] as const;
const EXCLUDED_WORDS = new Set(['subtotal', 'savings', 'saving', 'discount', 'original']);

function isFiniteBox(box: Rect): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width >= 0 && box.height >= 0;
}

function isUsableWord(word: OcrWord): boolean {
  return typeof word.text === 'string'
    && word.text.trim().length > 0
    && Number.isFinite(word.confidence)
    && isFiniteBox(word.box);
}

function normalizeAlpha(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z]+/g, '');
}

function tokenize(words: OcrWord[]): Token[] {
  const tokens: Token[] = [];

  for (const word of words) {
    for (const raw of word.text.trim().split(/\s+/u)) {
      if (!raw) continue;
      tokens.push({ raw, normalized: normalizeAlpha(raw), word });
    }
  }

  return tokens;
}

function unionBox(boxes: Rect[]): Rect {
  if (boxes.length === 0) {
    throw new Error('Cannot union an empty set of OCR boxes');
  }

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function confidence(words: OcrWord[]): number {
  return Math.min(...words.map((word) => Math.max(0, Math.min(100, word.confidence))));
}

function lineMatches(tokens: Token[], phrases: readonly string[]): LabelMatch[] {
  const matches: LabelMatch[] = [];
  const orderedPhrases = [...phrases].sort((left, right) => right.split(' ').length - left.split(' ').length);

  for (let start = 0; start < tokens.length; start += 1) {
    for (const phrase of orderedPhrases) {
      const expected = phrase.split(' ');
      const end = start + expected.length;
      if (end > tokens.length) continue;
      if (!expected.every((part, offset) => tokens[start + offset].normalized === part)) continue;

      const words = tokens.slice(start, end).map((token) => token.word);
      matches.push({
        start,
        end,
        words,
        box: unionBox(words.map((word) => word.box)),
        confidence: confidence(words),
      });
      break;
    }
  }

  // "Order total" also contains the one-word "total" match. Keep the most
  // specific label so one visual total is never counted twice.
  return matches.filter((match, index) => !matches.some((other, otherIndex) => (
    otherIndex !== index
    && other.start <= match.start
    && other.end >= match.end
    && (other.end - other.start) > (match.end - match.start)
  )));
}

function isUnsupportedCurrency(text: string): boolean {
  return /€|£|¥|₹|₽|\b(?:eur|euro|gbp|pound|jpy|yen|cad|aud)\b/iu.test(text);
}

function isInstallmentOnly(tokens: Token[]): boolean {
  const text = tokens.map((token) => token.raw).join(' ').toLocaleLowerCase('en-US');
  return /\binstallments?\b|\bpayments?\b|\bper\s+month\b|\/\s*(?:mo|month)\b|\bsplit\s+into\b/iu.test(text);
}

function hasExcludedContext(tokens: Token[]): boolean {
  return tokens.some((token) => EXCLUDED_WORDS.has(token.normalized));
}

function parseUsdAmount(text: string): number | null {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  const match = /^(?:\$|USD\s*)?((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) return null;

  const whole = BigInt(match[1].replace(/,/gu, ''));
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  const cents = whole * 100n + fraction;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

function amountMatches(tokens: Token[]): AmountMatch[] {
  const matches: AmountMatch[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const direct = parseUsdAmount(token.raw);
    if (direct !== null) {
      const key = `${index}:${index + 1}:${direct}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          start: index,
          end: index + 1,
          valueCents: direct,
          sourceText: token.raw,
          words: [token.word],
          box: token.word.box,
          confidence: token.word.confidence,
        });
      }
      continue;
    }

    // OCR engines occasionally return "$" and "200.00" as separate words.
    if (token.raw === '$' && tokens[index + 1]) {
      const next = parseUsdAmount(tokens[index + 1].raw);
      if (next !== null) {
        const key = `${index}:${index + 2}:${next}`;
        if (!seen.has(key)) {
          seen.add(key);
          const words = [token.word, tokens[index + 1].word];
          matches.push({
            start: index,
            end: index + 2,
            valueCents: next,
            sourceText: `${token.raw}${tokens[index + 1].raw}`,
            words,
            box: unionBox(words.map((word) => word.box)),
            confidence: confidence(words),
          });
        }
      }
    }

    // OCR may split a "USD 200.00" prefix into two words.
    if (/^USD$/iu.test(token.raw) && tokens[index + 1]) {
      const next = parseUsdAmount(`USD ${tokens[index + 1].raw}`);
      if (next !== null) {
        const key = `${index}:${index + 2}:${next}`;
        if (!seen.has(key)) {
          seen.add(key);
          const words = [token.word, tokens[index + 1].word];
          matches.push({
            start: index,
            end: index + 2,
            valueCents: next,
            sourceText: `${token.raw} ${tokens[index + 1].raw}`,
            words,
            box: unionBox(words.map((word) => word.box)),
            confidence: confidence(words),
          });
        }
      }
    }
  }

  return matches;
}

function isCrossedOut(word: OcrWord): boolean {
  const metadata = word as OcrWord & { crossedOut?: boolean; strikeThrough?: boolean; struckThrough?: boolean };
  return metadata.crossedOut === true || metadata.strikeThrough === true || metadata.struckThrough === true;
}

function amountForLabel(tokens: Token[], label: LabelMatch): AmountForLabel {
  const amounts = amountMatches(tokens).filter((amount) => !amount.words.some(isCrossedOut));

  // Prefer the amount immediately following the label. This prevents a line
  // such as "Subtotal $100 Total $120" from treating $100 as the final total.
  const after = amounts.filter((amount) => amount.start >= label.end && amount.start - label.end <= 3);
  const before = amounts.filter((amount) => amount.end <= label.start && label.start - amount.end <= 3);
  const nearby = after.length > 0 ? after : before;

  if (nearby.length === 0) return { state: 'missing' };
  if (nearby.length > 1) return { state: 'ambiguous' };
  return { state: 'match', amount: nearby[0] };
}

function boxDistance(point: { x: number; y: number }, box: Rect): number {
  const dx = point.x < box.x ? box.x - point.x : point.x > box.x + box.width ? point.x - (box.x + box.width) : 0;
  const dy = point.y < box.y ? box.y - point.y : point.y > box.y + box.height ? point.y - (box.y + box.height) : 0;
  return Math.hypot(dx, dy);
}

function candidate(
  state: PurchaseCandidateState,
  reason: PurchaseCandidateReason,
  total: FinalTotal | null = null,
  buttonBox: Rect | null = null,
  sourceText = '',
): PurchaseCandidate {
  return {
    amountCents: total?.amount.valueCents ?? null,
    sourceText: sourceText || total?.amount.sourceText || '',
    state,
    buttonBox,
    totalBox: total?.amount.box ?? null,
    reason,
  };
}

/**
 * Extract a reviewable checkout total from already-recognized words.
 *
 * The function intentionally has no screen-wide heuristics: only a final
 * total label and an exact purchase phrase can produce a candidate. In
 * particular, a bare price or a subtotal never becomes an automatic preview.
 */
export function extractPurchase(
  words: OcrWord[],
  cursorInImage: { x: number; y: number },
  options: ExtractionOptions = {},
): PurchaseCandidate {
  if (options.frameAgeMs !== undefined && (!Number.isFinite(options.frameAgeMs) || options.frameAgeMs > MAX_FRAME_AGE_MS || options.frameAgeMs < 0)) {
    return candidate('no-candidate', 'stale-frame');
  }

  const usableWords = words.filter(isUsableWord);
  if (!Number.isFinite(cursorInImage.x) || !Number.isFinite(cursorInImage.y) || usableWords.length === 0) {
    return candidate('no-candidate', 'missing-total');
  }

  const lineMap = new Map<string, OcrWord[]>();
  for (const word of usableWords) {
    const line = lineMap.get(word.lineId) ?? [];
    line.push(word);
    lineMap.set(word.lineId, line);
  }

  const totals: FinalTotal[] = [];
  let sawAmbiguousTotal = false;
  let sawFinalLabel = false;
  let sawUnsupportedFinalCurrency = false;
  const buttons: LabelMatch[] = [];

  for (const lineWords of lineMap.values()) {
    lineWords.sort((left, right) => left.box.x - right.box.x);
    const tokens = tokenize(lineWords);
    const finalLabels = lineMatches(tokens, FINAL_LABELS);
    const purchaseLabels = lineMatches(tokens, PURCHASE_PHRASES);
    buttons.push(...purchaseLabels);

    if (finalLabels.length === 0) continue;
    sawFinalLabel = true;

    if (tokens.some((token) => isUnsupportedCurrency(token.raw))) {
      sawUnsupportedFinalCurrency = true;
      continue;
    }
    if (isInstallmentOnly(tokens)) continue;

    for (const label of finalLabels) {
      if (hasExcludedContext(tokens)) continue;
      const amount = amountForLabel(tokens, label);
      if (amount.state === 'ambiguous') {
        // Two plausible amounts on one final-total line are ambiguous even if
        // one happens to be the larger value.
        sawAmbiguousTotal = true;
      } else if (amount.state === 'match') {
        totals.push({ amount: amount.amount, label });
      }
    }
  }

  if (sawUnsupportedFinalCurrency && totals.length === 0) {
    return candidate('no-candidate', 'unsupported-currency');
  }
  if (!sawFinalLabel || totals.length === 0) {
    return candidate('no-candidate', sawUnsupportedFinalCurrency ? 'unsupported-currency' : 'missing-total');
  }

  if (sawAmbiguousTotal || totals.length !== 1) {
    const sourceText = totals.map((total) => total.amount.sourceText).filter(Boolean).join(', ');
    return candidate('confirm', 'ambiguous', null, null, sourceText);
  }

  const total = totals[0];
  const scale = options.dipToImageScale !== undefined && Number.isFinite(options.dipToImageScale) && options.dipToImageScale > 0
    ? options.dipToImageScale
    : 1;
  const maxDistance = MAX_CURSOR_DISTANCE_DIP * scale;
  const associatedButtons = buttons
    .map((button) => ({ button, distance: boxDistance(cursorInImage, button.box) }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);

  if (buttons.length === 0) {
    return candidate('no-candidate', 'missing-button');
  }
  if (associatedButtons.length === 0) {
    return candidate('confirm', 'missing-button', total);
  }
  if (associatedButtons.length > 1 && associatedButtons[0].distance === associatedButtons[1].distance) {
    return candidate('confirm', 'ambiguous', total, null);
  }

  const button = associatedButtons[0].button;
  if (Math.min(total.amount.confidence, total.label.confidence, button.confidence) < AUTO_PREVIEW_CONFIDENCE) {
    return candidate('confirm', 'low-confidence', total, button.box);
  }

  return candidate('preview', 'single-total', total, button.box);
}
