#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
check_directory=$(mktemp -d)
trap 'rm -rf "$check_directory"' EXIT
sources=leanring-buddy
for check in SubscriptionCheck SubscriptionBrowserCheck; do
  xcrun swiftc -swift-version 5 -parse-as-library \
    "$sources/FinancialModels.swift" "$sources/DesignSystem.swift" \
    "$sources/Subscriptions.swift" "$sources/SubscriptionCancellation.swift" \
    "scripts/checks/$check.swift" -o "$check_directory/$check"
  "$check_directory/$check"
done
