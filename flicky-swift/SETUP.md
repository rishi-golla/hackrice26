# Flicky Swift App — Setup Guide

## Quick Start

1. **Open in Xcode**
   ```
   open flicky-swift/leanring-buddy.xcodeproj
   ```

2. **Set your Signing Team**
   - Select the `leanring-buddy` scheme
   - Go to "Signing & Capabilities" → set your Apple Developer Team

3. **Add new source files to the Xcode project**
   Drag these two new files into the `leanring-buddy` group in Xcode:
   - `leanring-buddy/FinancialModels.swift`
   - `leanring-buddy/NessieAPIClient.swift`

4. **Configure services**
   - Set `FLICKY_WORKER_URL` in `leanring-buddy/Info.plist` to your Cloudflare Worker URL.
   - Store local Nessie configuration at `~/Library/Application Support/Flicky/nessie.plist`, a property-list dictionary with `FLICKY_NESSIE_API_KEY`, `FLICKY_NESSIE_BASE_URL`, and `FLICKY_NESSIE_AMOUNT_UNIT` strings. Restrict the file to owner read/write (`chmod 600`).
   - Local `FLICKY_NESSIE_*` values override bundle settings; the credential does not need to be committed or compiled into the app. The root `.env` alone is not read by the native app.
   - Use `https://prod-api.nessieisreal.com` and `dollars` unless your sandbox requires different settings.
   - Sign in with an existing Nessie Customer ID. A valid API key with no customers/accounts is an empty sandbox, not a populated demo.

5. **Build and run** (Cmd+R)

---

## Deploy the Cloudflare Worker

```bash
cd flicky-swift/worker
npm install

# Add API key secrets
npx wrangler secret put ANTHROPIC_API_KEY      # Claude API key
npx wrangler secret put ELEVENLABS_API_KEY     # ElevenLabs API key  
npx wrangler secret put ASSEMBLYAI_API_KEY     # AssemblyAI key (for transcription)
npx wrangler secret put SERPER_API_KEY         # Optional: Serper.dev for product search

# Set voice ID
npx wrangler secret put ELEVENLABS_VOICE_ID    # e.g. "21m00Tcm4TlvDq8ikWAM"

# Deploy
npx wrangler deploy
```

Copy the deployed worker URL (e.g. `https://flicky.your-name.workers.dev`) into `Info.plist` → `FLICKY_WORKER_URL`.

---

## Permissions Required

On first launch, Flicky will ask you to grant:
1. **Microphone** — for voice input (hold Ctrl+Option to talk)
2. **Accessibility** — for global keyboard shortcut detection
3. **Screen Recording** — to capture screenshots for visual context
4. **Screen Content** — for ScreenCaptureKit (grant in the panel)

---

## How It Works

1. **Hold Ctrl+Option** → recording starts (blue cursor appears)
2. **Ask a financial question** → "Can I afford these headphones?" / "What's my balance?"
3. **Release** → Flicky sees your screen + your live Capital One data → Claude analyzes both
4. **Flicky responds** via voice (ElevenLabs TTS) + text overlay next to your cursor
5. **If you're shopping** → Flicky searches for better deals and auto-navigates your browser

---

## Sandbox Data

Flicky reads records from Nessie and never substitutes local mock finances. A new API key may have no customers or accounts. Create or seed a clearly labeled sandbox profile before expecting balances, bills, or purchase charts.

---

## Capital One Login (In-App)

The Flicky panel shows a Capital One login form. Enter:
- **Customer ID**: your existing Nessie `customer_id`
- **Email**: displayed as account identifier

After login, the panel shows:
- Live balance from Nessie API
- Safe to spend (balance minus upcoming bills and $500 reserve)
- Upcoming bills in the next 14 days
- 30-day deposit/withdrawal totals
- Product search comparison results (when shopping)
- Navigation status (when Flicky opens a browser link)

## Populate a connected demo sandbox

From the repository root, `python3 scripts/seed_flicky_profile.py` previews a single clearly labeled synthetic profile. Add `--execute` to create it in Nessie. The script loads the local Nessie configuration, records created IDs in the Git-ignored `.nessie-demo-manifest.json`, and reuses those IDs on later runs. It does not retry ambiguous network failures. It creates a checking snapshot, two payroll deposits, three withdrawals, fourteen purchases across six merchant categories, and four upcoming bills. The service stores completed transaction history separately from the account balance; always verify the returned snapshot through `NessieAPIClient` rather than assuming posting changes the balance. Local customer/account configuration is populated after seeding; sign in to that customer in Flicky, or save that profile as the app's selected login during setup.
