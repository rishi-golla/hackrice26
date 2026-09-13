#!/usr/bin/env python3
"""Read Nessie independently of Flicky's UI. Never creates or updates records.

Credentials come from local configuration and are passed to curl through stdin,
not exposed in process arguments or report output. Output is shareable sandbox
customer/account evidence with account numbers masked.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
from urllib.parse import urlparse

configuration = plistlib.loads((Path.home() / 'Library/Application Support/Flicky/nessie.plist').read_bytes())
key = configuration['FLICKY_NESSIE_API_KEY']
base = configuration.get('FLICKY_NESSIE_BASE_URL', 'https://prod-api.nessieisreal.com').rstrip('/')
customer = configuration['FLICKY_NESSIE_CUSTOMER_ID']
selected_account = configuration['FLICKY_NESSIE_ACCOUNT_ID']
entity_prefix = '/enterprise' if configuration.get('FLICKY_NESSIE_DATA_SCOPE') == 'enterprise' else ''
if base != 'https://prod-api.nessieisreal.com':
    raise SystemExit('Expected the Nessie HTTPS sandbox endpoint; check configuration.')


def redact(value):
    if isinstance(value, dict):
        return {name: ('[redacted]' if name.lower() in ['key', 'api_key', 'token', 'authorization'] else '•••• ' + str(item)[-4:] if name == 'account_number' else redact(item)) for name, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


requests = []
def get(path):
    config = 'url = ' + json.dumps(base + path + '?key=' + key) + '\nheader = "Cache-Control: no-cache"\n'
    result = subprocess.run(['curl', '--silent', '--max-time', '20', '--config', '-', '--write-out', '\n%{http_code}'], input=config, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit('Nessie network request failed; no fallback data used.')
    body, _, status = result.stdout.rpartition('\n')
    if status != '200':
        raise SystemExit(f'GET {path}: HTTP {status}; no fallback data used.')
    payload = json.loads(body)
    requests.append({'method': 'GET', 'host': urlparse(base).hostname, 'path': path, 'httpStatus': int(status),
                     'fetchedAt': datetime.now(timezone.utc).isoformat(), 'sha256': hashlib.sha256(body.encode()).hexdigest(),
                     'recordCount': len(payload) if isinstance(payload, list) else 1})
    return payload


identity = get(entity_prefix + '/customers/' + customer)
accounts = get('/customers/' + customer + '/accounts')
if not any(account['_id'] == selected_account for account in accounts):
    raise SystemExit('Configured account is not returned under this customer.')
account = get(entity_prefix + '/accounts/' + selected_account)
bills = get('/accounts/' + selected_account + '/bills')
deposits = get('/accounts/' + selected_account + '/deposits')
withdrawals = get('/accounts/' + selected_account + '/withdrawals')
purchases = get('/accounts/' + selected_account + '/purchases')
print(json.dumps(redact({'source': base, 'environment': 'Nessie sandbox; synthetic data',
                        'customer': identity, 'accounts': accounts, 'selectedAccount': account,
                        'bills': bills, 'deposits': deposits, 'withdrawals': withdrawals, 'purchases': purchases,
                        'requests': requests}), indent=2).replace(key, '[redacted]'))
