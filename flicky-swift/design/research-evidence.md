# Contextual evidence and specialist research

This is an Operate surface inside the native Flicky companion. The evidence sheet is 390 × 650 points, or 420 points tall when account data is unavailable, clamped to the active display. The AppKit window supplies an explicit viewport to SwiftUI; the hosting view does not derive window dimensions from intrinsic content. The header and source/refresh footer remain fixed around scrolling evidence.

The existing blue cursor becomes the sheet's identifying mark. Rounded system headings, cyan/mint data marks, amber obligations, and a dark blue surface connect it to Flicky. Use an arithmetic ledger for affordability, actual proportional purchase sectors with a numeric legend, dated bill rows, and deposit/withdrawal bars. Calculations and source explanations expand inline. Data unavailability always has explicit copy and a refresh action; never replace missing values with sample finances.

A separate screen panel carries specialist flights, independent of cursor visibility. The evidence sheet announces routing and retains Working, Returned, or Unavailable status. Fast completions return from their actual flight position. Reduce Motion preserves labels and state without spatial movement. Cancellation closes the flights and prevents late findings from reaching another question.

Reliable examples:
- “Can I afford this laptop?” → Affordability + Tradeoffs; balance and bills.
- “Compare these two options.” → Affordability + Tradeoffs; model selects relevant evidence.
- “Analyze my spending.” → Affordability + Spending patterns + Tradeoffs; purchases, movements, bills.
- “Use subagents to review this decision.” → at least two independent perspectives.
- “What is my balance?” → no forced delegation; direct evidence is sufficient.

These are independent analysis requests over the supplied screenshot and Nessie context. Product search remains in Flicky's main research loop; specialists do not claim independent web browsing.

Run `scripts/checks/run-evidence-checks.sh` from this project's parent or use its full path. Checks cover financial normalization, fallback routing, concurrent requests, cancellation, and actual AppKit panel rendering with deliberately isolated test fixtures. PNGs are written to `/tmp/flicky-panel-*.png`.

Investment follow-ups carry the recent conversation into both routing and every specialist request. “Best stocks to invest in” followed by “a year” automatically selects Affordability, Horizon & risk, and Tradeoffs, with investing/bills/spending evidence. Securities requests cannot open merchandise search results. “Before you invest” shows the observed balance, 14-day obligations, reserve, remaining-cash ceiling, and the user's stated horizon. The answer must connect these observations to the decision and distinguish that ceiling from a suitable contribution; unknown living costs, emergency savings, and risk preferences cannot be inferred from Nessie. Current securities prices and return forecasts are not provided by Nessie or the shopping endpoint.
