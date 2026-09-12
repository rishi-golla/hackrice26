import { addCalendarDays, isISODate } from './dates.js';

const WEEKDAYS = new Map([
  ['sunday', 0],
  ['monday', 1],
  ['tuesday', 2],
  ['wednesday', 3],
  ['thursday', 4],
  ['friday', 5],
  ['saturday', 6],
]);

export function resolveConversationDate(phrase: string, today: string): string | undefined {
  if (!isISODate(today)) {
    throw new Error('Snapshot today must be a valid ISO date.');
  }
  const normalized = phrase.trim().toLowerCase();
  if (isISODate(normalized)) {
    return normalized;
  }
  const match = /^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(normalized);
  if (!match) {
    return undefined;
  }
  const targetDay = WEEKDAYS.get(match[2]!);
  const currentDay = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  let offset = (targetDay! - currentDay + 7) % 7;
  if (match[1] && offset === 0) {
    offset = 7;
  } else if (match[1]) {
    offset += 7;
  }
  return addCalendarDays(today, offset);
}
