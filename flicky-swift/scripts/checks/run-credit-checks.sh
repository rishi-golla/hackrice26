#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
check_directory=$(mktemp -d)
trap 'rm -rf "$check_directory"' EXIT
sources=leanring-buddy
xcrun swiftc -swift-version 5 -parse-as-library -target "$(uname -m)-apple-macos14.2" \
  "$sources/FinancialModels.swift" "$sources/DesignSystem.swift" \
  "$sources/TopicWindowIntent.swift" "$sources/CreditSimulation.swift" "$sources/CreditSimulationPanel.swift" \
  scripts/checks/CreditSimulationCheck.swift -o "$check_directory/credit"
"$check_directory/credit" "$@"
