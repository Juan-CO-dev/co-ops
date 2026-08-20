# Handoff: CO-OPS visual refresh

## Read this first — the codebase is ground truth

**This spec is fitted onto the codebase, never the other way around.**

Routing, data shapes, gating, and how any screen ultimately looks are settled by the code in `Juan-CO-dev/co-ops`. This document exists for one purpose: to make the app **visually appealing and internally consistent**. Where this spec and the repo disagree about structure, behaviour, route names, permissions, field names, or component composition, **the repo wins and this document is wrong**.

Practical consequences:

- Do not restructure a page to match a frame here. Restyle the page the repo already renders.
- Do not add, rename, or re-gate a route because a frame implies one.
- Do not invent data. Every figure in the design frames is illustrative; the real values come from the existing loaders.
- If a frame shows something the code cannot currently produce, it is flagged below as a **proposal**. Proposals are ideas to discuss, not work items.
- Where this document reports a **bug**, verify it in the code before acting. Each one cites the file it came from.

The design work was done by reading the repo, not by imagining it. That is also why it may drift: the repo moved on. Re-read before you rely on any specific claim.

---

## Overview

A full visual pass over CO-OPS — the operations app for Compliments Only — covering every built surface in the repo plus the customer-facing catering funnel. The goal was stated by the owner as bringing an internal work app to top-tier UX: employees should enjoy using it, without changing what it does.

The output is one design document, `CO-OPS Refresh.dc.html`, holding **39 numbered turns** (`1a` … `39a`, newest at the top). Each turn is a group of full-bleed design frames for one surface family, with annotations explaining what the source does and why the design does what it does.

## About the design files

The bundled HTML is a **design reference**, not production code. It is a single self-contained document of static frames — no data layer, no routing, no interactivity beyond hover affordances.

The task is to **apply these visual decisions to the existing Next.js app**, using its established patterns: Tailwind with the `co-*` token layer in `app/globals.css`, the primitives in `components/ui/`, `components/ActionButton.tsx`, and the existing server-component page structure. Nothing here should be copied as markup.

## Fidelity

**High fidelity for styling; illustrative for content.**

Colours, type sizes, weights, letter-spacing, radii, borders, shadows, and control geometry are exact and reconciled against `app/globals.css` — treat them as specification. Copy strings are verbatim from `lib/i18n/en.json` wherever the real key exists (and the design notes say so when it does). Numbers, names, dates and quantities in the frames are illustrative and internally consistent within the document; they are not real data.

---

## The design system, as reconciled

Everything below was derived from the repo, not invented. Values that are **not** in `globals.css` are listed separately with their justification.

### Action controls — `components/ActionButton.tsx` is canonical

Its own docstring names the drift it was written to end: *"replaces the drifted per-surface copies (rounded-md vs rounded-xl, min-h 48 vs 52, ad-hoc disabled treatments) that accumulated across Build #1–C.43."*

```
BASE     inline-flex items-center justify-center gap-2 rounded-xl border-2
         font-bold uppercase tracking-[0.1em]
SIZE     default  min-h-[48px] px-5 text-sm
         lg       min-h-[56px] px-6 text-base
VARIANT  primary    border-co-text  bg-co-gold     text-co-text
         secondary  border-co-border-2  bg-co-surface  text-co-text
         danger     border-co-cta   bg-co-surface  text-co-cta   ← outline, never a red fill
```

Two things are easy to get wrong. The primary border is **`border-co-text`** (`#141414`), not gold-deep — that ink edge is what makes the primary action unmistakable. And `danger` is an **outline**: the brand book uses red sparingly, and a red fill is not the destructive treatment.

### Three button grammars coexist in the repo, all legitimate

Do not collapse them.

| Grammar | Spelling | Where |
|---|---|---|
| `ActionButton` | 12px radius, 48/56px, `border-co-text` | Operational primaries — dashboard tiles, report submits, finalize CTAs, nav |
| Admin form | `rounded-lg` 8px, 44px, `border-co-gold-deep` | Every admin form (SkuBuilder, PricingForm, ZoneForm, FaqForm, …) |
| Catering + portal | `rounded-xl`, ink fill, `text-co-cta`, `tracking-[0.12em]` | CompaniesClient, QuotesClient, PrintButton, StorefrontOrderTray |

### Control floor: 44px

