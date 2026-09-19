# Design Memory

Captured style decisions for `apps/pwa`, following the Solana Foundation design
skill (<https://github.com/solana-foundation/ai-skills/tree/main/sf-design-skill>).
The token contract lives in `apps/pwa/src/app.css`; this file records the *why*.

## Brand Tone

- **Adjectives:** utilitarian, technical, calm, precise. A terminal-flavoured
  quest console for developers at a hackathon.
- **Avoid:** the multicolor Solana gradient as UI chrome, glow/halo effects,
  gradient text, decorative animation, more than one accent per view,
  heavy letter-spacing, sub-12px captions.

## Layout & Spacing

- **Density:** comfortable. 8px grid via `--sp-1` (4px) through `--sp-8` (64px).
- **Grid:** single 780px column (`.shell`); the console frame is 800px; the
  simulator is 1180px two-column, collapsing under 820px.
- **Corner radius:** two values only. `--radius-sm` 4px for controls and small
  tiles, `--radius-md` 8px for cards and sections, `--radius-full` for pills.
- **Shadows:** none for elevation in dark mode; lighter surfaces
  (`--bg-raise`) do the job. The only shadow is on the native `<dialog>`.
- **Touch targets:** 44px minimum (`--tap`). Text-only actions use `.btn-link`
  which still reserves 44px.
- **Safe areas:** `--safe-*` on the sticky bars and the console frame;
  viewport uses `100dvh`.

## Typography

- **Families:** two. Inter/system sans for headings and body, system mono for
  labels, prompts, buttons, data.
- **Scale:** `.display` 32–48px/700, `.h1` 24–32px/600, `.h2` 20–24px/600,
  `.h3` 17px/600, `.body` 15px/400, `.caption`/`.label` 12px.
- **Tracking:** only `.label` carries letter-spacing (0.04em, uppercase mono).
  Headings use the default −0.01/−0.02em from the scale. Nothing else sets
  letter-spacing.
- **Details:** `text-wrap: balance` on headings, `pretty` on body; `.tnum`
  (tabular numerals) on any number that updates or sits in a column.
- **Floor:** 0.75rem. Nothing renders smaller, including on mobile.

## Color

- **Surfaces:** `--bg` #000, `--bg-sunken` #0a0a0a, `--bg-raise` #111.
- **Ink:** `--ink` #ededed, `--ink-mute` #a3a3a3, `--ink-faint` #7a7a7a
  (all AA on black; faint is 4.9:1).
- **Accent:** one. `--accent` Solana purple #9945ff (4.6:1 on black) for links,
  primary buttons, active nav, focus rings, prompt glyphs. `--purple` is an
  alias for older markup.
- **Semantic:** `--green` success/owned/live/pass, `--red` error/fail,
  `--amber` warning/simulated. Each has a `-wash` for tinted backgrounds. Green
  is never used for links, CTAs, or data that is not a success state.
- **Rules:** `--rule` #333 (3.1:1, passes AA for component edges),
  `--rule-soft` #1f1f1f for table row dividers, `--rule-strong` #444 for ghost
  button borders.
- **Gradients:** none. `--solana-gradient` was removed on 2026-09-17.

## Interaction Patterns

- **Forms:** visible labels above inputs (mono prompt style), errors rendered
  inline under the form with `role="alert"`, never in a toast. Inputs are
  16px on coarse pointers so iOS does not zoom.
- **Primary action:** exactly one filled `.btn` per view. Secondary actions are
  `.btn-ghost`; destructive are `.btn-danger` and go through a native
  `<dialog class="dialog">` confirmation, never `window.confirm`.
- **Loading:** structural `.skeleton` blocks that mirror the loaded layout, not
  spinners. Skeleton pulse animates opacity only.
- **Empty states:** one sentence plus one next action.
- **Live status:** `.pill` with `.pill-ok / .pill-warn / .pill-bad`,
  `role="status"` and `aria-live="polite"`.
- **Motion:** feedback under 200ms (`--dur-fast` 120ms, `--dur` 200ms),
  `ease-out` on entrances, compositor properties only (transform, opacity,
  filter). Hover styles live inside `@media (hover: hover)`. Looping animation
  is limited to the live dot, the log cursor, and skeletons.

## Accessibility Rules

- **Focus:** 2px `--accent` outline with 2px offset via `:focus-visible`;
  inputs swap to an accent border plus a 2px wash ring.
- **Labels:** every input has a `<label>`; icon-only or symbol-only controls
  carry `aria-label`; decorative glyphs (terminal traffic lights) are
  `aria-hidden`.
- **Motion:** `prefers-reduced-motion` collapses all animation and transitions.
- **Contrast:** text ≥ 4.5:1, component edges ≥ 3:1 against black.
- **Zoom:** viewport allows `maximum-scale=5`; never `user-scalable=no`.

## Repo Conventions

- **Framework:** SvelteKit 5 with runes only. No stores, no Svelte 4 syntax.
- **Styling:** plain CSS. Tokens and shared utilities in `app.css`; component
  rules in each `.svelte` `<style>` block using only tokens (no raw hex).
- **Existing primitives:** `.btn` (+ `-ghost`, `-danger`, `-sm`, `-block`),
  `.btn-link`, `.input/.select/.textarea`, `.pill`, `.card`, `.note`, `.pre`,
  `.skeleton`, `.dialog`, `StatusPill.svelte`, `QrCode.svelte`,
  `SolanaMark.svelte`.
- **Not adopted:** `@solana/design-system` and Base UI are React-only, so the
  skill's component stack does not apply here; its constraints do.

## Badge pages

- `/badge` uses three stacked workspace cards: firmware, the owner's live
  console, and the community app store. The flasher owns the view's only filled
  primary action; all console and store controls remain ghost or link actions.
- App submission stays in a native dialog. Badge connectivity uses semantic
  status pills, while command feedback and the bounded live-event log remain
  inline so hardware state is visible in context.
- `/badge/docs` renders the canonical HTN OS Markdown and maps its headings,
  tables, code, links, and blockquotes back onto the existing type and token
  system rather than introducing a separate documentation theme.
- `/badge/rps` keeps gameplay state in the browser, with one primary Start
  action, semantic phase pills, player cards, and a bounded auto-scrolling
  event log.
