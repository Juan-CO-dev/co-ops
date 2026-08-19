# Provenance — CO-OPS visual refresh handoff

**Origin:** Juan's Claude-design session. Received 2026-08-19. Archived into the repo
unmodified by the token-floor PR (`feat/token-floor`) so the arc has a stable reference
that does not depend on a scratch directory.

**Authority ladder, highest first:**

1. **The repo.** Routing, data shapes, gating, permissions, field names, component
   composition, and how any screen ultimately renders are settled by the code. Where this
   handoff and the codebase disagree about any of that, the codebase wins and the handoff
   is wrong. The handoff's own README says this first, and it is right.
2. **`README.md` — the reconciled design-system table.** This is spec: colors, type sizes,
   weights, letter-spacing, radii, borders, shadows, control geometry, the three button
   grammars, the two label roles, the border-token table, and the non-token values with
   their justifications. Values here were derived by reading the repo, then reconciled
   against `app/globals.css`.
3. **`github.md` — working notes, NOT authoritative.** A per-surface source map plus the
   accumulated per-turn findings log from the design session. Useful as an index of which
   components and i18n keys each frame was built from. Its per-turn annotations record
   in-progress reasoning, including conclusions later superseded within the same document.
   Do not cite it as spec.
4. **`CO-OPS Refresh.dc.html` — the design document.** 39 numbered turns of static frames,
   newest at the top. Styling is high fidelity; **content is illustrative**. Every figure,
   name, date and quantity in the frames is fabricated for the mock — real values come
   from the existing loaders. Nothing here should be copied as markup; it is a reference
   for visual decisions to apply using the app's established patterns.

**Drift warning.** The design work was done by reading the repo at a point in time, and the
repo moved on. Every bug it reports must be re-verified in the code before acting. The
token-floor PR already found two drifts: the `LocationChecklistTab` destructive-hover sites
had moved from lines 438/450 to 452/464, and the handoff's expected "gold text on dark
storefront mastheads" exceptions do not exist (no file under `app/order/*` uses
`text-co-gold-deep`).

**Corrections found while executing against this handoff**, recorded so the next reader does
not re-derive them:

- The README's proposed fix for the tinted cta pills — adopt the `AlertPill` danger
  spelling — is not sufficient on its own. `AlertPill`'s `danger` tone was
  `bg-co-danger-surface` + `text-co-danger` (`#FF3A44` on `#FFE4E4`) = **2.94:1**, which
  fails AA at essentially the same ratio as the 2.91:1 bug it was meant to replace. The
  token floor moved that tone to `--co-cta-text` `#B3252C` = 5.43:1.
- `AlertPill`'s `warn` (1.95:1) and `ok` (2.49:1) tones also fail AA and are still open.
- The README's "zero AA failures" claim describes the **design document**, not the app.

**Status:** the token floor (`--co-gold-text`, `--co-cta-text`, `--co-confirm` pair,
`--co-surface-inset`) plus handoff bugs #13, #16, A11Y-1 and A11Y-2 have landed. The
remaining bugs, the restyle sweep, and every item under "Proposals" are unbuilt — proposals
in particular are ideas to discuss with Juan, not work items.
