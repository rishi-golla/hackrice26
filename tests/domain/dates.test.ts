import { describe, expect, it } from 'vitest';
import { resolveConversationDate } from '../../src/domain/date-resolver.js';

describe('conversation date resolution', () => {
  it('resolves next weekday phrases against the snapshot date', () => {
    expect(resolveConversationDate('next Saturday', '2026-09-12')).toBe('2026-09-19');
    expect(resolveConversationDate('next Sunday', '2026-09-12')).toBe('2026-09-20');
  });

  it('resolves a bare weekday including today and rejects out-of-scope text', () => {
    expect(resolveConversationDate('Saturday', '2026-09-12')).toBe('2026-09-12');
    expect(resolveConversationDate('Friday', '2026-09-12')).toBe('2026-09-18');
    expect(resolveConversationDate('next month', '2026-09-12')).toBeUndefined();
  });
});