`min-h-[44px]` appears 422 times across `components/`. Every real control gets it, including filter and nav chips — the `rounded-full border-2 px-3 text-xs font-bold` pattern carries it in all five places it appears (`CatalogClient:172`, `SkuCatalogClient:307`, `MenuClient:244`, `ToastTab:115`, `SalesTab:101`).

Corollaries worth stating because each one caused a real defect in this document:

- A control sized only by padding still needs the floor. An absent `height` is a value, not an exemption.
- An element declaring **both** width and height is an icon button: size both axes together, or neither. Raising one axis turns a `rounded-full` button into an ellipse.
- Never let a border condition split a control group — a stepper's `+` and `−` must be sized as one unit whether or not both have borders.
- `min-height` and `align-items:center` are paired in all 422 occurrences. A 44px control without centring does not exist upstream.
- Checkboxes keep a small visual box (20px) inside a 44px **label** hit area — `FulfillmentClient.tsx:215`, `PricingForm.tsx:98`. Do not enlarge the box.

### Cards — `.co-card` in `globals.css` is authoritative

```css
.co-card { background: var(--co-surface); border: 1px solid var(--co-card-border);
           border-radius: 1rem; box-shadow: var(--co-shadow-card); }
```

16px radius, white surface, `#F0E7C4` hairline, and the warm olive-gold elevation. Component-level cards use a second real shape — `rounded-2xl border-2 border-co-border bg-co-surface p-4 shadow-sm sm:p-5` — also 16px, also white. **Card radius is 16px and card fill is white**; both grammars agree.

Note the portal is different on purpose: `app/order/*` uses `rounded-3xl border border-co-border/70` — a softer, larger-radius card. Keep that separation.

### Border tokens encode the element class

This distinction caused four separate regressions during the pass. The token name tells you what it is for:

| Token | Value | Use |
|---|---|---|
| `--co-border` | `#E8DEB8` | Panels, inputs, cards |
| `--co-border-2` | `#D4C98E` | Control emphasis — the `ActionButton` secondary outline, `SummaryRow`'s toggle. "Stronger border for emphasis" |
| `--co-card-border` | `#F0E7C4` | The `.co-card` 1px hairline **only**. There is no `border-*` utility for it |

`#F0E7C4` on a white button fill measures 1.23:1 — an action with no perceptible edge. That is why secondary controls take `--co-border-2`.

### Labels have two roles, differing on three axes

| Role | Spec | Source |
|---|---|---|
| Group header (heads a row group) | 12px / 700 / `tracking-wide` **0.025em** / `--co-text-muted` `#4A4A4A` | `mb-1 px-1 text-xs font-bold uppercase tracking-wide text-co-text-muted` — identical `h2` in `CashReportDetail:126`, `ChecklistReportDetail:90,136,249,272`, `PmReportDetail:44,180`, `OpeningReportDetail:156` |
| Field / sub label | 10–11px / 700 / **0.12em** / `--co-text-dim` `#6E6E6E` | `PrepSection.tsx:108`, `ReportFilterBar:76,92,106,120,148`, `MixedPrepSection:126,143`, `MiscSection:119,136` |

`0.14em` is **reserved for section headers** — `PrepSection.tsx:86` (`text-lg`, and its docstring says so) and `UnifiedSearchResults`' group `h2`. `0.08em` is the small-control label (`LtoClient`, `SkuPackChainPanel:157`, `ChecklistItem:1875`).

`tracking-wide` is **0.025em**, not a loose value. Converting it wrongly collapses the two roles into one.

### Page ground

`--co-bg` is **`#FFF9E4`** (Mayo), with `body` carrying `linear-gradient(170deg, #FFFDF5 0%, #FFF3D4 100%)` over it. Contrast must be computed against this, not against a lighter cream — the difference is about 0.45 of a ratio point and it decides several AA calls.

### Non-token values used deliberately

Seven, each with a reason. Everything else in the document resolves to `globals.css`.

| Value | Role | Why not a token |
|---|---|---|
| `#FFFDF5` | Nested / inset panel fill | A deliberate second surface level under `--co-surface` white |
| `#B3252C` | cta **text** on light grounds | The source pairing `bg-co-cta/15` + `text-co-cta` measures **2.91:1**; this reads 5.35:1 |
| `#7A6015` | gold **text** | `--co-gold-deep` `#E6C84A` measures ~1.4:1 as text. Recommend adding an AA gold-text token and reserving `#E6C84A` for pressed states |
| `#C9A227` | gold border / fill **only**, never text | Non-text contrast needs 3:1; as text it is 2.38:1 |
| `#1F7A44` / `#14532D` | Confirm affordance | `ActionButton` has no green variant, and confirm/reject pairs need one |
| `#9E8C4A` | Role-badge background carrying ink text | 5.53:1 with ink; `#7A6015` would be 3.08:1 |
| `#B47C00` | MVP star | — |

