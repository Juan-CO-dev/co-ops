# Brand-icon presence (level B) — design

**Date:** 2026-07-15
**Status:** approved (brainstormed with the visual companion; intensity "B", breathing loader chosen)
**Scope:** presentational only — no data, auth, RLS, or migrations.

## Goal

Use the CO brand icon (`public/brand/co-icon.png`, the dagger-through-a-sub mark) more across the app, at a **moderate** intensity: present as brand moments, not wallpaper. The icon is detailed, so it's used as a small solid mark, a large faded watermark, and a breathing loading beat — never as tiny inline decoration.

## Components (single source of truth)

### `components/BrandMark.tsx`
Wraps the icon so the asset path, sizing, and a11y semantics live in ONE file.
- Props: `size` (px, number), `variant?: "solid" | "watermark"` (default `"solid"`), `className?`, `title?`.
- `"solid"` → a real mark: `alt="Compliments Only"` (or `title` override).
- `"watermark"` → decorative: `aria-hidden`, empty `alt`, low opacity applied by the consumer or a default (~0.11).
- Renders a plain `<img src="/brand/co-icon.png">` (matches the existing wordmark approach — a ~100KB static asset doesn't need next/image; keeps client/server usage identical). Include the `eslint-disable-next-line @next/next/no-img-element` used elsewhere.

### `components/EmptyState.tsx`
Reusable empty-state: a faded `BrandMark variant="watermark"` behind/above a message + optional children. Server-component-friendly (no client hooks). Becomes the pattern for future empty states.

## Placements (the "B" set — five spots)

1. **Dashboard header mark** — `app/(authed)/dashboard/page.tsx` (the greeting block ~L463): a `BrandMark size={28}` to the left of the label/greeting, in a flex row. Dashboard **landing only** — not other page headers.
2. **Loading beat** — `app/(authed)/loading.tsx`: replace the gold ring spinner with a **breathing** `BrandMark size={52}` above the wordmark (the icon IS the indicator). Keep the wordmark + `sr-only "Loading…"`.
3. **Empty-state watermark** — apply the new `EmptyState` to the primary `/reports` empty state (`app/(authed)/reports/page.tsx`). Establishes the pattern; not retrofitted to every list this pass.
4. **Login lockup** — `app/page.tsx` gold header band: a `BrandMark size={34}` above the wordmark image.
5. **PIN keypad accent** — `components/auth/PinKeypad.tsx`: a small `BrandMark size={22}` above the keypad.

## Motion

Breathing keyframe in `app/globals.css`, gated on reduced-motion:
```css
@media (prefers-reduced-motion: no-preference) {
  @keyframes co-breathe { 0%,100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.09); opacity: 1; } }
  .co-breathe { animation: co-breathe 1.8s ease-in-out infinite; }
}
```
Reduced-motion users get a static icon + wordmark (no `.co-breathe` animation applies). The class is only decorative; the loading state is still conveyed by the wordmark + `sr-only` text + `aria-busy` on the existing `<main>`.

## Scope guardrails (keeps it "B", not "C")
- Header mark on the dashboard landing only.
- Empty-state watermark on `/reports` as the established pattern (other lists left for a later pass).
- No per-page header marks, no section-header watermarks, no icon bullets.

## Verification
- `npm run build` (CI gate) + `npm run typecheck`.
- Visual check of: login, loading (motion + reduced-motion), dashboard header, `/reports` empty range, PIN entry.

## Risk
Low — purely presentational; no logic, auth, data, or migration touched. Fully reversible.
