import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

export type AmountFormProps = {
  amountCents: number;
  onAmountChange: (cents: number) => void;
};

function formatInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(/^\$/u, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/u.test(normalized)) return null;

  const [wholeWithGrouping, fraction = ''] = normalized.split('.');
  const whole = wholeWithGrouping.replace(/,/gu, '');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents);
}

export function AmountForm({ amountCents, onAmountChange }: AmountFormProps): ReactElement {
  const [value, setValue] = useState(() => formatInput(amountCents));

  useEffect(() => {
    setValue(formatInput(amountCents));
  }, [amountCents]);

  function handleChange(nextValue: string): void {
    setValue(nextValue);
    const cents = parseAmount(nextValue);
    if (cents !== null) onAmountChange(cents);
  }

  return (
    <label className="amount-form">
      <span className="sr-only">Purchase amount</span>
      <span className="amount-form__currency">$</span>
      <input
        aria-label="Purchase amount"
        inputMode="decimal"
        name="purchase-amount"
        onChange={(event) => handleChange(event.target.value)}
        pattern="[0-9]+([.][0-9]{1,2})?"
        type="text"
        value={value}
      />
    </label>
  );
}
