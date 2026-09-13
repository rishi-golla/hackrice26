#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
check_directory=$(mktemp -d)
trap 'rm -rf "$check_directory"' EXIT
sources=leanring-buddy
xcrun swiftc -swift-version 5 -parse-as-library "$sources/FinancialModels.swift" "$sources/NessieAPIClient.swift" scripts/checks/NessieEvidenceCheck.swift -o "$check_directory/nessie"
"$check_directory/nessie"
xcrun swiftc -swift-version 5 -parse-as-library -target arm64-apple-macos14.2 "$sources/FinancialModels.swift" "$sources/ClaudeAPI.swift" "$sources/FlickyResearch.swift" "$sources/DesignSystem.swift" scripts/checks/ResearchLifecycleCheck.swift -o "$check_directory/research"
"$check_directory/research"
xcrun swiftc -swift-version 5 -parse-as-library -target arm64-apple-macos14.2 "$sources/FinancialModels.swift" "$sources/ClaudeAPI.swift" "$sources/FlickyResearch.swift" "$sources/DesignSystem.swift" scripts/checks/EvidencePanelCheck.swift -o "$check_directory/panel"
"$check_directory/panel"
