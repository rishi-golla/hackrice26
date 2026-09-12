# Conversational cursor — interaction and visual design plan

Status: planning only. Private local document; never commit or publish this file.

## Purpose and precedence

Translate “I am talking to my cursor” into implementable visual behavior on macOS and Windows. Read `specs/2026-09-12-cursor-financial-bodyguard-design.md` first. This supplements implementation Tasks 1, 5, 7 and 8; it does not authorize coding. README edits require a separate user request.

## Character and visual system

Keep the OS pointer fully visible and untouched. Render a compact halo beside it, not an animated replacement pointer. The character never warps the pointer or takes control of clicks. Use one passive overlay surface on the selected display and a separate interactive response surface.

| Property | Decision |
|---|---|
| Character footprint | 18 × 18 DIP; center offset 18 DIP right and 18 DIP down from pointer |
| Idle appearance | Quiet blue dot/ring while enabled; hidden when disabled |
| Listening | Expanding ring 18–26 DIP with visible microphone state |
| Thinking | Small rotating arc; no fake progress percentage |
| Speaking | Ring pulses from playback amplitude or steady speaking animation |
| Reduced motion | Static state icon plus text; no rotation or pulsing |
| Bubble width | 280 DIP default; forecast expands to 360 DIP |
| Bubble spacing | 16 DIP from cursor anchor, 12 DIP minimum inset from work-area edge |
| Text | System font, 14 DIP body, 12 DIP metadata, 20 DIP primary amount |
| Surface | Dark neutral #111827, text #F9FAFB, secondary #D1D5DB |
| Accents | Blue #60A5FA; safe #34D399; reserve #FBBF24; negative #F87171 |
| Accessibility | Text/icon accompanies color; keyboard focus visible; verify contrast before shipping |

These are proposed design values, not proof of contrast or cross-platform rendering. Verify actual text contrast and native DPI rendering during implementation.

## Text mockups

Listening, anchored to cursor with no large panel:

```text
↖  ◉  Listening…
```

A spoken answer with a temporary visual companion:

```text
↖  ◉   ┌──────────────────────────────────┐
        │ $200 tickets                 × │
        │ Projected negative balance     │
        │ −$80 minimum · Sep 16           │
        │ Rent and utilities arrive first│
        │ [Show projection] [Edit amount]│
        │ Synthetic demo · fixed Sep 12   │
        └──────────────────────────────────┘
```

Follow-up clarification:

```text
↖  ◉   “Do you mean the $200 tickets
         or the $50 headphones?”
        [Tickets] [Headphones] [Type]
```

Expanded projection:

```text
┌──────────────────────────────────────┐
│ $200 tickets · Buying Sep 12      Pin │
│ Baseline / With purchase              │
│ [14-day curves, reserve and low point]│
│ Lowest: −$80 · Sep 16                 │
│ $600 rent · $80 utilities             │
│ Scheduled income is an assumption    │
│ [Change date] [Edit amount] [Close]    │
│ Synthetic demo · fixed Sep 12         │
└──────────────────────────────────────┘
```

## Lifecycle and input rules

| Event | State and response |
|---|---|
| Monitoring enabled | Idle halo; no microphone activity |
| Talk key pressed | Stop old playback, enter listening, capture context once if permitted |
| Talk key released | Stop mic, transcribe, thinking state |
| Valid question | Call deterministic tool and display result; speak matching facts |
| Ambiguous reference | Clarifying state; keep question until answered/dismissed |
| Provider failure | Short error plus retry/typed input; stop spinner |
| Escape | Stop mic/audio, cancel turn generation, clear temporary visuals |
| New talk activation | Barge-in; invalidate old speech and pending turn |
| Disable monitoring | Clear passive overlays and stop capture; retain explicit typed interaction only |
| Account/mode change | Clear context and turns; discard old results |
| Lock/suspend/quit | Stop mic, capture, timers and workers immediately |

Default hold-to-talk proposal: Control+Shift+Space on both platforms, user-configurable after collision checks. Verify actual press/release delivery before committing to this binding. If unavailable, label toggle-to-talk behavior explicitly. Do not intercept ordinary typing or log other keys. Recording stops at 30 seconds even if release never arrives.

The halo tracks the real pointer on the selected display. A response bubble anchors once when displayed; it does not chase the user. If the pointer is on another display, hide the character and give explicit selected-display guidance rather than analyzing a different display silently. Bubble layout prefers lower-right, flips left/up near edges, then clamps within the work area. No automatic focus stealing for passive answers. Typed input or edit opens only after explicit interaction.

Passive bubbles dismiss eight seconds after speech ends, or eight seconds after render in text-only mode. Hover, keyboard focus or Pin pauses dismissal. Clarifications and action confirmations never time out visually; their underlying data/action may expire and must then be refreshed. Annotations clear on cursor departure, new capture, disarm or five seconds. Pinned purchases preserve semantic reference only, never old coordinates.

## Content rules

Lead with the useful answer, then its reason. Say “projected,” identify scheduled-income assumptions, and display mode/freshness with every financial result. Never say “I blocked the purchase.” Never speak an amount different from the chart. Keep default voice answers under about 40 words; offer detail through a follow-up or expanded chart. Financial data is spoken only while the user's configured speech output is enabled; provide an obvious mute control.

## Implementation checklist and review evidence

- [ ] Implement CursorCharacter and ConversationBubble under Task 8 using these states.
- [ ] Put position/clamping and dismissal timers in pure testable functions, with injected clock.
- [ ] Test bottom-right, top-left and negative-origin work areas and 125%/200% scaling.
- [ ] Test listening → thinking → speaking → idle; clarification persistence; provider error recovery.
- [ ] Test pinned bubble remains stationary while halo follows pointer.
- [ ] Test Escape/barge-in suppress late results and stop actual audio.
- [ ] Test clicking, dragging, text selection, scrolling and native cursor shape changes underneath.
- [ ] Test keyboard access, readable focus order, reduced motion and text contrast on both systems.
- [ ] Save screenshots for each state as local verification evidence; do not publish unrelated internal notes.

Acceptance: the main three-turn demo can be completed without opening a persistent chat window; native pointer actions remain unchanged; no microphone use occurs before explicit activation.

## Local privacy and README constraint

This file is part of the visible plan set at `plans/`; keep it aligned with implementation and do not edit README unless requested.
