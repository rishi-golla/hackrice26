import { describe, expect, it } from 'vitest';
import { extractPurchase, type OcrWord } from '../../src/desktop/ocr/extract';

function word(text: string, x: number, y = 0, lineId = `${y}`, confidence = 99): OcrWord {
  return {
    text,
    confidence,
    lineId,
    box: { x, y, width: Math.max(20, text.length * 8), height: 20 },
  };
}

describe('purchase candidate extraction', () => {
  it('does not treat a subtotal as a final total', () => {
    const words = [
      word('Subtotal', 0),
      word('$200.00', 80),
      word('Buy', 0, 50, 'button'),
      word('now', 35, 50, 'button'),
    ];

    expect(extractPurchase(words, { x: 20, y: 50 }).state).toBe('no-candidate');
    expect(extractPurchase(words, { x: 20, y: 50 }).reason).toBe('missing-total');
  });

  it('previews one fresh, high-confidence final total associated with the cursor', () => {
    const words = [
      word('Order', 0),
      word('Total', 55),
      word('$200.00', 115),
      word('Buy', 0, 50, 'button'),
      word('now', 35, 50, 'button'),
    ];

    expect(extractPurchase(words, { x: 20, y: 50 }, { frameAgeMs: 100 })).toEqual({
      amountCents: 20_000,
      sourceText: '$200.00',
      state: 'preview',
      buttonBox: { x: 0, y: 50, width: 59, height: 20 },
      totalBox: { x: 115, y: 0, width: 56, height: 20 },
      reason: 'single-total',
    });
  });

  it('uses the final total when a subtotal is also present', () => {
    const words = [
      word('Subtotal', 0),
      word('$180.00', 80),
      word('Total', 0, 30, 'total'),
      word('$200.00', 55, 30, 'total'),
      word('Checkout', 0, 70, 'button'),
    ];

    const result = extractPurchase(words, { x: 20, y: 70 });
    expect(result.state).toBe('preview');
    expect(result.amountCents).toBe(20_000);
  });

  it('requires confirmation when final totals conflict', () => {
    const words = [
      word('Total', 0, 0, 'first'),
      word('$200.00', 50, 0, 'first'),
      word('Total', 0, 30, 'second'),
      word('$220.00', 50, 30, 'second'),
      word('Buy', 0, 70, 'button'),
      word('now', 35, 70, 'button'),
    ];

    const result = extractPurchase(words, { x: 20, y: 70 });
    expect(result.state).toBe('confirm');
    expect(result.reason).toBe('ambiguous');
    expect(result.amountCents).toBeNull();
    expect(result.sourceText).toBe('$200.00, $220.00');
  });

  it('requires confirmation for repeated equal totals rather than silently choosing one', () => {
    const words = [
      word('Grand', 0, 0, 'first'),
      word('Total', 45, 0, 'first'),
      word('$200.00', 100, 0, 'first'),
      word('Total', 0, 30, 'second'),
      word('$200.00', 50, 30, 'second'),
      word('Place', 0, 70, 'button'),
      word('Order', 45, 70, 'button'),
    ];

    expect(extractPurchase(words, { x: 20, y: 70 }).reason).toBe('ambiguous');
  });

  it('rejects unsupported euro totals instead of converting them', () => {
    const words = [
      word('Total', 0),
      word('€200.00', 50),
      word('Checkout', 0, 50, 'button'),
    ];

    const result = extractPurchase(words, { x: 20, y: 50 });
    expect(result.state).toBe('no-candidate');
    expect(result.reason).toBe('unsupported-currency');
    expect(result.amountCents).toBeNull();
  });

  it('returns no candidate when the purchase phrase is missing', () => {
    const result = extractPurchase([
      word('Total', 0),
      word('$200.00', 50),
    ], { x: 20, y: 0 });

    expect(result.state).toBe('no-candidate');
    expect(result.reason).toBe('missing-button');
    expect(result.amountCents).toBeNull();
  });

  it('returns confirmation when a purchase phrase exists but is not cursor-associated', () => {
    const result = extractPurchase([
      word('Total', 0),
      word('$200.00', 50),
      word('Buy', 500, 0, 'button'),
      word('Now', 535, 0, 'button'),
    ], { x: 0, y: 0 });

    expect(result.state).toBe('confirm');
    expect(result.reason).toBe('missing-button');
    expect(result.amountCents).toBe(20_000);
    expect(result.buttonBox).toBeNull();
  });

  it('requires confirmation for low-confidence OCR', () => {
    const result = extractPurchase([
      word('Total', 0, 0, 'total', 99),
      word('$200.00', 50, 0, 'total', 88),
      word('Checkout', 0, 50, 'button', 99),
    ], { x: 20, y: 50 });

    expect(result.state).toBe('confirm');
    expect(result.reason).toBe('low-confidence');
    expect(result.amountCents).toBe(20_000);
  });

  it('rejects stale captured frames before extracting an amount', () => {
    const result = extractPurchase([
      word('Total', 0),
      word('$200.00', 50),
      word('Buy', 0, 50, 'button'),
      word('Now', 35, 50, 'button'),
    ], { x: 20, y: 50 }, { frameAgeMs: 3_001 });

    expect(result).toEqual({
      amountCents: null,
      sourceText: '',
      state: 'no-candidate',
      buttonBox: null,
      totalBox: null,
      reason: 'stale-frame',
    });
  });

  it('does not use a nearby unrelated price or installment amount', () => {
    expect(extractPurchase([
      word('$200.00', 0),
      word('Buy', 0, 50, 'button'),
      word('Now', 35, 50, 'button'),
    ], { x: 20, y: 50 }).reason).toBe('missing-total');

    expect(extractPurchase([
      word('Total', 0),
      word('4', 0),
      word('payments', 15),
      word('of', 90),
      word('$50.00', 110),
      word('Checkout', 0, 50, 'button'),
    ], { x: 20, y: 50 }).reason).toBe('missing-total');
  });
});
