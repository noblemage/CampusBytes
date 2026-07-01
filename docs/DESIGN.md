# CampusBytes — Design Guide

Reference for anyone working on the UI — human or agent. If you're about to add something new, check this first.

---

## The Aesthetic

Think Apple Notes crossed with a dark-mode terminal. High-end, restrained, never loud. This is not a generic campus app — it's a real operational tool and should feel like one.

> **Zinc is the default. Color only appears where it carries meaning.**

When in doubt, don't add color.

---

## Colors

Everything structural uses Tailwind's `zinc` scale:

| Role                  | Token          | Hex       |
|-----------------------|----------------|-----------|
| Page background       | `zinc-950`     | `#09090b` |
| Card background       | `zinc-900`     | `#18181b` |
| Inset / input bg      | `zinc-950`     | `#09090b` |
| Primary borders       | `zinc-800`     | `#27272a` |
| Secondary borders     | `zinc-700`     | `#3f3f46` |
| Muted text / labels   | `zinc-400`     | `#a1a1aa` |
| Body text             | `zinc-300`     | `#d4d4d8` |
| Primary text          | `zinc-100`     | `#f4f4f5` |
| High-contrast element | `zinc-200`     | `#e4e4e7` |

The only non-zinc colors used are `emerald` (active/valid/live) and `red` (blocked/error). They are never decorative — they only show up when something meaningful needs to be communicated. Metrics, data labels, audit log tags, and neutral buttons all stay zinc.

---

## Typography

- **Font**: `Outfit` everywhere. The pixel font (`font-pixel`) is only used in the footer watermark.
- Headings: `font-bold text-zinc-100`
- Section labels (metadata-style): `text-xs font-bold text-zinc-400 uppercase tracking-wider`
- Body: `text-sm text-zinc-400`
- Input values: `text-sm font-bold text-zinc-100`
- Placeholders: `placeholder-zinc-600`

---

## Language

This is the part that matters as much as the visuals. The copy should feel like a calm, competent person wrote it — not a developer leaving placeholder text, not a marketing team, not a chatbot.

**The voice is: direct, factual, institutional.** Short sentences. No fluff.

### Terminology

These are fixed. Don't use alternatives.

| Use                       | Not                                  |
|---------------------------|--------------------------------------|
| Check-in / Checked In     | Redeem / Redeemed / Redemption       |
| Approve Check-in          | Approve Meal / Confirm               |
| Override Check-in         | Force Redeem / Mark Done             |
| Pass                      | Meal Pass / Ticket / Token           |
| Sign In / Sign Out        | Login / Logout                       |
| Publish Menu              | Save Menu / Update / Submit          |
| Daily Menu Manager        | Today's Menu / Set Menu              |
| Warden Dashboard          | Warden Panel / Admin Area            |
| Register Device           | Enable Biometrics / Setup Passkey    |
| Copy Yesterday            | Autofill / Import / Copy Menu        |
| Close Window              | Dismiss / Cancel                     |
| Back to Dashboard         | Go Back / Return                     |

### Writing Rules

- Sentence case everywhere. The only uppercase text is short metadata tags like `LIVE` or `DEMO ACCOUNTS` — and only when used with `tracking-wider` as a deliberate visual treatment.
- Button labels are imperative verb phrases, 1–3 words: "Sign In", "Publish Menu", "Approve Check-in".
- Loading states use present-progressive: "Signing In...", "Publishing...", "Copying".
- Error messages state what happened. Format: `[What happened]. [Why, if not obvious].` — no prefix, no apology.
- Placeholders are examples, not instructions: `e.g. Idli, Sambar, Chutney` not `Enter breakfast items here`.

### What the app never says

No exclamation marks. No emoji in the UI. No "Oops", "Uh oh", "Great", "Success!", or any emotional filler. No "Are you sure?" confirmations. No passive voice in errors ("The pass could not be verified" → "Invalid or expired hash."). No over-explaining — if the label says "Breakfast", the placeholder doesn't need to elaborate. If the daily menu is empty or has not been updated yet, hide the menu display entirely instead of showing a fallback placeholder message.

### Reference messages

| Situation                          | Message                                                          |
|------------------------------------|------------------------------------------------------------------|
| QR pass already used               | This pass has already been checked in.                           |
| QR pass invalid / expired          | Invalid or expired hash.                                         |
| Student fees unpaid (student view) | Mess fee pending. Contact the administration.                    |
| Student fees unpaid (warden view)  | Check-in blocked. Meal access is suspended due to pending fees.  |
| No audit log entries               | No check-ins logged today.                                       |
| Yesterday's menu is empty          | No menu was found for yesterday.                                 |
| Yesterday's menu copied            | Yesterday's menu copied.                                         |

---

## Components

### Cards

Always use the `glass-card` class — `bg zinc-900`, near-invisible border, deep shadow, lifts on hover. Don't replace it with raw `bg-zinc-*` divs unless you're building an inset section inside an existing card.

### Buttons

Three tiers:

1. **Primary** — `bg-zinc-200 hover:bg-white text-zinc-900` — the main action on any given screen.
2. **Secondary** — `bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-zinc-300` — everything else.
3. **Semantic** — `bg-emerald-500 hover:bg-emerald-400 text-zinc-950` — only for the "Approve Check-in" action in the Warden flow. The single exception to the zinc-only rule.

Disabled states use `cursor-not-allowed` with muted zinc tones, not just `opacity-50`.

### Status Badges

`text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider`

- Active / Cleared: `bg-emerald-950/40 text-emerald-400 border border-emerald-900`
- Checked In / Inactive: `bg-zinc-900 text-zinc-500 border border-zinc-800`
- Suspended: `bg-red-950/40 text-red-400 border border-red-900`
- Live (Audit Log): `bg-emerald-950/40 text-emerald-400 border border-emerald-900`

### Form Inputs

Standalone: `bg-zinc-950 border border-zinc-800 rounded-xl`, focus `border-zinc-500`. No glow, no color ring.

Inline (Daily Menu Manager style): `bg-transparent border-none` inside a row container that handles the border.

### Dividers

`<div className="border-b border-zinc-800" />` — never `<hr>`.

---

## Animation

Present but minimal. Nothing animates for decoration.

| Animation          | Where                                      |
|--------------------|--------------------------------------------|
| `animate-fade-in`  | Sections and modals appearing              |
| `animate-float`    | Auth cards on login screens                |
| `animate-slide-in` | Panels sliding in                          |
| `glass-card:hover` | Card lift on hover                         |
| Shooting stars     | Ambient detail on the student pass banner  |

No `animate-bounce`, `animate-ping`, or pulsing on status elements. Buttons and inputs use `transition-colors` only, not `transition-all`.

- Dynamic Timers: Do not add flashing, spinning circular indicators or color-changing countdown graphics. Use simple, monospace-aligned static helper text instead (e.g. `Refreshing in 30s` set to `tabular-nums` so numbers don't jump) to keep the UI clean and terminal-like.


---

## Background

Pure `zinc-950`. A dot grid sits on top — faint static dots on mobile, a subtle spotlight effect on desktop. That's it. No gradients, blobs, or noise textures anywhere.

---

## Anti-patterns

Things that have been tried and removed — don't bring them back:

- Colored metric cards (amber for Breakfast, blue for Lunch, etc.) — data doesn't need color coding
- Pulsing green dot on the Live badge
- Rainbow or multi-colored dashboard chrome
- `bg-white` surfaces
- Neon glows or bright borders on structural elements
