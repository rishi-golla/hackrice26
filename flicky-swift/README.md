# PeppaPrice native app

This directory contains the current macOS menu-bar financial companion. See the [project README](../README.md) for features and setup, and [AGENTS.md](AGENTS.md) for development instructions.

Open `leanring-buddy.xcodeproj` in Xcode to build and run. Use Xcode for full application builds so the existing macOS permission flow remains intact.

Configure the deployed AI gateway using `FLICKY_WORKER_URL` in an owner-only `~/Library/Application Support/Flicky/runtime.plist`. A bundle `Info.plist` value is also supported for distribution. Never commit provider secrets. Nessie configuration remains in `Flicky/nessie.plist` and Realtime configuration in `Flicky/realtime.json`, outside the repository.

The gateway source is in `worker/`; Realtime voice uses `realtime-worker/`. Changing a local package or Worker name does not deploy a new gateway.

Financial account evidence uses the Nessie sandbox. Credit simulations and shopping checkout remain explicitly labeled simulations. Real subscription cancellation requires provider-account confirmation and a verified result.

Third-party license terms are preserved in [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt).
