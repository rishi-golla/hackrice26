const USD = /^\$?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d{2}))?$/;

export function parseUSD(text: string): number {
  const normalized = text.trim();
  const match = USD.exec(normalized);
  if (!match) throw new Error('Invalid USD amount');

  const numeric = normalized.replace(/^\$/, '').replaceAll(',', '');
  const [dollars, fraction = '00'] = numeric.split('.');
  const cents = BigInt(dollars) * 100n + BigInt(fraction);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('USD cents exceed the safe integer range');
  return Number(cents);
}

export function assertSafeCents(value: number, name: string, options: { positive?: boolean; nonnegative?: boolean } = {}): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer number of cents`);
  if (options.positive && value <= 0) throw new Error(`${name} must be a positive safe integer number of cents`);
  if (options.nonnegative && value < 0) throw new Error(`${name} must be a nonnegative safe integer number of cents`);
}

export function addCents(left: number, right: number): number {
  assertSafeCents(left, 'Left operand');
  assertSafeCents(right, 'Right operand');
  const result = left + right;
  assertSafeCents(result, 'Cents result');
  return result;
}

export function formatUSD(cents: number): string {
  assertSafeCents(cents, 'Amount');
  const sign = cents < 0 ? '-' : '';
  const absolute = BigInt(cents < 0 ? -cents : cents);
  return `${sign}$${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
