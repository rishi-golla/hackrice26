# Nessie simulator demo runbook

Use the local `nessie-simulator` branch. The comparison cohort is synthetic and
ships with the app, so Python, screen recording, microphone access, ElevenLabs,
and a Nessie account are not required for the manual demo.

Regenerate the deterministic fixture when the seed or reference date changes:

```sh
python3 scripts/generate_financial_cohort.py \
  --seed 42 --count 200 --as-of 2026-09-13 \
  --output flicky-swift/leanring-buddy/financial-cohort.json
```

The optional Nessie helper is dry-run by default. It prints the customer,
opening-balance account, and transaction requests without reading credentials:

```sh
python3 scripts/seed_nessie_demo.py --count 1
```

Live writes are deliberately gated because the official Nessie schema could
not be verified during implementation. After independently verifying the
current payloads, set `NESSIE_API_KEY` and use
`--execute --confirm-schema`. Use `--skip-transactions` while validating
customer and account creation. The ignored `.nessie-demo-manifest.json`
records returned IDs; the script never retries an ambiguous create.
After a successful seed, enter the manifest's `customerId` in Flicky’s Nessie
login field so the existing `NessieAPIClient` supplies the live balance shown
above the local comparison.

For a 90-second demo:

1. Build and run the `leanring-buddy` scheme in Xcode.
2. Open Flicky’s full insights dashboard and choose **Scenarios**.
3. Point out the selected demo profile, the clearly labeled simulated peer
   group, its percentile, and the fixed three-month horizon.
4. Leave the prefilled one-time purchase at **$180** and goal at **$600**.
   The deterministic projection shows the baseline goal in month 3 and the
   purchase scenario in month 4.
5. Change monthly discretionary reduction to **$80**. The scenario reaches
   the goal in month 3 with a higher ending balance.
6. Enter a purchase larger than liquid savings to show the explicit warning.
7. Optionally ask Flicky, “How would buying this affect my savings goal?”.
   A confirmed or edited amount opens the same Scenarios tab; stop speech with
   the existing stop control while the transcript remains visible.
