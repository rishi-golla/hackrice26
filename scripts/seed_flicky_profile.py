#!/usr/bin/env python3
"""Seed one clearly labeled Nessie demo profile; --execute enables sandbox writes.

Payloads follow nessieisreal/nessie-javascript-sdk lib/tests examples.
Creation IDs are recorded after each successful request. No automatic retries.
"""
import argparse
from datetime import date, timedelta
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--execute', action='store_true')
args = parser.parse_args()
configuration_path = Path.home() / 'Library/Application Support/Flicky/nessie.plist'
configuration = plistlib.loads(configuration_path.read_bytes())
api_key = configuration['FLICKY_NESSIE_API_KEY']
base_url = configuration.get('FLICKY_NESSIE_BASE_URL', 'https://prod-api.nessieisreal.com').rstrip('/')
if base_url != 'https://prod-api.nessieisreal.com':
    raise SystemExit('This seeder is restricted to the Nessie sandbox endpoint.')
manifest_path = Path('.nessie-demo-manifest.json')
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
profile_key = 'flicky-connected-demo-' + hashlib.sha256(api_key.encode()).hexdigest()[:12]
profile = manifest.setdefault(profile_key, {'date': date.today().isoformat(), 'created': {}})
today = date.fromisoformat(profile['date'])
address = {'street_number': '100', 'street_name': 'Demo Street', 'city': 'Houston', 'state': 'TX', 'zip': '77005'}


def api(method, path, payload=None):
    options = 'url = ' + json.dumps(base_url + path + '?key=' + api_key) + '\nrequest = ' + json.dumps(method) + '\n'
    if payload is not None:
        options += 'header = "Content-Type: application/json"\ndata = ' + json.dumps(json.dumps(payload)) + '\n'
    result = subprocess.run(['curl', '--silent', '--max-time', '25', '--config', '-', '--write-out', '\n%{http_code}'], input=options, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Ambiguous network result. Inspect the sandbox before retrying.')
    body, _, status = result.stdout.rpartition('\n')
    if not status.startswith('2'):
        raise RuntimeError(f'{method} {path}: HTTP {status}: {body.replace(api_key, "[redacted]")[:700]}')
    return json.loads(body) if body else {}


def create(label, path, payload):
    if label in profile['created']:
        return profile['created'][label]
    if not args.execute:
        print(label, path, json.dumps(payload))
        return '{' + label + '}'
    response = api('POST', path, payload)
    record = response.get('objectCreated', response)
    identifier = record.get('_id') or record.get('id')
    if not identifier:
        raise RuntimeError('Create succeeded without an ID. Inspect the sandbox before retrying.')
    profile['created'][label] = identifier
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    manifest_path.chmod(0o600)
    print('Created', label)
    return identifier


customer_id = create('customer', '/customers', {'first_name': 'Flicky', 'last_name': 'Demo', 'address': address})
account_id = create('checking', f'/customers/{customer_id}/accounts', {'type': 'Checking', 'nickname': 'Flicky Demo Checking (synthetic)', 'rewards': 1250, 'balance': 1800, 'account_number': '2609130000000001'})
for label, days, amount in [('paycheck-1', 26, 1800), ('paycheck-2', 12, 1800)]:
    create(label, f'/accounts/{account_id}/deposits', {'medium': 'balance', 'transaction_date': (today - timedelta(days=days)).isoformat(), 'amount': amount, 'status': 'completed', 'description': 'Flicky Demo: synthetic payroll ' + label})
for label, days, amount in [('previous-rent', 23, 1100), ('previous-utilities', 19, 85), ('cash-withdrawal', 16, 300)]:
    create(label, f'/accounts/{account_id}/withdrawals', {'medium': 'balance', 'transaction_date': (today - timedelta(days=days)).isoformat(), 'amount': amount, 'status': 'completed', 'description': 'Flicky Demo: synthetic ' + label})

purchases = {
    'Groceries': [(24, 74.32), (15, 68.45), (6, 91.20)],
    'Dining': [(21, 24.80), (13, 32.50), (4, 18.75)],
    'Coffee': [(20, 6.80), (10, 6.80), (2, 6.80)],
    'Transport': [(17, 35.00), (7, 42.50)],
    'Shopping': [(9, 129.99)],
    'Entertainment': [(18, 14.99), (5, 24.99)],
}
for category, transactions in purchases.items():
    merchant_id = create('merchant-' + category, '/merchants', {'name': 'Flicky Demo ' + category, 'category': category, 'address': address, 'geocode': {'lat': 29.72, 'lng': -95.4}})
    for index, (days, amount) in enumerate(transactions):
        create(f'purchase-{category}-{index}', f'/accounts/{account_id}/purchases', {'merchant_id': merchant_id, 'medium': 'balance', 'purchase_date': (today - timedelta(days=days)).isoformat(), 'amount': amount, 'status': 'completed', 'description': f'Flicky Demo: synthetic {category} {index + 1}'})

for label, days, amount in [('Rent', 8, 1100), ('Utilities', 11, 85), ('Phone', 4, 45), ('Streaming', 6, 15.99)]:
    due = today + timedelta(days=days)
    create('bill-' + label, f'/accounts/{account_id}/bills', {'status': 'pending', 'payee': 'Flicky Demo ' + label, 'nickname': 'Demo ' + label, 'payment_date': due.isoformat(), 'recurring_date': due.day, 'payment_amount': amount})

if args.execute:
    configuration.update(FLICKY_NESSIE_CUSTOMER_ID=customer_id, FLICKY_NESSIE_ACCOUNT_ID=account_id)
    configuration_path.write_bytes(plistlib.dumps(configuration))
    configuration_path.chmod(0o600)
    print('Configured demo customer:', customer_id)
    print('Configured demo account:', account_id)
    for endpoint in ['bills', 'deposits', 'withdrawals', 'purchases']:
        records = api('GET', f'/accounts/{account_id}/{endpoint}')
        print(endpoint, len(records), 'records; statuses:', sorted(set(item.get('status', '(missing)') for item in records)))
    account = api('GET', f'/accounts/{account_id}')
    print('Live Nessie balance:', account.get('balance'))
