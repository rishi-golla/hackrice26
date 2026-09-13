#!/usr/bin/env python3
"""Create/resume 20 PeppaPrice Nessie sandbox accounts. Default is a dry run.

API schemas: github.com/nessieisreal/nessie-javascript-sdk/tree/master/lib/tests
Writes and pending operations are journaled owner-only; ambiguous POSTs are never retried.
"""
import argparse
import hashlib
import json
import os
import plistlib
import subprocess
from datetime import date, timedelta
from pathlib import Path

NAMES = ['Jack', 'Nathan', 'Olivia', 'Ava', 'Emma', 'Liam', 'Noah', 'Sophia', 'Ethan', 'Mia']
SUPPORT = Path.home() / 'Library/Application Support/Flicky'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if not args.execute:
        for i, name in enumerate(NAMES):
            print(f"{name} Demo: {name}'s Checking (${450+i*317}), {name}'s Savings (${1800+i*835}) + varied synthetic activity")
        return
    config = plistlib.loads((SUPPORT / 'nessie.plist').read_bytes())
    key = config['FLICKY_NESSIE_API_KEY']
    base = config.get('FLICKY_NESSIE_BASE_URL', 'https://prod-api.nessieisreal.com').rstrip('/')
    if base != 'https://prod-api.nessieisreal.com':
        raise SystemExit('Only the Nessie sandbox endpoint is allowed.')
    journal_path = SUPPORT / ('peppaprice-seed-' + hashlib.sha256(key.encode()).hexdigest()[:12] + '.json')
    journal = json.loads(journal_path.read_text()) if journal_path.exists() else {'created': {}, 'date': date.today().isoformat()}
    today = date.fromisoformat(journal['date'])

    def save(path, value):
        temp = path.with_suffix('.tmp')
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
        os.replace(temp, path)

    def api(method, path, payload=None):
        options = 'url = ' + json.dumps(base + path + '?key=' + key) + '\nrequest = ' + json.dumps(method) + '\n'
        if payload is not None:
            options += 'header = "Content-Type: application/json"\ndata = ' + json.dumps(json.dumps(payload)) + '\n'
        result = subprocess.run(['curl', '--silent', '--max-time', '25', '--config', '-', '--write-out', '\n%{http_code}'], input=options, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError('Ambiguous network result; inspect journal pending operation before retrying.')
        body, _, status = result.stdout.rpartition('\n')
        if not status.startswith('2'):
            raise RuntimeError(f'{method} {path}: HTTP {status}: {body.replace(key, "[redacted]")[:300]}')
        return json.loads(body) if body else {}

    def create(label, path, payload):
        if label in journal['created']:
            return journal['created'][label]
        if journal.get('pending'):
            raise RuntimeError('An earlier POST is unresolved; inspect the sandbox before retrying.')
        journal['pending'] = {'label': label, 'path': path, 'payload': payload}
        save(journal_path, journal)
        response = api('POST', path, payload)
        record = response.get('objectCreated', response)
        identifier = record.get('_id') or record.get('id')
        if not identifier:
            raise RuntimeError('POST returned no ID; inspect the sandbox before retrying.')
        journal['created'][label] = identifier
        del journal['pending']
        save(journal_path, journal)
        return identifier

    address = {'street_number': '100', 'street_name': 'Demo Street', 'city': 'Houston', 'state': 'TX', 'zip': '77005'}
    merchants = {}
    for category in ['Groceries', 'Dining', 'Transport', 'Shopping']:
        merchants[category] = create('merchant-' + category, '/merchants', {'name': 'PeppaPrice Demo ' + category, 'category': category, 'address': address, 'geocode': {'lat': 29.72, 'lng': -95.4}})
    index = []
    for i, name in enumerate(NAMES):
        customer = create(name, '/customers', {'first_name': name, 'last_name': 'Demo', 'address': address})
        for kind in ['Checking', 'Savings']:
            prefix = name + '-' + kind
            opening = 450 + i * 317 if kind == 'Checking' else 1800 + i * 835
            account = create(prefix, f'/customers/{customer}/accounts', {'type': kind, 'nickname': name + "'s " + kind, 'balance': opening, 'rewards': i * 135 if kind == 'Checking' else 0, 'account_number': f'260913{i:02d}{1 if kind == "Checking" else 2:08d}'})
            for n, days in enumerate([24, 10] if kind == 'Checking' else [12]):
                amount = 850 + i * 90 if kind == 'Checking' else 125 + i * 35
                create(prefix + f'-deposit-{n}', f'/accounts/{account}/deposits', {'medium': 'balance', 'transaction_date': (today-timedelta(days=days)).isoformat(), 'amount': amount, 'status': 'completed', 'description': 'PeppaPrice synthetic ' + ('payroll' if kind == 'Checking' else 'savings contribution')})
            create(prefix + '-withdrawal', f'/accounts/{account}/withdrawals', {'medium': 'balance', 'transaction_date': (today-timedelta(days=8)).isoformat(), 'amount': 25 + i * 7, 'status': 'completed', 'description': 'PeppaPrice synthetic cash withdrawal'})
            if kind == 'Checking':
                for n, (category, merchant) in enumerate(merchants.items()):
                    create(prefix+'-purchase-'+category, f'/accounts/{account}/purchases', {'merchant_id': merchant, 'medium': 'balance', 'purchase_date': (today-timedelta(days=2+n*4)).isoformat(), 'amount': round(19.25 + i*9.37 + n*14.12, 2), 'status': 'completed', 'description': 'PeppaPrice synthetic '+category})
                for n, (payee, amount) in enumerate([('Rent', 550+i*65), ('Phone', 30+i*3), ('Streaming', 9.99+i)]):
                    due = today+timedelta(days=3+n*4)
                    create(prefix+'-bill-'+payee, f'/accounts/{account}/bills', {'status': 'pending', 'payee': 'PeppaPrice Demo '+payee, 'nickname': payee, 'payment_date': due.isoformat(), 'recurring_date': due.day, 'payment_amount': amount})
            live = api('GET', f'/accounts/{account}')
            assert live['customer_id'] == customer and live['nickname'] == name + "'s " + kind
            for endpoint, expected in [('deposits', 2 if kind == 'Checking' else 1), ('withdrawals', 1), ('purchases', 4 if kind == 'Checking' else 0), ('bills', 3 if kind == 'Checking' else 0)]:
                records = api('GET', f'/accounts/{account}/{endpoint}')
                assert len(records) >= expected, f'{prefix}: missing {endpoint}'
            index.append({'id': account, 'customerId': customer, 'customerName': name+' Demo', 'nickname': live['nickname'], 'type': kind})
            print(f"Verified {live['nickname']}: ${live['balance']:.2f}", flush=True)
    assert len(index) == len({row['id'] for row in index}) == 20
    save(SUPPORT / 'peppaprice-demo-accounts.json', index)
    print('PASS: 20 live sandbox accounts verified; selector index saved.', flush=True)

if __name__ == '__main__':
    main()