### Accessibility state

Zero AA failures across 6,876 text nodes, contrast computed against the **composited** background (front-to-back alpha accumulation, starting at the element's own background). Zero text under 9px. Zero tap targets under 44px inside phone frames.

Two upstream token gaps the app should fix rather than work around:

1. **Tinted cta pills.** `bg-co-cta/15` + `text-co-cta` is 2.91:1. Used in ten places (`SkuBuilder:446`, `SkuCatalogClient:519,527`, `SkuPackChainPanel:161`, `PrepOverviewPanel:183`, `TemplateBuilderClient:369,475,1076,1081`).
2. **The destructive fill.** `bg-co-cta` + `text-co-surface` (`ItemQuestions:259`, `RecipeBuilder:494,903,1222`, `SectionsTab:286,703`) reaches only **4.06:1**. Matching source still misses AA. This document uses ink on cta (4.56:1). The app needs either a darker cta or ink-on-red as its destructive pairing.

### Responsive

Desktop frames are authored at 1280px. Phone frames are 390px and appear beside their desktop counterpart with a "What changes at 390" card naming the three decisions behind each. The rules that recur:

- Two columns become one; the sticky summary column moves to a pinned bottom bar.
- Multi-column boards become a scrolling pill row carrying per-stage counts (the catering pipeline's six stages).
- Drag-to-reorder degrades to an explicit "Move to" list, which already exists in the leads.
- Numeric tables become stepper cards. A phone keyboard over a numeric table is the worst version of any counting screen.
- Admin surfaces where the laptop is the honest primary (pricing rules, the Toast crosswalk's ID fields, the users table) go **read-only or partial on phone**, and say so, rather than cramming.
- Guards travel with consequences: a role change still carries its step-up and session-revocation warning at 390px.

---

## Bugs found in the app while designing

Each was found by reading source. **Verify before acting** — the repo may have moved.

### Correctness

1. **`lib/catering/insights` omits a pipeline stage.** It declares its own five-stage list and leaves out `out`, so an out-for-delivery lead counts in no funnel row. The board totals nine leads; the funnel adds to eight. `lib/catering/pipeline-shared.ts` has all six.
2. **`ChecklistReportDetail` renders two statuses untranslated.** `STATUS_LABEL_KEYS` covers only `open`, `in_progress`, `submitted`, `confirmed`, then falls back to the raw column value — so an auto-finalized closing shows literal `auto_finalized` and an incomplete confirmation shows `incomplete_confirmed`. Both translations exist and the reports **list** already prints them properly. Two map entries, on the report a manager opens after an unfinished night.
3. **The package picker ignores `catering_portionable`.** `loadPackagePickerMenu` filters on `active` and `catering_available` only, so an un-portioned sub is still offered as a platter option. The flag and the picker disagree.
4. **`AddPrepItemForm` never sets the line's shape.** Its POST body carries no input type; shape is inferred later from `prep_meta.columns` via `shapeFromColumns`, which this form does not write. A line created here arrives shapeless and needs a second visit to the prep editor. The five values already exist as `admin.templates.prep.input_type.*` and are already user-visible as the overview panel's chips.
5. **`FaqFormValues` carries no slug and no display order**, so neither create nor edit can set them.
6. **"Photo later" writes free text.** It appends literal `[PHOTO PENDING]` to the note instead of setting a field, so nothing can list deliveries still missing a receipt. One boolean column makes it queryable.
7. **The receiving draft key is per location** (`coops.intake.draft.<locationId>`). Two deliveries in the same hour share one draft, and the resume banner shows only a time, not a vendor.
8. **The missing-item gate is load-bearing.** The receiving template seeds each row's quantity at what was ordered, so an item that never came off the truck files as **fully received** unless someone notices. The gate that catches this is advisory — a second tap files anyway. Worth keeping advisory, worth knowing.
9. **Sub photography matches on exact name.** `SUB_IMAGE_MAP` in `components/portal/storefront-images.ts` is keyed by exact menu name; a seed-name typo silently degrades to the generic platter photo rather than erroring.

### Permissions and feedback

10. **`NAV_LINKS` advertises routes that redirect.** Ordering and Receiving are visible below level 4 and then bounce.
11. **`PipelineClient` ignores its own `writeMin` prop** and hardcodes `actorLevel >= 6`. The gate happens to match, so the page's constant is doing nothing.
12. **Password reset tells the employee nothing.** Anyone can request one, but an email only sends if `ROLES[role].hasEmailAuth`; the route returns a constant 200 either way. Roles below the email-auth threshold get silence.

### Presentation

13. **`co-gold-deep` labels are unreadable.** As text on Mayo it measures ~1.4:1 — the nav's own `PRIMARY` section headers included.
14. **The pipeline board prints raw ISO dates** (`2026-08-21`) while Insights formats the same fields through `formatDateLabel`.
15. **The catering admin surplus badge fails silently** (`app/admin/catering/page.tsx`).

---

## Proposals — not in the code

Clearly marked in the document as additions. Discuss before building.

- **At-a-glance coverage on the staff quote builder.** The bars exist on the customer side only. Someone quoting for 45 people has the same question — is the room fed — and currently no way to answer it. Also added to the review step and the placed-order page.
- **A prep-issues panel in the quote builder**, joining par counts, vendor cutoffs, capacity and unpriced SKUs against a quote.
- **An input-type picker on `AddPrepItemForm`** (Count / Portioned / Line count / Yes-No / Text). One field, using labels that already exist; see bug 4.
- **An add-platform slot on the Toast crosswalk**, for a second marketplace integration.
- **Turn `29a` designs seven placeholder routes** that render `PlaceholderCard` today. Everything in `29a` is a proposal, including the audit log, and the frames say so.
- **Ink-on-red destructive pairing** instead of the source's `text-co-surface`; see the accessibility note.

---

## What the document contains, by turn

The full per-surface source map lives in **`github.md`** at the project root — one row per surface naming the exact components, libs, and i18n keys each frame was built from. Use that as the index; it is more precise than a summary here.

Coverage: every route under `app/(authed)`, `app/admin`, and `app/order`, plus the auth surfaces, the chrome (`UserMenu`, `IdleTimeoutWarning`, `UnifiedSearchResults`), the two step-up modals, the three reports-hub detail views, the template-builder internals, and the seven placeholder routes as proposals. Four separate audits of all 173–186 components were needed to reach that; the last three each found surfaces the previous had missed.

---

## Method notes — the failure classes that cost the most

Recorded because they will recur in a rebuild, not as confession. Every one produced a visible defect.

**Key on the element's role, never on the old value.** Six separate regressions came from a find-and-replace keyed on one *spelling* of a value: `solid` vs `dashed`, inherited vs declared `text-transform`, `#F3EEDC` vs `rgba(243,238,220,α)`, two different font-size literals, `min-height` vs `height`. In each case the fix was correct and landed on the wrong population.

**Never put a threshold or a section list in the predicate.** An invented `>= 40px` floor and a "no height declared, so skip" branch each exempted exactly the population the fix was for. Tailwind's border-box reset applies to every element regardless of size; so should the fix derived from it.

**Apply a source-derived fix across the whole document in the same edit.** Scoping to the sections currently in view produced the same finding three and four times.

**Contrast depends on the composited background.** A per-value grep reported clean while 88 AA failures persisted. Composite front-to-back, `acc += a*(1-acc)`, starting at the element's own background — and read `backgroundImage`, or a gradient band resolves to transparent and reports light-on-dark text as invisible.

**When a fix oscillates, the ground assumption is wrong.** One badge was flipped three times because its composited ground is `#371A1B` — a 15% red tint over the dark band — not the flat `#141414` each round assumed, which put both red tokens near threshold.

**Normalize the box model in the same pass as the value.** `min-height` on a `content-box` element with padding adds to the padded height instead of governing it, so a 48px declaration painted 80px.

**A corrected assumption invalidates everything bundled with it.** Two wrong hexes sat in one comment; reading the token file fixed one and left the other untouched beside it.

---

## Files

| File | What it is |
|---|---|
| `CO-OPS Refresh.dc.html` | The design document — 39 turns, desktop and phone frames, annotated |
| `github.md` | Per-surface source map, sync history, and the full accumulated findings log |

`CO-OPS Refresh.dc.html` references `public/brand/co-icon.png` from the repo. All other imagery is either a real Toast S3 URL taken from `components/portal/storefront-images.ts` or an explicit placeholder.

Open the document in a browser and pan; it is authored as a canvas with newest turns at the top.
