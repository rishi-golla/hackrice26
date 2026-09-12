import { describe, expect, it } from 'vitest';
import { extractPurchase } from '../../src/desktop/extract';
import type { CursorSample, Frame, OcrWord } from '../../src/desktop/types';

const frame = (capturedAt = 7_000): Frame => ({
  id: 'checkout-frame',
  capturedAt,
  displayId: 'left',
  bounds: { x: -1_000, y: 0, width: 1_000, height: 500 },
  workArea: { x: -1_000, y: 0, width: 1_000, height: 480 },
  imageWidth: 2_000,
  imageHeight: 1_000,
  png: new Uint8Array(),
});

const cursor = (x = -760, y = 210, displayId = 'left'): CursorSample => ({ x, y, displayId, at: 10_000 });

const word = (text: string, lineId: string, x: number, y: number, confidence = 99, width = 100): OcrWord => ({
  text,
  confidence,
  lineId,
  box: { x, y, width, height: 40 },
});

const checkoutWords = (total = '$1,234.56'): OcrWord[] => [
  word('Order', 'total', 200, 100, 99, 50),
  word('Total', 'total', 255, 100, 99, 55),
  word(total, 'total', 320, 100, 99, 120),
  word('Place', 'button', 400, 400, 99, 70),
  word('Order', 'button', 480, 400, 99, 70),
];

describe('extractPurchase', () => {
  it('previews one fresh USD final total associated with the cursor', () => {
    expect(extractPurchase(checkoutWords(), frame(), cursor(), 10_000)).toEqual({
      amountCents: 123_456,
      sourceText: 'Order Total $1,234.56',
      state: 'preview',
      reason: 'single-total',
      totalBox: { x: -900, y: 50, width: 120, height: 20 },
      buttonBox: { x: -800, y: 200, width: 75, height: 20 },
    });
  });

  it('does not treat a subtotal as a final total', () => {
    const words = [
      word('Subtotal', 'subtotal', 200, 100, 99),
      word('$200.00', 'subtotal', 310, 100, 99),
      word('Checkout', 'button', 400, 400, 99),
    ];

    expect(extractPurchase(words, frame(), cursor(), 10_000)).toMatchObject({
      amountCents: null,
      state: 'confirm',
      reason: 'missing-total',
    });
  });

  it('requires confirmation when final totals conflict', () => {
    const words = [
      ...checkoutWords('$200.00'),
      word('Grand', 'other-total', 200, 200, 99, 60),
      word('Total', 'other-total', 270, 200, 99, 60),
      word('$250.00', 'other-total', 340, 200, 99, 110),
    ];

    expect(extractPurchase(words, frame(), cursor(), 10_000)).toMatchObject({
      amountCents: null,
      state: 'confirm',
      reason: 'ambiguous',
    });
  });

  it('treats repeated equal totals as one value', () => {
    const words = [
      ...checkoutWords('$200.00'),
      word('Total', 'repeat', 200, 200, 99, 80),
      word('$200.00', 'repeat', 290, 200, 99, 110),
    ];

    expect(extractPurchase(words, frame(), cursor(), 10_000)).toMatchObject({
      amountCents: 20_000,
      state: 'preview',
      reason: 'single-total',
    });
  });

  it.each(['€200.00', 'EUR 200.00', '£200.00'])('rejects unsupported currency %s', (amount) => {
    expect(extractPurchase(checkoutWords(amount), frame(), cursor(), 10_000)).toMatchObject({
      amountCents: null,
      state: 'no-candidate',
      reason: 'unsupported-currency',
    });
  });

  it('returns no candidate when no purchase phrase is present', () => {
    expect(extractPurchase(checkoutWords().slice(0, 3), frame(), cursor(), 10_000)).toMatchObject({
      state: 'no-candidate',
      reason: 'missing-button',
    });
  });

  it('requires confirmation for a stale frame', () => {
    expect(extractPurchase(checkoutWords(), frame(6_999), cursor(), 10_000)).toMatchObject({
      amountCents: 123_456,
      state: 'confirm',
      reason: 'low-confidence',
    });
  });

  it('requires confirmation at confidence 89', () => {
    const words = checkoutWords();
    words[3] = { ...words[3], confidence: 89 };
    expect(extractPurchase(words, frame(), cursor(), 10_000)).toMatchObject({
      amountCents: 123_456,
      state: 'confirm',
      reason: 'low-confidence',
    });
  });

  it('requires confirmation when the matching purchase phrase is more than 80 DIP away', () => {
    expect(extractPurchase(checkoutWords(), frame(), cursor(-990, 490), 10_000)).toMatchObject({
      amountCents: 123_456,
      state: 'confirm',
      reason: 'missing-button',
    });
  });

  it('does not multiply installment-only prices into a total', () => {
    const words = [
      word('or', 'installment', 100, 100, 99, 30),
      word('4', 'installment', 140, 100, 99, 20),
      word('payments', 'installment', 170, 100, 99, 100),
      word('of', 'installment', 280, 100, 99, 30),
      word('$50.00', 'installment', 320, 100, 99, 100),
      word('Buy', 'button', 400, 400, 99, 50),
      word('Now', 'button', 460, 400, 99, 50),
    ];

    expect(extractPurchase(words, frame(), cursor(), 10_000)).toMatchObject({
      amountCents: null,
      state: 'confirm',
      reason: 'missing-total',
    });
  });

  it('ignores an unrelated nearby price when a labeled total exists', () => {
    const words = [...checkoutWords('$200.00'), word('$9.99', 'ad', 450, 360, 99, 80)];
    expect(extractPurchase(words, frame(), cursor(), 10_000)).toMatchObject({
      amountCents: 20_000,
      state: 'preview',
    });
  });
});
