import { z } from 'zod';

import { isISODate } from '../../domain/calendar';
import type { CashEvent, Snapshot } from '../../domain/types';
import { validateCashEvent, validateSnapshot } from '../../domain/types';

export type NessieAmountUnit = 'dollars' | 'cents';

export type NessieNormalizeOptions = {
  amountUnit: NessieAmountUnit;
  today: string;
  timezone: string;
  now?: () => string;
};

export type NessieAccount = {
  _id: string;
  balance: number;
  rewards?: number;
  type?: string;
  nickname?: string;
  account_number?: string;
  customer_id?: string;
};

export type NessieBill = {
  _id: string;
  status: string;
  payee?: string;
  nickname?: string;
  payment_date?: string;
  upcoming_payment_date?: string;
  recurring_date?: number;
  payment_amount: number;
  account_id: string;
};

export type NessieDeposit = {
  _id: string;
  medium: string;
  transaction_date: string;
  status: string;
  amount: number;
  description?: string;
};

export type NessieWithdrawal = NessieDeposit;

export type NessieLoan = {
  _id: string;
  status: string;
  monthly_payment: number;
  amount: number;
  description?: string;
  creation_date: string;
  type?: string;
  credit_score?: number;
};

const text = z.string().trim().min(1);
const money = z.number().finite().nonnegative();
const isoDate = text.refine(isISODate, 'must be a valid ISO date');

const accountSchema = z.object({
  _id: text,
  balance: money,
  rewards: money.optional(),
  type: text.optional(),
  nickname: text.optional(),
  account_number: text.optional(),
  customer_id: text.optional(),
});

const billSchema = z.object({
  _id: text,
  status: text,
  payee: text.optional(),
  nickname: text.optional(),
  payment_date: isoDate.optional(),
  upcoming_payment_date: isoDate.optional(),
  recurring_date: z.number().int().min(1).max(31).optional(),
  payment_amount: money,
  account_id: text,
}).refine(bill => bill.upcoming_payment_date !== undefined || bill.payment_date !== undefined, {
  message: 'bill must include a valid ISO date',
});

const transactionSchema = z.object({
  _id: text,
  medium: text,
  transaction_date: isoDate,
  status: text,
  amount: money,
  description: text.optional(),
});

const loanSchema = z.object({
  _id: text,
  status: text,
  monthly_payment: money,
  amount: money,
  description: text.optional(),
  creation_date: isoDate,
  type: text.optional(),
  credit_score: z.number().finite().optional(),
});

const normalizeInputSchema = z.object({
  accountId: text,
  account: accountSchema,
  bills: z.array(billSchema),
  deposits: z.array(transactionSchema),
  withdrawals: z.array(transactionSchema),
  loans: z.array(loanSchema),
  complete: z.boolean(),
  sourceEndpoints: z.array(text),
});

export function toCents(value: number, unit: NessieAmountUnit): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Nessie money value must be a finite nonnegative amount');
  }
  const cents = unit === 'dollars' ? value * 100 : value;
  if (!Number.isSafeInteger(cents)) throw new Error('Nessie money value must convert to safe integer cents');
  return cents;
}

function statusIs(status: string, ...values: string[]): boolean {
  return values.includes(status.toLowerCase());
}

function safeLabel(candidate: string | undefined, fallback: string, accountNumber: string | undefined): string {
  if (!candidate || (accountNumber && candidate.includes(accountNumber))) return fallback;
  return candidate;
}

function event(input: CashEvent): CashEvent {
  return validateCashEvent(input);
}

function transactionEvent(
  record: NessieDeposit,
  accountNumber: string | undefined,
  amountUnit: NessieAmountUnit,
  kind: 'income' | 'expense',
): CashEvent {
  const cancelled = statusIs(record.status, 'cancelled', 'canceled');
  return event({
    id: `nessie:${kind}:${record._id}`,
    sourceId: record._id,
    date: record.transaction_date,
    cents: (kind === 'income' ? 1 : -1) * toCents(record.amount, amountUnit),
    label: safeLabel(record.description, kind === 'income' ? 'Deposit' : 'Withdrawal', accountNumber),
    kind,
    confidence: statusIs(record.status, 'pending', 'scheduled') ? 'scheduled' : 'unconfirmed',
    reflectedInBalance: statusIs(record.status, 'completed', 'posted'),
    cancelled,
  });
}

export function normalizeNessieSnapshot(
  rawInput: {
    accountId: string;
    account: NessieAccount;
    bills: NessieBill[];
    deposits: NessieDeposit[];
    withdrawals: NessieWithdrawal[];
    loans: NessieLoan[];
    complete: boolean;
    sourceEndpoints: string[];
  },
  options: NessieNormalizeOptions,
): Snapshot {
  const input = normalizeInputSchema.parse(rawInput);
  const accountNumber = input.account.account_number;
  const billEvents = input.bills.map(bill => event({
    id: `nessie:bill:${bill._id}`,
    sourceId: bill._id,
    date: bill.upcoming_payment_date ?? bill.payment_date!,
    cents: -toCents(bill.payment_amount, options.amountUnit),
    label: safeLabel(bill.nickname ?? bill.payee, 'Bill', accountNumber),
    kind: 'bill',
    confidence: 'scheduled',
    reflectedInBalance: statusIs(bill.status, 'completed', 'paid'),
    cancelled: statusIs(bill.status, 'cancelled', 'canceled'),
    ...(bill.recurring_date !== undefined || statusIs(bill.status, 'recurring')
      ? { recurrence: 'monthly' as const }
      : {}),
  }));
  const depositEvents = input.deposits.map(record => transactionEvent(
    record, accountNumber, options.amountUnit, 'income',
  ));
  const withdrawalEvents = input.withdrawals.map(record => transactionEvent(
    record, accountNumber, options.amountUnit, 'expense',
  ));
  const loanEvents = input.loans.map(loan => event({
    id: `nessie:loan:${loan._id}`,
    sourceId: loan._id,
    date: loan.creation_date,
    cents: -toCents(loan.monthly_payment, options.amountUnit),
    label: safeLabel(loan.description, 'Loan payment', accountNumber),
    kind: 'bill',
    confidence: 'scheduled',
    reflectedInBalance: statusIs(loan.status, 'completed', 'paid'),
    cancelled: statusIs(loan.status, 'cancelled', 'canceled', 'rejected'),
    recurrence: 'monthly',
  }));

  return validateSnapshot({
    accountId: input.accountId,
    balanceCents: toCents(input.account.balance, options.amountUnit),
    currency: 'USD',
    asOf: options.now?.() ?? new Date().toISOString(),
    today: options.today,
    timezone: options.timezone,
    mode: 'live-sandbox',
    complete: input.complete,
    stale: false,
    sources: [...new Set(input.sourceEndpoints)].sort(),
    events: [...depositEvents, ...withdrawalEvents, ...billEvents, ...loanEvents],
  });
}
