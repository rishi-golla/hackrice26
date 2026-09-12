const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addCalendarDays(value: string, days: number): string {
  if (!isISODate(value) || !Number.isInteger(days)) {
    throw new Error('Expected a valid ISO date and integer day offset.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateInInclusiveRange(value: string, start: string, end: string): boolean {
  return isISODate(value) && isISODate(start) && isISODate(end) && value >= start && value <= end;
}
