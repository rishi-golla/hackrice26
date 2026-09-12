const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DateParts = { year: number; month: number; day: number };

export function parseISODate(value: string): DateParts {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Invalid ISO date: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return { year, month, day };
}

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(value: string, days: number): string {
  const { year, month, day } = parseISODate(value);
  if (!Number.isSafeInteger(days)) throw new Error('Days must be a safe integer');
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function addMonthsClamped(value: string, months: number): string {
  const { year, month, day } = parseISODate(value);
  if (!Number.isSafeInteger(months)) throw new Error('Months must be a safe integer');

  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
    .toISOString().slice(0, 10);
}
