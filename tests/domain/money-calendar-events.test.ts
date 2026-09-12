import { describe, expect, it } from 'vitest';

import { addDays } from '../../src/domain/calendar';
import { normalizeEvents } from '../../src/domain/events';
import { parseUSD } from '../../src/domain/money';
import type { CashEvent } from '../../src/domain/types';

const event = (overrides: Partial<CashEvent> = {}): CashEvent => ({
  id: 'event-1',
  sourceId: 'source-1',
  date: '2026-09-12',
  cents: -100,
  label: 'Bill',
  kind: 'bill',
  confidence: 'scheduled',
  reflectedInBalance: false,
  cancelled: false,
  ...overrides,
});

describe('parseUSD', () => {
  it.each([
    ['$1,234.56', 123456],
    ['1234.56', 123456],
    ['$0.00', 0],
    ['$10', 1000],
  ])('parses strict USD input %s', (input, expected) => {
    expect(parseUSD(input)).toBe(expected);
  });

  it.each(['-$1.00', '€1.00', '$1,23.00', '$1.2', '$01.00', '$9,007,199,254,740,992.00'])
    ('rejects malformed or unsafe input %s', (input) => {
      expect(() => parseUSD(input)).toThrow();
    });
});

describe('addDays', () => {
  it('adds calendar days across leap day without local timezone arithmetic', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
  });

  it('rejects impossible ISO dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
});

describe('normalizeEvents', () => {
  it('includes day 13 and excludes day 14', () => {
    const result = normalizeEvents([
      event({ id: 'day-13', sourceId: 'day-13', date: '2026-09-25' }),
      event({ id: 'day-14', sourceId: 'day-14', date: '2026-09-26' }),
    ], '2026-09-12');

    expect(result.map(item => item.id)).toEqual(['day-13']);
  });

  it('excludes reflected, cancelled, historical, and unconfirmed events', () => {
    const result = normalizeEvents([
      event({ id: 'reflected', sourceId: 'reflected', reflectedInBalance: true }),
      event({ id: 'cancelled', sourceId: 'cancelled', cancelled: true }),
      event({ id: 'historical', sourceId: 'historical', date: '2026-09-11' }),
      event({ id: 'unconfirmed', sourceId: 'unconfirmed', confidence: 'unconfirmed' }),
      event({ id: 'kept', sourceId: 'kept' }),
    ], '2026-09-12');

    expect(result.map(item => item.id)).toEqual(['kept']);
  });

  it('deduplicates provider occurrences before expanding monthly recurrence', () => {
    const recurring = event({
      id: 'rent-a', sourceId: 'rent', date: '2026-08-31', recurrence: 'monthly',
    });
    const duplicate = { ...recurring, id: 'rent-duplicate' };

    const result = normalizeEvents([recurring, duplicate], '2026-09-25');

    expect(result.map(item => [item.sourceId, item.date])).toEqual([
      ['rent', '2026-09-30'],
    ]);
  });

  it('anchors month-end recurrence to the original day', () => {
    const result = normalizeEvents([
      event({ id: 'monthly', sourceId: 'monthly', date: '2024-01-31', recurrence: 'monthly' }),
    ], '2024-02-20');

    expect(result.map(item => item.date)).toEqual(['2024-02-29']);
  });
});
