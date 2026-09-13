#!/usr/bin/env python3
"""Generate a deterministic fictional financial cohort for the Flicky demo.

The output is intentionally local fixture data. It does not call Nessie and it
never writes credentials. All monetary values are integer cents.
"""

from __future__ import annotations

import argparse
import calendar
import json
import random
from datetime import date
from pathlib import Path


ARCHETYPES = (
    ("Steady Saver", 1.00, 0.47, 0.10, 0.22),
    ("High Rent", 1.05, 0.62, 0.16, 0.10),
    ("Growing Family", 1.20, 0.54, 0.12, 0.16),
    ("Early Career", 0.82, 0.50, 0.19, 0.08),
    ("Freelance Cushion", 1.35, 0.42, 0.14, 0.18),
)

NAMES = (
    "Alex Rivera", "Jordan Lee", "Taylor Brooks", "Morgan Patel", "Casey Nguyen",
    "Riley Morgan", "Avery Thompson", "Sam Carter", "Jamie Kim", "Drew Wilson",
    "Quinn Davis", "Cameron Singh", "Reese Martin", "Parker Chen", "Rowan Adams",
    "Emerson Clark", "Finley Shah", "Skyler Johnson", "Harper Garcia", "Blake Thomas",
)

CATEGORIES = ("Dining", "Transport", "Shopping", "Entertainment", "Health", "Travel")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--count", type=int, default=200)
    parser.add_argument("--as-of", dest="as_of", default="2026-09-13", help="ISO reference date")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("flicky-swift/leanring-buddy/financial-cohort.json"),
    )
    return parser.parse_args()


def month_start(value: date, offset: int) -> date:
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def clamp_cents(value: int, minimum: int = 0) -> int:
    return max(minimum, int(value / 100) * 100)


def add_month_transactions(
    rng: random.Random,
    transactions: list[dict[str, object]],
    month: date,
    income_cents: int,
    essential_cents: int,
    discretionary_cents: int,
) -> None:
    year, month_number = month.year, month.month
    days = calendar.monthrange(year, month_number)[1]

    def add(day: int, kind: str, category: str, cents: int, label: str) -> None:
        transactions.append(
            {
                "date": date(year, month_number, min(day, days)).isoformat(),
                "type": kind,
                "category": category,
                "label": label,
                "amountCents": cents,
            }
        )

    add(1, "salary", "Income", income_cents, "Monthly salary")

    rent = int(essential_cents * 0.60)
    utilities = int(essential_cents * 0.15)
    groceries = essential_cents - rent - utilities
    add(1, "bill", "Housing", -rent, "Rent")
    add(10, "bill", "Utilities", -utilities, "Utilities")
    add(15, "purchase", "Groceries", -groceries, "Groceries")

    purchase_count = rng.randint(4, 6)
    remaining = discretionary_cents
    for index in range(purchase_count):
        if index == purchase_count - 1:
            amount = remaining
        else:
            # Leave enough for the remaining purchases while keeping values
            # varied enough to make the generated history look real.
            lower = max(500, int(remaining / (purchase_count - index) * 0.45))
            upper = max(lower, int(remaining / (purchase_count - index) * 1.55))
            amount = min(remaining, rng.randint(lower, upper) // 100 * 100)
        remaining -= amount
        category = rng.choice(CATEGORIES)
        day = rng.randint(2, days)
        add(day, "purchase", category, -amount, category)

    # A paired internal transfer demonstrates that transfers are not spending.
    transfer = int(max(0, income_cents - essential_cents - discretionary_cents) * 0.20)
    if transfer:
        add(22, "transfer", "Internal transfer", -transfer, "To savings")
        add(22, "transfer", "Internal transfer", transfer, "From checking")


def build_profile(rng: random.Random, index: int, as_of: date) -> dict[str, object]:
    if index == 0:
        name = "Demo User"
        archetype_name = "Steady Saver"
        income_cents = 400_000
        essential_cents = 260_000
        discretionary_cents = 120_000
        opening_balance_cents = 300_000
    else:
        archetype_name, income_multiplier, essential_ratio, discretionary_ratio, savings_ratio = rng.choice(ARCHETYPES)
        income_cents = clamp_cents(rng.randint(2_400, 9_500) * 100 * income_multiplier)
        essential_cents = clamp_cents(income_cents * rng.uniform(essential_ratio - 0.04, essential_ratio + 0.04))
        discretionary_cents = clamp_cents(income_cents * rng.uniform(discretionary_ratio - 0.03, discretionary_ratio + 0.03))
        opening_balance_cents = clamp_cents(
            income_cents * rng.uniform(savings_ratio * 2.5, savings_ratio * 15.0), minimum=20_000
        )

    transactions: list[dict[str, object]] = []
    for offset in (-3, -2, -1):
        add_month_transactions(
            rng,
            transactions,
            month_start(as_of, offset),
            income_cents,
            essential_cents,
            discretionary_cents,
        )

    net_flow_cents = sum(int(item["amountCents"]) for item in transactions)
    closing_balance_cents = opening_balance_cents + net_flow_cents
    return {
        "id": f"profile-{index + 1:04d}",
        "displayName": name if index == 0 else f"{NAMES[(index - 1) % len(NAMES)]} {index // len(NAMES) + 1}",
        "archetype": archetype_name,
        "monthlyIncomeCents": income_cents,
        "monthlyEssentialCents": essential_cents,
        "monthlyDiscretionaryCents": discretionary_cents,
        "liquidSavingsCents": closing_balance_cents,
        "openingBalanceCents": opening_balance_cents,
        "closingBalanceCents": closing_balance_cents,
        "transactions": transactions,
    }


def main() -> None:
    args = parse_args()
    if args.count < 1:
        raise SystemExit("--count must be at least 1")
    try:
        as_of = date.fromisoformat(args.as_of)
    except ValueError as error:
        raise SystemExit(f"--as-of must be YYYY-MM-DD: {error}") from error

    rng = random.Random(args.seed)
    profiles = [build_profile(rng, index, as_of) for index in range(args.count)]
    payload = {
        "schemaVersion": 1,
        "syntheticData": True,
        "label": "Simulated peer group",
        "seed": args.seed,
        "asOf": as_of.isoformat(),
        "currency": "USD",
        "historyMonths": 3,
        "historyConvention": "Three complete calendar months before the reference date",
        "profiles": profiles,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(profiles)} synthetic profiles at {args.output}")


if __name__ == "__main__":
    main()
