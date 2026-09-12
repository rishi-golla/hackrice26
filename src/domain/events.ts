import { addDays, addMonthsClamped, parseISODate } from './calendar';
import type { CashEvent } from './types';
import { validateCashEvent } from './types';

const HORIZON_DAYS = 14;

function monthDifference(from: string, to: string): number {
  const first = parseISODate(from);
  const second = parseISODate(to);
  return (second.year - first.year) * 12 + second.month - first.month;
}

function occurrence(event: CashEvent, date: string): CashEvent {
  if (date === event.date) return { ...event };
  return { ...event, id: `${event.id}@${date}`, date };
}

export function normalizeEvents(events: CashEvent[], today: string): CashEvent[] {
  parseISODate(today);
  const horizonEnd = addDays(today, HORIZON_DAYS - 1);
  const seenSourceRecords = new Set<string>();
  const seenOccurrences = new Set<string>();
  const normalized: CashEvent[] = [];

  for (const rawEvent of events) {
    const event = validateCashEvent(rawEvent);
    if (event.cancelled || event.reflectedInBalance || event.confidence === 'unconfirmed') continue;

    const sourceRecordKey = `${event.sourceId}\u0000${event.date}`;
    if (seenSourceRecords.has(sourceRecordKey)) continue;
    seenSourceRecords.add(sourceRecordKey);

    const dates: string[] = [];
    if (event.recurrence === 'monthly') {
      let month = Math.max(0, monthDifference(event.date, today) - 1);
      for (;;) {
        const date = addMonthsClamped(event.date, month);
        if (date > horizonEnd) break;
        if (date >= today) dates.push(date);
        month += 1;
      }
    } else if (event.date >= today && event.date <= horizonEnd) {
      dates.push(event.date);
    }

    for (const date of dates) {
      const occurrenceKey = `${event.sourceId}\u0000${date}`;
      if (seenOccurrences.has(occurrenceKey)) continue;
      seenOccurrences.add(occurrenceKey);
      normalized.push(occurrence(event, date));
    }
  }

  return normalized.sort((left, right) => (
    left.date.localeCompare(right.date)
    || Number(left.cents >= 0) - Number(right.cents >= 0)
    || left.id.localeCompare(right.id)
  ));
}

export function overdueUnreflectedEvents(events: CashEvent[], today: string): CashEvent[] {
  parseISODate(today);
  return events
    .map(validateCashEvent)
    .filter(event => (
      event.date < today
      && !event.cancelled
      && !event.reflectedInBalance
      && event.confidence !== 'unconfirmed'
    ));
}
