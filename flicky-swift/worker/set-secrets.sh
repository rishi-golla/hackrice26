#!/bin/bash
# Run this from the flicky-swift/worker/ directory.
# Paste your actual API keys where indicated, then run: bash set-secrets.sh

# ── Already in your .env ─────────────────────────────────────────────────────
echo "sk_dbbf68c6fb8c940bbed6a3cb2a1b60e859f89c8aa3e4a3e0" | npx wrangler secret put ELEVENLABS_API_KEY
echo "pNInz6obpgDQGcFmaJgB"                               | npx wrangler secret put ELEVENLABS_VOICE_ID
echo "2029a7e5944d200fb4ad448298ec4bb2154dc156"           | npx wrangler secret put SERPER_API_KEY

# ── You need to fill these in ─────────────────────────────────────────────────
# Get ANTHROPIC_API_KEY from: https://console.anthropic.com/settings/keys
echo "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"     | npx wrangler secret put ANTHROPIC_API_KEY

# Get ASSEMBLYAI_API_KEY from: https://www.assemblyai.com/dashboard/account
# OR skip it — the app falls back to Apple Speech (built into macOS)
echo "6490898fd1ce46abab948414d862d764"    | npx wrangler secret put ASSEMBLYAI_API_KEY

echo ""
echo "✓ Secrets set. Now deploying worker..."
npx wrangler deploy
