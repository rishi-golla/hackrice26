#!/usr/bin/env python3
"""Plan or seed a small Nessie demo cohort from the local synthetic fixture.

The default mode is a dry run. Live writes require both --execute and
--confirm-schema because the Nessie documentation was not reachable while
this demo was built. The script never retries a create request after an
ambiguous network result; inspect the sandbox before running it again.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_FIXTURE = Path("flicky-swift/leanring-buddy/financial-cohort.json")
DEFAULT_MANIFEST = Path(".nessie-demo-manifest.json")
DEFAULT_BASE_URL = "https://prod-api.nessieisreal.com"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--count", type=int, default=1, help="Number of profiles to plan (1-3).")
    parser.add_argument("--profile-id", help="Only plan this fixture profile ID.")
    parser.add_argument("--base-url", default=os.environ.get("NESSIE_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--execute", action="store_true", help="Perform API writes instead of printing a plan.")
    parser.add_argument(
        "--confirm-schema",
        action="store_true",
        help="Acknowledge that the live Nessie payload schemas were verified separately.",
    )
    parser.add_argument(
        "--skip-transactions",
        action="store_true",
        help="Only create the customer and opening-balance account; useful while transaction schemas are being verified.",
    )
    return parser.parse_args()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def cents_to_dollars(amount_cents: int) -> float:
    return round(amount_cents / 100, 2)


def split_name(display_name: str) -> tuple[str, str]:
    parts = display_name.strip().split()
    if not parts:
        return "Demo", "User"
    if len(parts) == 1:
        return parts[0], "User"
    return " ".join(parts[:-1]), parts[-1]


def customer_payload(profile: dict[str, Any]) -> dict[str, Any]:
    first_name, last_name = split_name(profile.get("displayName", "Demo User"))
    return {
        "first_name": first_name,
        "last_name": last_name,
        "address": {
            "street_number": "100",
            "street_name": "Demo Street",
            "city": "Houston",
            "state": "TX",
            "zip": "77005",
        },
    }


def account_payload(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "Checking",
        "nickname": "Flicky simulated checking",
        "rewards": 0,
        "balance": cents_to_dollars(int(profile["openingBalanceCents"])),
    }


def transaction_operations(profile: dict[str, Any], account_id: str = "{accountId}") -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = []
    for transaction_index, transaction in enumerate(profile.get("transactions", []), start=1):
        transaction_type = transaction.get("type")
        amount_cents = int(transaction.get("amountCents", 0))
        amount = cents_to_dollars(abs(amount_cents))
        transaction_date = transaction.get("date")
        category = transaction.get("category", "Other")
        merchant = transaction.get("merchant", category)
        description = f"Flicky synthetic {category.lower()}"

        is_incoming_transfer = transaction_type == "transfer" and amount_cents > 0
        is_outgoing_transfer = transaction_type == "transfer" and amount_cents < 0
        if transaction_type == "salary" or transaction_type == "transfer_in" or is_incoming_transfer:
            operations.append(
                {
                    "kind": "deposit",
                    "path": f"/accounts/{account_id}/deposits",
                    "transactionId": transaction.get("id", f"{profile['id']}-tx-{transaction_index:03d}"),
                    "payload": {
                        "medium": "direct deposit" if transaction_type == "salary" else "balance transfer",
                        "transaction_date": transaction_date,
                        "amount": amount,
                        "description": description,
                    },
                }
            )
        elif transaction_type == "bill" or transaction_type == "transfer_out" or is_outgoing_transfer:
            operations.append(
                {
                    "kind": "withdrawal",
                    "path": f"/accounts/{account_id}/withdrawals",
                    "transactionId": transaction.get("id", f"{profile['id']}-tx-{transaction_index:03d}"),
                    "payload": {
                        "medium": "balance transfer" if transaction_type == "transfer_out" else "bill payment",
                        "transaction_date": transaction_date,
                        "amount": amount,
                        "description": description,
                    },
                }
            )
        elif transaction_type == "purchase":
            # Nessie purchase records normally require a merchant_id. The
            # local fixture keeps merchant names, so live purchase writes are
            # intentionally left in the printed plan until the account's
            # merchant schema is verified by the developer.
            operations.append(
                {
                    "kind": "purchase (needs merchant_id)",
                    "path": f"/accounts/{account_id}/purchases",
                    "transactionId": transaction.get("id", f"{profile['id']}-tx-{transaction_index:03d}"),
                    "payload": {
                        "merchant": merchant,
                        "amount": amount,
                        "purchase_date": transaction_date,
                        "description": description,
                    },
                    "requiresMerchantSchema": True,
                }
            )
    return operations


def build_plan(profile: dict[str, Any]) -> list[dict[str, Any]]:
    profile_id = profile["id"]
    return [
        {
            "kind": "customer",
            "path": "/customers",
            "profileId": profile_id,
            "payload": customer_payload(profile),
        },
        {
            "kind": "account",
            "path": "/customers/{customerId}/accounts",
            "profileId": profile_id,
            "payload": account_payload(profile),
        },
        *transaction_operations(profile),
    ]


def post_json(base_url: str, api_key: str, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    query = urlencode({"key": api_key})
    url = f"{base_url.rstrip('/')}{path}?{query}"
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    parsed = json.loads(body) if body else {}
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Nessie returned a non-object response for {path}")
    return parsed


def get_json(base_url: str, api_key: str, path: str) -> Any:
    query = urlencode({"key": api_key})
    request = Request(f"{base_url.rstrip('/')}{path}?{query}", headers={"Accept": "application/json"})
    with urlopen(request, timeout=20) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else None


def save_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")


def returned_id(response: dict[str, Any]) -> str:
    identifier = response.get("_id") or response.get("id")
    if isinstance(identifier, dict):
        identifier = identifier.get("$oid")
    if not isinstance(identifier, str) or not identifier:
        raise RuntimeError("Nessie response did not include an ID")
    return identifier


def find_existing_customer(base_url: str, api_key: str, payload: dict[str, Any]) -> str | None:
    customers = get_json(base_url, api_key, "/customers")
    if not isinstance(customers, list):
        return None
    for customer in customers:
        if not isinstance(customer, dict):
            continue
        if customer.get("first_name") != payload.get("first_name"):
            continue
        if customer.get("last_name") != payload.get("last_name"):
            continue
        if customer.get("address") != payload.get("address"):
            continue
        identifier = customer.get("_id") or customer.get("id")
        if isinstance(identifier, dict):
            identifier = identifier.get("$oid")
        if isinstance(identifier, str) and identifier:
            return identifier
    return None


def find_existing_account(base_url: str, api_key: str, customer_id: str, payload: dict[str, Any]) -> str | None:
    accounts = get_json(base_url, api_key, f"/customers/{customer_id}/accounts")
    if not isinstance(accounts, list):
        return None
    expected_balance = float(payload.get("balance", 0))
    for account in accounts:
        if not isinstance(account, dict) or account.get("nickname") != payload.get("nickname"):
            continue
        try:
            if abs(float(account.get("balance", 0)) - expected_balance) > 0.01:
                continue
        except (TypeError, ValueError):
            continue
        identifier = account.get("_id") or account.get("id")
        if isinstance(identifier, dict):
            identifier = identifier.get("$oid")
        if isinstance(identifier, str) and identifier:
            return identifier
    return None


def fixture_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def print_plan(profiles: list[dict[str, Any]], base_url: str) -> None:
    print(f"Dry run: no Nessie requests will be sent to {base_url.rstrip('/')}")
    print("The account starts at openingBalanceCents; listed transactions then apply once to reach closingBalanceCents.")
    for profile in profiles:
        print(f"\n{profile['id']} — {profile.get('displayName', 'Demo User')}")
        for operation in build_plan(profile):
            marker = " [schema review required]" if operation.get("requiresMerchantSchema") else ""
            print(f"  POST {operation['path']} ({operation['kind']}){marker}")
            print(f"    {json.dumps(operation['payload'], sort_keys=True)}")


def execute_profile(
    profile: dict[str, Any],
    base_url: str,
    api_key: str,
    manifest: dict[str, Any],
    manifest_path: Path,
    skip_transactions: bool,
) -> None:
    profile_id = profile["id"]
    operations = transaction_operations(profile)
    if not skip_transactions and any(operation.get("requiresMerchantSchema") for operation in operations):
        raise RuntimeError(
            "This fixture contains purchases without merchant IDs. Verify the current merchant schema and add a mapping, "
            "or rerun with --skip-transactions to create only the customer and opening-balance account."
        )
    profile_manifest = manifest.setdefault("profiles", {}).setdefault(profile_id, {})
    customer_id = profile_manifest.get("customerId")
    account_id = profile_manifest.get("accountId")

    if not customer_id:
        payload = customer_payload(profile)
        customer_id = find_existing_customer(base_url, api_key, payload)
        if customer_id:
            print(f"Reconciled existing {profile_id} customer {customer_id}")
        else:
            response = post_json(base_url, api_key, "/customers", payload)
            customer_id = returned_id(response)
            print(f"Created {profile_id} customer {customer_id}")
        profile_manifest["customerId"] = customer_id
        save_manifest(manifest_path, manifest)
    else:
        print(f"Reusing {profile_id} customer {customer_id} from manifest")

    if not account_id:
        payload = account_payload(profile)
        account_id = find_existing_account(base_url, api_key, customer_id, payload)
        if account_id:
            print(f"Reconciled existing {profile_id} account {account_id}")
        else:
            response = post_json(base_url, api_key, f"/customers/{customer_id}/accounts", payload)
            account_id = returned_id(response)
            print(f"Created {profile_id} account {account_id}")
        profile_manifest["accountId"] = account_id
        save_manifest(manifest_path, manifest)
    else:
        print(f"Reusing {profile_id} account {account_id} from manifest")

    if skip_transactions:
        print("Skipped deposits, withdrawals, and purchases (--skip-transactions)")
        return

    completed = set(profile_manifest.setdefault("transactionIds", []))
    for operation in transaction_operations(profile, account_id):
        transaction_id = operation["transactionId"]
        if transaction_id in completed:
            continue
        if operation.get("requiresMerchantSchema"):
            raise RuntimeError(
                "Purchase seeding needs a verified merchant_id mapping; stop before creating any purchase records."
            )
        response = post_json(base_url, api_key, operation["path"], operation["payload"])
        returned_id(response)
        completed.add(transaction_id)
        profile_manifest["transactionIds"] = sorted(completed)
        save_manifest(manifest_path, manifest)
        print(f"Created {operation['kind']} {transaction_id}")


def main() -> int:
    args = parse_args()
    if not 1 <= args.count <= 3:
        print("--count must be between 1 and 3", file=sys.stderr)
        return 2
    if args.execute and not args.confirm_schema:
        print("Refusing live writes: pass --confirm-schema after verifying the current Nessie schemas.", file=sys.stderr)
        return 2
    if args.execute and not os.environ.get("NESSIE_API_KEY"):
        print("Refusing live writes: set NESSIE_API_KEY in the environment.", file=sys.stderr)
        return 2

    fixture = load_json(args.fixture, None)
    if not isinstance(fixture, dict) or not fixture.get("syntheticData"):
        print(f"Fixture is missing or is not marked synthetic: {args.fixture}", file=sys.stderr)
        return 2
    profiles = fixture.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        print("Fixture contains no profiles", file=sys.stderr)
        return 2

    if args.profile_id:
        profiles = [profile for profile in profiles if profile.get("id") == args.profile_id]
        if not profiles:
            print(f"Profile not found: {args.profile_id}", file=sys.stderr)
            return 2
    else:
        profiles = profiles[: args.count]

    if not args.execute:
        print_plan(profiles, args.base_url)
        print(f"\nFixture SHA-256: {fixture_hash(args.fixture)}")
        print("No credentials were read in dry-run mode.")
        return 0

    manifest = load_json(args.manifest, {"version": 1, "fixtureSha256": fixture_hash(args.fixture), "profiles": {}})
    if not isinstance(manifest, dict):
        print(f"Manifest is not a JSON object: {args.manifest}", file=sys.stderr)
        return 2
    manifest["fixtureSha256"] = fixture_hash(args.fixture)
    manifest["baseUrl"] = args.base_url.rstrip("/")
    manifest["updatedAt"] = date.today().isoformat()

    try:
        for profile in profiles:
            execute_profile(
                profile,
                args.base_url,
                os.environ["NESSIE_API_KEY"],
                manifest,
                args.manifest,
                args.skip_transactions,
            )
    except (HTTPError, URLError, TimeoutError, RuntimeError, OSError, json.JSONDecodeError) as error:
        print(f"Nessie seed stopped without retrying: {error}", file=sys.stderr)
        print("If the request may have reached Nessie, reconcile the sandbox before rerunning.", file=sys.stderr)
        return 1

    save_manifest(args.manifest, manifest)
    print(f"Wrote local ID manifest to {args.manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
