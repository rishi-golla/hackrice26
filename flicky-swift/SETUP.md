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

4. **Configure API keys in Info.plist**
   Open `leanring-buddy/Info.plist` and set:
   - `FLICKY_WORKER_URL` → your Cloudflare Worker URL (deploy `worker/src/index.ts` first)
   - `FLICKY_NESSIE_API_KEY` → your Capital One Nessie API key
   - `FLICKY_NESSIE_CUSTOMER_ID` → your Nessie customer ID
   - Leave blank for demo mode (uses mock financial data)

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

## Demo Mode

If you don't have Nessie API credentials, leave `FLICKY_NESSIE_API_KEY` blank in Info.plist.
Flicky will use mock financial data ($1,312 balance, $312 safe to spend, mock bills) — fully functional for demos.

---

## Capital One Login (In-App)

The Flicky panel shows a Capital One login form. Enter:
- **Customer ID**: your Nessie `customer_id` (or leave blank for demo mode)
- **Email**: displayed as account identifier

After login, the panel shows:
- Live balance from Nessie API
- Safe to spend (balance minus upcoming bills and $500 reserve)
- Upcoming bills in the next 14 days
- 30-day deposit/withdrawal totals
- Product search comparison results (when shopping)
- Navigation status (when Flicky opens a browser link)
