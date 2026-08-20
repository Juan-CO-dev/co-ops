# Phase-2 Restyle Sweep — Violation Ledger

Repo `C:\Users\conta\co-ops` @ main `6357d70`. Law: `AGENTS.md` §"UI design system (token floor, 2026-08-19)" + the reconciled table in `docs/design/2026-08-19-ux-refresh-handoff/README.md` (README table is spec; `github.md` per-turn annotations are not authoritative).

**Method:** eight parallel sub-agent audits, one per surface family (A / B1 / B2 / C / D1 / D2 / D3 / E), each doing grep-then-read census against all six dimensions within a precisely scoped file list. Every finding below is a file:line citation the auditing agent actually read in context, not a pattern extrapolated from a grep hit. One agent (originally assigned Family C) went out of scope, attempted the whole app solo, and on spot-check against source contained both a confirmed factual error (two card-radius sites called "clean" that are `rounded-xl`, contradicted by the properly-scoped Family A and D1 audits and verified directly against source) and fabricated citations (specific `bg-co-gold/20`/`rounded-xl` line references in `VendorClaimPanel.tsx` that do not exist in that file — verified by direct grep). That agent's output was discarded; Family C was re-run with a narrower, single-family-scoped agent instead, and every cross-family claim it had made was re-derived independently or verified before inclusion below.

**Exclusions honored** (not audited): the dashboard tiles + mid-shift surfaces shipped in #256 today — exact file list confirmed via `git show --stat 6357d70`: `app/(authed)/dashboard/page.tsx`, `app/(authed)/mid-shift/page.tsx`, `app/(authed)/operations/receiving/page.tsx` (the LIST page — the `[id]` detail page is NOT excluded), `components/counts/CountsTile.tsx`, `components/midshift/{FridgeStrip,OperationalStrip}.tsx`, `components/ordering/{OrderingTile,ParPassWalker}.tsx`, `components/receiving/ReceivingTile.tsx`; `components/ui/*` and `app/globals.css` (frozen); `app/global-error.tsx`; the 7 `PlaceholderCard` stub routes named in `github.md:172` (tips, ai, operations/prep, operations/overlay, operations/synthesis, feedback, recipes); email templates (`lib/email*`).

**Stub-route footnote:** seven *additional* routes are also trivial `PlaceholderCard` wrappers but are **not** in the excluded-7 list, so they were checked: `app/deep-cleaning/page.tsx` (Family A), `app/training/page.tsx`, `app/announcements/page.tsx`, `app/comms/page.tsx`, `app/rollups/page.tsx` (none map cleanly to A–E; noted here rather than forced into a family), `app/admin/audit/page.tsx`, `app/admin/locations/page.tsx`, `app/admin/pars/page.tsx` (Family D3). All confirmed ~20–22 lines, zero page-level styling — every one delegates 100% to `components/PlaceholderCard.tsx` (audited once, under Family B2). AGENTS.md's "Current state" narrative calls deep-cleaning checklists live; the file itself says otherwise — ground truth wins, that memory line is stale.

**Recurring violation classes** (defined once, cited by shorthand below):
- **RV-14** — field/sub-labels using `tracking-[0.14em]` (the section-header value) instead of the legal `tracking-[0.12em]`.
- **RV-16 / RV-18** — page/tile "eyebrow" kickers using `tracking-[0.16em]` (tiles) or `tracking-[0.18em]` (route-page headers) — neither is a legal value; closest analog is group-header (0.025em/`text-co-text-muted`), which these also usually miss on color.
- **RV-10** — standalone labels/microcopy (not a full ActionButton-shaped control) using ActionButton's own `tracking-[0.1em]`, which is not one of the four legal label-role values.
- **RV-08sc** — small-control chip/pill buttons using `tracking-[0.12em]` (field-label value) where the canonical anchor (`ChecklistItem.tsx:1875`) establishes `0.08em` as the small-control-label law.
- **RV-H** — explicit sub-44px height utilities (`h-7`–`h-10`, `min-h-[28–43px]`) on real controls, in place of `min-h-[44px]`.
- **RV-CTA-TEXT** — `text-co-cta` (or `text-co-danger`, same hex, same law per `globals.css`'s own comment) used as text color on a light ground; should be `text-co-cta-text`.
- **RV-CTA-BORDER** — `border-co-cta` used as the edge of a red outline on a light fill; should be `border-co-cta-text` per the law's explicit rule ("edge and label move together").
- **RV-GOLD-TINT** — `bg-co-gold/NN` ad-hoc opacity tint used for a status/warning surface where a real token (`co-surface-2`, `co-warning-surface`, `co-danger-surface`) already exists for that role.
- **RV-4G** — the admin-form grammar (`rounded-lg`, `border-co-gold-deep bg-co-gold`, 44px) appearing on an operational (non-admin-form) surface, where `ActionButton` is the documented grammar instead. Legitimate and NOT a violation on the ~45 files under `components/admin/**` / `app/admin/**` — only flagged where it leaks onto family A/B/C/E surfaces.

---

## Family A — hot path (opening / AM-prep / mid-day / closing / production / cash / pm-report + ChecklistItem/prep sections)

Audited: `app/(authed)/operations/{opening,am-prep,mid-day,closing,production}/**`, `app/(authed)/cash/**`, `app/(authed)/pm-report/**`, `app/deep-cleaning/page.tsx` (stub footnote, see above), `components/ChecklistItem.tsx`, `components/prep/**`, `components/opening/**`, `components/cash/**`, `components/production/**`, `components/photos/PhotoCapture.tsx` (shared with Family C's `IntakeLineRow.tsx`/`ReceivingForm.tsx`, audited here), `components/{OpeningTile,CashDepositTile,MidDayPrepTile,PmReportTile,NewMidDayPrepButton,MidDayPhase1Form,MidDayPhase2Form}.tsx`.

### Dimension 1 — Label roles (21 sites)

- **RV-18, 9 sites** — page-title eyebrow kicker (`text-xs font-bold uppercase ... text-co-text-dim`, sits above an `h2`/`h3`): `app/(authed)/operations/opening/page.tsx:326,436`, `opening-client.tsx:1386`, `am-prep/page.tsx:198,320`, `closing/page.tsx:535,562`, `closing-client.tsx:799,1309`. Structurally group-header role (12px/700/muted) spelled with `tracking-[0.18em]` and `text-co-text-dim` instead of legal `tracking-wide`(0.025em)/`text-co-text-muted`. Fix: batch find-replace by role, one PR.
- **RV-16, 4 sites** — tile eyebrow, same drift, different rogue value: `components/OpeningTile.tsx:55`, `CashDepositTile.tsx:24`, `MidDayPrepTile.tsx:37`, `PmReportTile.tsx:34`.
- **RV-10, 4 sites** — inline status/count chips, not ActionButton labels: `mid-day/page.tsx:223`, `MidDayPrepTile.tsx:82`, `MidDayPhase1Form.tsx:115`, `MidDayPhase2Form.tsx:240`.
- **Role mismatch (not wrong value, wrong role), 4 sites**: `components/prep/MiscSection.tsx:119,136` and `MixedPrepSection.tsx:126,143` — YES/NO toggle-chip buttons at `tracking-[0.12em]` (field/sub value) where the canonical anchor for this exact control type (`ChecklistItem.tsx:1875`) uses `tracking-[0.08em]` (small-control). Fix: align to the anchor.
- Minor color drift: `components/prep/AmPrepForm.tsx:866,886` — tracking correct (0.12em) but `text-co-text-muted` not the field/sub-label's `text-co-text-dim`.
- **Confirmed-clean anchors, verified in place** (do not touch): `PrepSection.tsx:86` (0.14em section header), `PrepSection.tsx:108` (0.12em field label), `ChecklistItem.tsx:1875` (0.08em small-control). **Zero `tracking-wide`-correct group headers exist anywhere in Family A** — every eyebrow-style label in the entire hot path uses a rogue value instead of the law's actual group-header spec.
- No `text-co-gold-deep`-as-label-text found. Clean on that specific check.

### Dimension 2 — 44px floor (13 sites + 1 systemic risk class)

- **RV-H**: `cash-client.tsx:131,180,221,249,302` (5 sites, `h-10` denomination-count inputs) · `components/cash/DenominationCounter.tsx:53` (`h-10 w-16`, the reusable component backing those 5) · `pm-report-client.tsx:465,534` (`h-10` inputs) · `components/opening/OpeningChecklistItem.tsx:210` (`h-9 w-20` clickable stepper, Opening recount flow) · `components/opening/OpeningItemAddon.tsx:82` (`h-9 w-9` icon button) · `MidDayPhase1Form.tsx:132` (`h-10 w-24`) · `MidDayPhase2Form.tsx:262` (`h-10 w-20`).
- `components/opening/OpeningSectionVerify.tsx:95`, `OpeningVerificationStation.tsx:161` — the README's own cited `rounded-full border-2 px-3 text-xs font-bold` chip pattern (claimed to carry the floor at all 5 of its cited sites) fails at `min-h-[40px]` in the Opening flow specifically — a 6th/7th site of that exact pattern, uncited by the design doc.
- `MidDayPhase2Form.tsx:272` — Save button, `h-10`, styled with ActionButton's own primary spelling (`border-co-text bg-co-gold`) but the height axis dropped to 40px. Highest severity of this class: a near-ActionButton clone failing the floor outright. Cross-ref dimension 5.
- `cash-client.tsx:269` — deposit-participant checkbox-`<label>`, sized by `px-3 py-2` padding only, no declared height at all. Law: "a control sized only by padding still needs the floor... an absent height is a value, not an exemption."
- Low-confidence/judgment call: `ChecklistItem.tsx:1442,1590,1750,1789` — real `<button>` elements styled as inline underlined text toggles (Cancel / add-note), borderline against the "inline text link in prose" exemption since they're standalone action triggers, not text-flow links.
- **Systemic risk, not independently greppable**: `cash-client.tsx:140-152` mode-toggle buttons declare only `py-2`, no height class at all — the "absent height is a value" corollary; flagging as a required manual pass, not a closed list.
- Confirmed clean: `components/production/ProductionConsumptionPanel.tsx`, `opening/{OverParModal,UnderParModal,RevokeReasonModal}.tsx` (`h-11`/`min-h-[44px]` throughout), `prep/AmPrepForm.tsx:865,885`, `opening/OpeningPrepEntry.tsx`.

### Dimension 3 — Card geometry (2 sites)

- `components/production/ProductionForm.tsx:47` and `app/(authed)/pm-report/pm-report-client.tsx:130` — both `rounded-xl border-2 border-co-border bg-co-surface p-4` (verified directly against source), the documented "second card shape" minus `shadow-sm`, at 12px instead of the required 16px `rounded-2xl`. `pm-report-client.tsx:130` repeats once per employee row in a list — one component, one fix, closes all instances.
- Everything else matching `rounded-lg`/`rounded-xl` + border in this family (list rows, inline notices, form fields — no shadow, not card-shaped) is correctly not flagged.

### Dimension 4 — Border-token roles (3 sites)

- `components/ChecklistItem.tsx:996` — **RV-CTA-BORDER**, main row's error state: `border-co-cta/60` on a `bg-co-surface` (white) fill.
- `components/ChecklistItem.tsx:1304,1366` — same, on `:hover` states (UndoButton/MarkNotDoneButton).
- `components/photos/PhotoCapture.tsx:112` — photo-picker trigger button (`border-co-border`) is a real clickable control; per the law "`co-border-2` = control emphasis," this should arguably be `border-co-border-2`. Judgment call, flagging for review.
- No `border-co-card-border` utility misuse found. Most `border-co-gold-deep` sites in this family are legitimate (warning banners / hover-pressed feedback, matching gold-deep's documented role) — not flagged.

### Dimension 5 — Button grammar coherence

`ChecklistItem.tsx` alone contains **at least five distinct hand-rolled button treatments**, none of them the `ActionButton` component:
1. Answer-chip pattern (Undo/Tag/MarkNotDone/Correction): `rounded-lg border-2 border-co-border`, 48px, `tracking-[0.12em]`.
2. Expand-panel Save (gold fill, `:1186,1526,1826,1966`): `rounded-md bg-co-gold`, 48px.
3. Expand-panel Save (red fill, `:1653`): `rounded-md bg-co-cta text-co-text` — ActionButton's own doctrine says danger is an OUTLINE, never a fill; ink-on-cta text is correct but the fill-not-outline choice isn't.
4. `YesNoButtons` (`:1875`): `rounded-lg border-2`, `tracking-[0.08em]` — the one that matches the design doc's own cited anchor.
5. `opening/page.tsx:412`, `am-prep/page.tsx:334`: `rounded-md border-2 border-co-text`, ActionButton's exact primary border color but `rounded-md` instead of `rounded-xl` — a hand-copy of ActionButton that drifted on radius.

Plus: `closing-client.tsx:1410` floating action bar (`rounded-full`, 52px, `tracking-[0.14em]`, `border-co-text bg-co-gold/95`) — another near-ActionButton-primary clone, drifted to pill radius + section-header tracking. `MidDayPhase2Form.tsx:267-294` — both the Save button and the offPar-adjust button are near-misses: Save hand-copies ActionButton's primary spelling at `rounded-md`/40px; the adjust button mixes ActionButton's `tracking-[0.1em]` with admin-form's `border-co-gold-deep`, on `rounded-md` (neither grammar's radius) — the textbook grammar-mix case. `components/production/ProductionForm.tsx:73` — **RV-4G**, admin-form spelling for the form's one primary CTA on an operational (not admin) surface.

This is the strongest "adopt `actionButtonClass`" case in the whole audit — several of these literally re-derive ActionButton's primary spelling (`border-co-text` + `bg-co-gold`) by hand rather than importing it. Flagging for design/eng discussion, not prescribing wholesale conversion.

### Dimension 6 — Leftover literals (~24 sites)

- **RV-CTA-TEXT, ~20 sites, all sampled and confirmed light-ground**: `ChecklistItem.tsx:1041,1094` (row/meta text) · `cash-client.tsx:206` (over/short readout — a money-critical indicator at ~2.9:1) · `cash-client.tsx:310` (icon-button label) · `pm-report-client.tsx:289,554,622` (error text + "Overdue" badge, twice) · `prep/PrepRow.tsx:247` · `prep/MixedPrepSection.tsx:157,224` · `prep/MiscSection.tsx:156` · `photos/PhotoCapture.tsx:121,134` · `production/ProductionForm.tsx:71` · `NewMidDayPrepButton.tsx:67` · `MidDayPhase1Form.tsx:144` · `MidDayPhase2Form.tsx:316,345`. Hover-only, lower severity: `ChecklistItem.tsx:1304,1366`. Every one should read `text-co-cta-text`.
- Not a violation: `ChecklistItem.tsx:2055` — `text-co-cta` on an inline SVG icon (graphical fill, needs only 3:1, which is met) — correctly exempt.
- `components/ChecklistItem.tsx:1904-1905` — tinted-pill contrast bug (`border-co-cta bg-co-cta/10 text-co-cta`, selected "No" answer chip) — the same documented AA gap class the README cites at other sites, undocumented here.
- **RV-GOLD-TINT**: `components/production/ProductionConsumptionPanel.tsx:168,206,215,223` — `bg-co-gold/40`, `/5`, `hover:bg-co-gold/10` (×2) on a unit-selector segmented control, where `co-surface-2` or `co-warning-surface` already exist. Lower severity: `opening/OpeningPrepEntry.tsx:672` (`hover:bg-co-gold/30`, paired with an otherwise-correct resting state).

---

## Family B1 — reports hub / trends / search (+ maintenance, written-reports, my-feedback, team/performance)

Audited: `app/(authed)/reports/**` (hub, `[type]/[id]`, `trends/ops`, `trends/team`), `app/(authed)/maintenance/**`, `app/(authed)/written-reports/**`, `app/(authed)/my-feedback/**`, `components/reports-hub/**` (except `shared.ts`, non-visual, touched by #256), `components/trends/**`, `components/maintenance/**`, `components/written-reports/**`, `components/team/**`, `components/me/MyPerformance.tsx`.

### Dimension 1 — Label roles (11 sites + 2 taxonomy notes)

- `components/trends/TrendCard.tsx:66` — field/sub-label role at rogue `tracking-[0.1em]`, should be `[0.12em]`.
- `components/maintenance/EquipmentDetail.tsx:86,98,110,122,134,145` — **6 sites**, identical field/sub-label captions at `0.1em` instead of `0.12em`.
- `components/team/PersonDetail.tsx:105,115` — "The read"/"AI Insight" captions at rogue `tracking-[0.04em]` (not a legal value at all).
- `components/team/TrendsLanding.tsx:71` — "Relevant right now" functions as a group header (introduces a list) but is `tracking-[0.1em]`/`text-co-gold-text` instead of group-header's `tracking-wide`/`text-co-text-muted`.
- `components/team/TrendsLanding.tsx:108,134` — "Ops/Team snapshot" title+link rows, 14px/`0.1em`/`text-co-text` instead of the compliant group-header idiom used elsewhere in the same family.
- **High-confidence color drift on the law's own cited anchor**: `components/reports-hub/ReportFilterBar.tsx:76,92,106,120,148` — the README (line 111) cites this exact file/line-set as the field/sub-label color anchor (`text-co-text-dim`). Current code reads `tracking-[0.12em] text-co-text-muted` — tracking is still correct, color has drifted to the group-header color. One file, five sites, on the reports-hub's own filter bar (every session).
- Taxonomy notes (not filed as hard violations, flagging for a design-owner call): a `text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted hover:text-co-text` "view all" link idiom recurs at `TrendsWidget.tsx:35`, `TeamRosterTable.tsx:34`, `TrendsLanding.tsx:113,139` — matches neither defined role. `TrendCard.tsx:46` and `me/MyPerformance.tsx:18` share an identical "card/section title" idiom (`0.12em`/`text-co-text`) matching neither role fully but consistent across 2 files — possibly an undocumented third role, not drift.
- Confirmed-clean anchors, verified in place: `CashReportDetail.tsx:126`, `ChecklistReportDetail.tsx:90,136,249,272`, `PmReportDetail.tsx:44,180`, `OpeningReportDetail.tsx:156` (group headers) and `UnifiedSearchResults.tsx:29,58` (0.14em section headers).

### Dimension 2 — 44px floor (8 sites)

`reports/page.tsx:182` (Trends chip, `min-h-[40px]`) · `components/trends/TrendControls.tsx:46,62` (segmented toggle + compare links, `min-h-[40px]`) · `maintenance-client.tsx:79` (`<select>`, `h-10`) · `maintenance-client.tsx:99` (`<input>`, `h-10`) · `components/reports-hub/ReportFilterBar.tsx:127` (`<select>`, `h-10`) · `components/reports-hub/UnifiedSearchResults.tsx:37` (person-result link, no declared height) · `:66` (page-chip link, no declared height).

### Dimension 3 — Card geometry (1 site + judgment call)

- `components/team/PersonDetail.tsx:15` — its `Section` wrapper (`rounded-xl border`) plays the identical role as `me/MyPerformance.tsx:17`'s compliant `Section` (`rounded-2xl border-2`) — same component role, two files, two radii; PersonDetail is the violator.
- Judgment call flagged for parent review: a `rounded-lg border-2 border-co-border bg-co-surface px-3 py-2/3` row/banner idiom recurs 20+ times across nearly every file in this family. None carry a shadow, so treated as a non-card row idiom per the dimension's own "bordered + padded + shadowed" definition — not counted, but reversing that call turns this into a ~20-site finding.

### Dimension 4 — Border-token roles

Clean. Zero `border-co-card-border` hits; the only `border-co-gold-deep` hits are legitimate rule/underline uses; all controls correctly use `border-co-border-2`, all passive rows correctly use `border-co-border`.

### Dimension 5 — Button grammar coherence (4 sites, one file)

`components/written-reports/WrittenReportForm.tsx:169,161` (submit / Cancel) and `WrittenReportsClient.tsx:148` (new report) — **RV-4G**: admin-form spelling (`rounded-lg`, `border-co-gold-deep`, `bg-co-gold`) on a staff surface the README's table explicitly places under `ActionButton`'s territory ("report submits"). `WrittenReportsClient.tsx:219` (Edit) uses a third, undocumented `rounded-md`. This surface doesn't import `ActionButton` at all despite sitting squarely in its documented territory — the cleanest single "convert to the component" candidate in the ledger.

### Dimension 6 — Leftover literals (~24 sites)

Dominant finding for this family. **RV-CTA-TEXT, spelled both ways**: `text-co-danger` (shares `co-cta`'s hex, same text-role law per `globals.css`'s own comment) at `CashReportDetail.tsx:76,101`, `MaintenanceReportDetail.tsx:40,62`, `PmReportDetail.tsx:59,99`, `OpeningReportDetail.tsx:130`, `maintenance/EquipmentDetail.tsx:52,151,189`, `maintenance/EquipmentOverview.tsx:24` (10 sites) plus `text-co-cta` at `ChecklistReportDetail.tsx:47,98,245,312`, `OpeningReportDetail.tsx:49,247`, `maintenance-client.tsx:117`, `written-reports/WrittenReportForm.tsx:154` (~8 sites; lower-confidence icon-vs-text judgment call on `maintenance/TempTrendChart.tsx:57,74` SVG stroke color, not counted). The five reports-hub detail views (`ChecklistReportDetail`, `OpeningReportDetail`, `PmReportDetail`, `CashReportDetail`, `MaintenanceReportDetail`) are the densest concentration of light-ground red-as-text sites found anywhere in the audit — every one has at least one, several have three-plus.

- `components/reports-hub/ReportList.tsx:108,123` — tinted-pill contrast bug (`border-co-cta/30 bg-co-cta/10 text-co-cta`), the same documented 2.91:1-class gap, undocumented at these two sites.
- **RV-GOLD-TINT**: `ReportList.tsx:113` — `bg-co-gold/20` on a "temp flags" status badge where `co-warning-surface` already exists.

---

## Family B2 — chrome / login / profile / settings / the shared PlaceholderCard component

Audited: `app/page.tsx` (the actual staff login page — tile + manager flows; despite `github.md` calling this "storefront, out of scope," the file's own docstring confirms it's "Login page — Phase 2 Session 4," not marketing — audited as in-scope), `app/verify/page.tsx`, `app/reset-password/page.tsx`, `app/(authed)/profile/**`, `app/(authed)/settings/**`, `components/UserMenu.tsx`, `components/auth/**` (11 files), `components/nav/BackLink.tsx`, `components/layout/CanvasWatermark.tsx`, `components/dashboard/{NotificationBell,NotificationList}.tsx` (not touched by #256, in scope), `components/profile/**`, `components/settings/**`, `components/{EmptyState,BrandMark,DashboardNav,DashboardBackLink,PlaceholderCard}.tsx`.

**`components/PlaceholderCard.tsx`** is the shared component behind all 14 stub routes app-wide (the 7 excluded + the 7 non-excluded footnoted at the top of this document). Any finding here would apply to all 14 uniformly — a single, high-leverage fix point.

### A confirmed lead from the design doc's own bug list

README item 13: *"`co-gold-deep` labels are unreadable... the nav's own PRIMARY section headers included."* Confirmed still present: `components/DashboardNav.tsx` uses `text-co-gold-deep` for its PRIMARY-style nav section header — gold-deep is fill/border/pressed-state only, ~1.4:1 as text, fails AA outright. High-confidence, doc-corroborated finding.

### Dimension 1 — Label roles

- **RV-18, worse than Family A's decorative-only instance — 8 sites, on real form/tile labels**: `components/auth/SetPasswordForm.tsx:95,132`, `ManagerLoginForm.tsx:186,224`, `PasswordModal.tsx:193`, `RoleTile.tsx:45`, `LocationTile.tsx:37`, `PinKeypad.tsx:192`. Here `tracking-[0.18em]` is the login flow's actual field-label value (email/password inputs) and tile-caption value (location/role picker), not a decorative kicker — the primary authentication surface's own labels are wrong.
- `app/page.tsx:252`, `components/auth/AuthShell.tsx:43` — `tracking-[0.32em]` on the login page's brand caption, paired with `text-co-text/70` (opacity-modified base text, not a defined dim/muted token). The most extreme tracking deviation found anywhere in the audit.
- `components/profile/ProfileDirectory.tsx:33` — hybrid: field tracking (0.12em) with `text-co-gold-text` color heading a list (group-header role) — matches neither role fully.
- Confirmed clean: `UserMenu.tsx:166,176,209`, `auth/IdleTimeoutWarning.tsx:162` (0.14em section headers, correct).

### Dimension 2 — 44px floor (3 sites + 1 lower-confidence)

- `components/UserMenu.tsx:147` — **`h-10 w-10`** (40px) user-menu trigger avatar in the top nav — every authenticated page. The adjacent `NotificationBell.tsx:122` in the same nav row correctly uses `h-11 w-11` (44px) — two icon-buttons side by side, one compliant, one not.
- `components/auth/IdleTimeoutWarning.tsx:172` — `h-9 w-9` (36px) dismiss button.
- `components/DashboardNav.tsx:31` — nav pill sized by padding only, no `min-h` found anywhere in the file. Lower confidence without full render context, but matches the law's "padding-only sizing needs the floor too" warning.
- Confirmed clean/exemplary: `auth/PinKeypad.tsx:329`, `PinConfirmModal.tsx:423` (digit buttons, `h-14`/`h-16 sm:h-20`, generously exceed the floor), `auth/{LocationTile,RoleTile,NameTile}.tsx` (`min-h-[120px]`), all `min-h-[52px]` auth submit buttons.

### Dimension 3 — Card geometry (2 sites + 1 lower-confidence)

- `components/profile/PublicProfileCard.tsx:18,27` — `rounded-xl` (12px) stat-tiles nested inside a card that itself correctly uses `rounded-2xl` at `:54` — inconsistency within one component.
- `components/profile/ProfileDirectory.tsx:43,79` — `rounded-xl` row items — lower confidence (may be list rows, not free-standing cards).
- Confirmed clean: `auth/{LocationTile,RoleTile,NameTile}.tsx` (`rounded-2xl`), all modal sheets (`IdleTimeoutWarning`, `PasswordModal`, `PinConfirmModal`).

### Dimension 4 — Border-token roles (8 sites)

- **RV-CTA-BORDER, dense cluster**: `app/page.tsx:273,465,518` (login page's own error banner, 3 sites), `auth/SetPasswordForm.tsx:117,154`, `ManagerLoginForm.tsx:212,246`, `PasswordModal.tsx:216` (input error-state borders) — all `border-co-cta` outlining a light fill.
- **RV-CTA-BORDER + RV-CTA-TEXT combined**: `ManagerLoginForm.tsx:259,261`, `PasswordModal.tsx:239,241`, `PinKeypad.tsx:228,230` — lockout/error banners use `border-co-cta bg-co-cta/10 ... text-co-cta`, the tinted-pill contrast-failure class, on the app's own gate.

### Dimension 5 — Button grammar coherence

- **A consistent, undocumented sixth grammar**: `SetPasswordForm.tsx:168-170`, `ManagerLoginForm.tsx:286-288`, `PasswordModal.tsx:258-260`, `IdleTimeoutWarning.tsx:174-176` — identical "auth primary submit" treatment (`rounded-xl`, `min-h-[52px]`, `bg-co-text` ink fill, `text-co-cta`, `tracking-[0.12em]`). The ink-fill + red-text pairing is contrast-compliant (dark ground, not light) — same underlying idea as the documented catering/portal grammar, just never named for auth. Flagging as a documentation gap for the law's table, not an engineering fix.
- `components/auth/LogoutButton.tsx:38-40` — `rounded-xl`, `min-h-[48px]`, `border-co-border-2`, `bg-co-surface`, `tracking-[0.1em]` — matches `ActionButton` secondary in every dimension except text color (`text-co-text-muted` vs. the component's `text-co-text`). Trivial convert-to-component candidate.
- `components/UserMenu.tsx:236-237` — **RV-4G**, profile-blurb save button.
- `components/settings/LanguageSettingCard.tsx:100`, `UserMenu.tsx:316-321` — language-toggle segmented buttons at `rounded-lg` + mixed `[0.1em]`/`[0.12em]` tracking, neither pure grammar; low severity.

### Dimension 6 — Leftover literals

- `app/page.tsx:263` — `hover:text-co-cta` on the "Manager login / Use tile login" toggle, light ground.
- `components/UserMenu.tsx:203,249` — blurb-editor error text, light ground.
- `components/settings/LanguageSettingCard.tsx:73` — form error text, light ground.
- **RV-GOLD-TINT, 5 sites**: `components/profile/PublicProfileCard.tsx:73`, `LeadershipCard.tsx:47`, `ProfileDirectory.tsx:55,62,91` — all role-badge chips.
- Confirmed compliant, worth citing: `components/dashboard/NotificationBell.tsx:134` — `bg-co-cta` as a fill (unread-count dot), exactly co-cta's correct role.

---

## Family D1 — admin: users / checklist-templates / template-builder / catalog / categories

**Governing context for D1/D2/D3**: the admin-form grammar (`rounded-lg`, 44px, `border-co-gold-deep` primary, `border-co-border`/`border-co-border-2` secondary) is the correct, documented grammar for this whole family — not flagged merely for existing. `components/admin/{StatusBadge,StepUpProvider,UnitSelect}.tsx` are the shared primitives across all of D1/D2/D3; findings there are repo-wide-admin-leverage.

Audited: `app/admin/{users,checklist-templates,categories}/**`, `app/admin/{page,layout}.tsx`, `components/admin/{users,templates,template-builder,catalog}/**`, `components/admin/{StatusBadge,StepUpProvider,UnitSelect}.tsx`.

### Dimension 1 — Label roles

- **Systemic: 13 group headers using `tracking-[0.1em]` instead of legal `tracking-wide`**, all `text-co-text-muted`, correct role/wrong tracking: `app/admin/checklist-templates/page.tsx:63`, `app/admin/categories/page.tsx:34,41`, `components/admin/templates/SectionsTab.tsx:60,83`, `ParGrid.tsx:95`, `LocationChecklistTab.tsx:93,523,579`, `components/admin/template-builder/TemplateBuilderClient.tsx:529,868`, `PrepOverviewPanel.tsx:86`, `components/admin/catalog/CatalogClient.tsx:210`. This is a family-wide, internally consistent admin convention — not random drift.
- **Second rogue value: `tracking-[0.06em]`** on small dirty-state/count badges: `TemplateBuilderClient.tsx:601,1066,1071,1076,1081,1088`. **Third: `tracking-[0.04em]`** at `TemplateBuilderClient.tsx:1012`. **Fourth: `tracking-[0.05em]`** at `SectionsTab.tsx:586`, `LocationChecklistTab.tsx:321` (identical "optional" tag, copy-pasted between two files).
- `components/admin/catalog/CatalogClient.tsx:251,449` — field/sub-label role (11px, `text-co-text-dim`) at `tracking-[0.14em]` (the reserved section-header value) instead of `[0.12em]`.
- Clean: no `text-co-gold-deep`-as-label-text anywhere (the two gold labels present, `SectionsTab.tsx:586`, `LocationChecklistTab.tsx:321`, correctly use `text-co-gold-text`).

### Dimension 2 — 44px floor

**`TemplateBuilderClient.tsx` is the epicenter** — a repeated `min-h-[40px]` string (inputs, selects, and several buttons) appears **23 times** in this one file (buttons specifically: `:1364,1373,1831,1838,1957,2206,2260,2268`; inputs/selects: `:1245,1257,1267,1292,1323,1345,1440,1698,1710,1720,1781,1941,2061`), plus 1 each in `CatalogClient.tsx:175` and `NeedsLinkQueue.tsx:165`. Law: "an absent height is a value, not an exemption" — 40px is worse, a declared-but-insufficient height.

- **`min-h-[32px]` real `<button>` pills** (all correctly paired with `items-center` — height alone is the violation): `TemplateBuilderClient.tsx:608,636,697,745,1464,1491,1790,2080`, `PrepOverviewPanel.tsx:162`, `NeedsLinkQueue.tsx:128,183`.
- `min-h-[36px]`: `TemplateBuilderClient.tsx:1755`.
- **Icon buttons, both axes under floor** (not an ellipse bug, both axes sized together but too small): `TemplateBuilderClient.tsx:1014` (`h-8 w-8`), `SectionsTab.tsx:147` and `LocationChecklistTab.tsx:305` (`h-9 w-9`, identical class string — copy-pasted).
- Recommend `TemplateBuilderClient.tsx` as its own fix-batch line item — the largest concentration of dimension-2 violations of any single file in the whole sweep (~35 sites).

### Dimension 3 — Card geometry (2 sites)

- **Verified directly against source**: `components/admin/users/UserActions.tsx:106` and `CreateUserForm.tsx:81` — both `rounded-xl border-2 border-co-border bg-co-surface p-5 shadow-lg` confirm-modal panels, 12px instead of 16px.
- Confirmed clean: dashed empty-state panels (`CatalogClient.tsx:204`, `NeedsLinkQueue.tsx:79`, `TemplateBuilderClient.tsx:304,887`) and the publish-confirm modal (`TemplateBuilderClient.tsx:2214`, verified `rounded-2xl`) all correctly 16px. `TemplateBuilderClient.tsx:2432` (`rounded-[2rem]`) is a decorative phone-frame preview mockup, not a real interactive card — noting so a future grep-only pass doesn't mis-flag it.

### Dimension 4 — Border-token roles

- `components/admin/templates/SectionsTab.tsx:353` — `border-co-gold-deep bg-co-gold/10` on a "change input type — are you sure?" warning box — not a form control, so gold-deep's role doesn't apply; should be `co-border`/`co-border-2` plus a real status-surface token (cross-ref dimension 6).
- Judgment call: `components/admin/UnitSelect.tsx:91` ("Add unit" button) and the two `h-9 w-9` steppers above use `border-co-border` where they're real interactive controls (law: `co-border-2` = control emphasis) — flagging for design review, not asserting.
- Every admin-form PRIMARY button in scope correctly uses `border-co-gold-deep` — that grammar is self-consistent throughout. No `border-co-card-border` misuse found.

### Dimension 5 — Button grammar coherence

No ActionButton or catering/portal grammar bleed-through — the admin-form grammar is applied consistently to itself across every primary button in D1 (which is why the family-wide `tracking-[0.1em]` header value above is treated as this family's own internally-consistent-but-noncompliant convention, not a mixing case). One real coherence break: `TemplateBuilderClient.tsx` mixes three border-color families across its own buttons at the same 40/44px sizing — `border-co-gold-deep` (primary), `border-co-border-2` (secondary), `border-co-cta`/`border-co-cta/50` (destructive-outline pills, `:1364,1464`) — the destructive pills are color-correct per the danger law but sit at 40px, so the grammar's own floor isn't honored even where its color role is right.

### Dimension 6 — Leftover literals

- **RV-CTA-TEXT, 24 sites, dominant finding** — near-identical `<p className="text-sm text-co-cta">{errorMsg}</p>` on white/`co-surface` form panels: `CreateUserForm.tsx:170`, `UserActions.tsx:195`, `AddPrepItemForm.tsx:103`, `LocationChecklistTab.tsx:353,536`, `NeedsLinkQueue.tsx:87`, `ParGrid.tsx:98`, `SectionsTab.tsx:381,481,659,689,710,845`, `CatalogClient.tsx:179`, `TemplateBuilderClient.tsx:631,687,710,735,1299,1585,1824,1951,2039,2042,2063,2198,2249,2253`. Sampled 3, all confirmed light-ground. Purely mechanical fix.
- **RV-GOLD-TINT tinted-pill bug, undiscovered sites beyond the README's known list**: the README names `TemplateBuilderClient:369,475,1076,1081` — **confirmed already fixed** (now `bg-co-danger-surface` + `text-co-cta-text`). The same bug class persists undocumented at `app/admin/checklist-templates/page.tsx:114`, `CatalogClient.tsx:242,346`, `TemplateBuilderClient.tsx:1012,1364,1376,1464`.
- **Correction to the design doc**: `SectionsTab.tsx:286,703` — README cites `text-co-surface` (4.06:1, fails AA); current code reads `bg-co-cta ... text-co-text` (ink-on-cta), the law-compliant pairing. Already fixed; don't re-file.
- **RV-GOLD-TINT, active-tab pattern, 7 sites** — identical ternary `active ? "border-co-gold-deep bg-co-gold/25 text-co-text" : ...`: `NeedsLinkQueue.tsx:129`, `TemplateBuilderClient.tsx:362,1757,2027,2413`, `CatalogClient.tsx:173`, `ItemsPageTabs.tsx:21`. Plus singletons `PrepOverviewPanel.tsx:66`, `SectionsTab.tsx:353`. Law: an active/pressed state is exactly `co-surface-2`'s documented role.

---

## Family D2 — admin: vendors / SKUs / items / recipes

Audited: `app/admin/{vendors,skus,items,recipes}/**`, `components/admin/{vendors,skus,items,recipes}/**` (25 files). Same governing context as D1.

**Two of the design doc's own cited AA bugs are already fixed, confirmed by direct re-read — worth reporting as closed, not re-filing**: (1) tinted cta pills at `SkuBuilder:446`, `SkuCatalogClient:519,527`, `SkuPackChainPanel:161` — all four now `bg-co-danger-surface ... text-co-cta-text`. (2) destructive fill at `ItemQuestions:259`, `RecipeBuilder:494,903,1222` — all now `text-co-text` (ink), the correct pairing. Both anti-patterns recur elsewhere in the same files, undocumented — see below.

### Dimension 1 — Label roles

- **The D1 `tracking-[0.1em]` admin-header pattern recurs, 10 more sites**: `SkuBuilder.tsx:104`, `VendorSkusCard.tsx:160`, `SkuCatalogClient.tsx:414`, `ItemsClient.tsx:61`, `ItemRow.tsx:209,302`, `ItemQuestions.tsx:90`, `RecipeCateringFlags.tsx:46,56`, `VendorDetailClient.tsx:162` — combined with D1's 12, a 22-site, admin-family-wide rogue value.
- **The `0.06em` status-badge drift recurs, 5 sites**: `SkuBuilder.tsx:446`, `SkuCatalogClient.tsx:519,527`, `SkuPackChainPanel.tsx:161`, `VendorDetailClient.tsx:1089` — vs. the `0.08em` majority for the identical badge role elsewhere in the same files (`SkuCatalogClient.tsx:514`, `VendorSkusCard.tsx:312,317`, `VendorListClient.tsx:120,134,142`).
- **`0.05em`, 3 more sites**: `ItemRow.tsx:179,387`, `ItemQuestions.tsx:223`. Badges aren't one of the four named roles, so this is a drift finding rather than a hard violation — but `0.08em` is the de-facto legal value for this role in this family, making the `0.05`/`0.06em` sites the outliers.
- `SkuPackChainPanel.tsx:157` — confirmed matches the README's own cited small-control anchor (0.08em), compliant.

### Dimension 2 — 44px floor

- `components/admin/recipes/RecipeCateringFlags.tsx:116` (`min-h-[32px]` toggle chip), `:174` (`min-h-[32px]` numeric input).
- `components/admin/vendors/MultiSelectChips.tsx:41` — `min-h-[40px]` toggle chip.
- `VendorDetailClient.tsx:571` (`h-9`), `:603` (`h-9 w-9`) — interactive color-swatch buttons; internally inconsistent against the same file's own `:471` (`h-11 w-11`, compliant) for a visually identical control type.
- Confirmed clean: `VendorDetailClient.tsx:453,590` are non-interactive read-only `<span>` pips (no onClick), correctly exempt.

### Dimension 3 — Card geometry

No genuine free-standing card-radius violations — panels are consistently `rounded-lg` (admin-form's own sub-section convention, acceptable) or correctly `rounded-2xl`/`rounded-xl` for empty states and modals. Clean.

### Dimension 4 — Border-token roles

Clean — `border-co-gold-deep` usage is consistently on real form controls (correct admin-form grammar). No `border-co-card-border` misuse. Judgment call, not asserted as a hard violation: interactive toggle/chip/swatch defaults use `border-co-border` instead of `border-co-border-2` at `RecipesClient.tsx:54`, `SkuCatalogClient.tsx:308`, `MultiSelectChips.tsx:44`, `VendorDetailClient.tsx:456,474,574,604` — widespread enough it may be an established sub-convention rather than drift; flagging for a design-system ruling.

### Dimension 5 — Button grammar coherence

**The red-filled destructive-confirm anti-pattern (same class as D1's `SectionsTab.tsx`) is the dominant "delete" pattern across this entire family**: `ItemQuestions.tsx:259`, `RecipeInputRow.tsx:75`, `RecipeOutputRow.tsx:68`, `RecipeBuilder.tsx:494,903,1222` — 6 sites, 4 files. Every one pairs `border-co-cta bg-co-cta` (fill) with `text-co-text` (correct ink-on-cta contrast, but still a fill where the danger doctrine calls for an outline). "Wrong grammar, right contrast" — the fix is architectural (adopt `ActionButton danger`), not a token swap.

### Dimension 6 — Leftover literals

**RV-CTA-TEXT, ~35 sites — the single highest-count pattern in the ledger.** Near-identical `<p className="text-sm text-co-cta">{errorMsg}</p>` in nearly every D2 form: `SkuBuilder.tsx:375,523,576,667`, `VendorSkusCard.tsx:233`, `SkuCostPanel.tsx:85`, `SkuLocationOverlay.tsx:196`, `SkuPackChainPanel.tsx:261,293`, `SkuCatalogClient.tsx:425`, `ItemRow.tsx:205,361`, `AddItemForm.tsx:180`, `ItemQuestions.tsx:156,245,266`, `RecipeCateringFlags.tsx:123`, `RecipeBuilder.tsx:392,434,478,785,1128,1163`, `VendorDetailClient.tsx:278,410,616,734,870,952,1118,1289,1339` (9 sites in one file alone), `VendorListClient.tsx:160,167,361`. One literal string pattern, scriptable in a single PR.

- Tinted-pill contrast bug, undocumented: `ItemQuestions.tsx:238`, `RecipeInputRow.tsx:62`, `RecipeOutputRow.tsx:55`, `RecipeBuilder.tsx:895,1214` — the "confirm delete" warning wrapping each destructive button above.
- **RV-GOLD-TINT**: `VendorListClient.tsx:121` (`bg-co-gold/20 text-co-gold-text`, active/inactive vendor badge).

---

## Family D3 — admin: catering (capacity / faq / fulfillment / lto / menu / packages / prep-demand / pricing / rate-rules / zones)

Audited: `app/admin/catering/**` (10 subroutes), `components/admin/catering/**` (19 files — the largest single admin subdirectory). Stub footnotes confirmed trivial `PlaceholderCard` delegates, zero own styling: `app/admin/{audit,locations,pars}/page.tsx`.

**Five of the design doc's cited 44px filter-chip anchors all check out**: `CatalogClient:172` (D1), `SkuCatalogClient:307` (D2), `ToastTab.tsx:115`, `SalesTab.tsx:101` (D3) — all confirmed `min-h-[44px]`. The claim holds exactly at its five cited sites, while the identical visual pattern fails the floor at 16+ *uncited* sites elsewhere (see D1). `PricingForm.tsx:98` and `FulfillmentClient.tsx:215` — the cited checkbox-44px-label anchors — also confirmed correct.

### Dimension 1 — Label roles

- **RV-18 confirmed in a third family**: `ToastTab.tsx:191,216,273,276`, `SalesTab.tsx:103` — 5 sites.
- **`tracking-[0.08em]` field-label pattern (D1/D2's rogue-but-consistent admin convention) is dense here too**: `FulfillmentClient.tsx:148,194`, `PricingClient.tsx:114`, `PrepDemandClient.tsx:82,353,359,373,444`, `CapacityClient.tsx:153`, `LtoClient.tsx:166,195,210,224,244,263,275,290,387,438` (10 sites in one file), `MenuClient.tsx:201` — ~19 sites.
- `LtoClient.tsx:166` vs `:308` — two save-style buttons in the same file use different tracking (`0.08em` vs `0.1em`) for the identical button recipe — self-contained, single-file fix.
- Confirmed clean: `ToastTab.tsx:139,245`, `MenuClient.tsx:112,146` (0.14em section headers, correct).

### Dimension 2 — 44px floor (2 sites)

`components/admin/catering/menu/MenuTabs.tsx:26` (`min-h-[38px]` tab chip), `MenuClient.tsx:279-280` (`min-h-[34px]` inline mini-edit input+button). Otherwise overwhelmingly compliant (`FulfillmentClient`, `PricingForm`, `FaqForm`, `ZoneForm`, `PackageForm`, `CapacityPolicyForm`, `PrepDemandClient`, `rate-rules-client` all consistently 44px).

### Dimension 3 — Card geometry

No violations found — panels consistently `rounded-lg` (admin sub-section convention) or correctly `rounded-2xl` for empty states.

### Dimension 4 — Border-token roles

Clean — `border-co-gold-deep` usage throughout is on genuine form controls.

### Dimension 5 — Button grammar coherence

No new grammar-mixing beyond D1's already-documented cross-family patterns.

### Dimension 6 — Leftover literals

- **RV-CTA-TEXT, 17 more sites of the D2-scale error-text pattern**: `FulfillmentClient.tsx:271`, `PricingForm.tsx:195`, `PricingClient.tsx:203`, `FaqForm.tsx:163`, `FaqClient.tsx:179`, `ZonesClient.tsx:185`, `ZoneForm.tsx:118`, `PackagesClient.tsx:327`, `PackageForm.tsx:229`, `CapacityPolicyForm.tsx:132`, `CapacityClient.tsx:275`, `ToastTab.tsx:120`, `MenuClient.tsx:106`, `PrepDemandClient.tsx:405`, `LtoClient.tsx:302,393`, `rate-rules-client.tsx:415`. Combined with D2's ~35, this single pattern now covers **over 50 sites across the admin family alone**.
- `ToastTab.tsx:31,225` — a three-way status-tone map where two tones are token-correct and the third (`border-co-cta text-co-cta`, the "remove"/"stale" tone) is the violation — should be `border-co-cta-text`/`text-co-cta-text` per the resolved ActionButton-danger law (see Method note / `components/ActionButton.tsx`'s own AA-note docstring, dated 2026-08-19, confirming `co-cta-text` is correct for danger-outline treatments — the README's ActionButton code table is stale on this exact point).
- **RV-GOLD-TINT, continuing**: `FaqClient.tsx:218`, `PrepDemandClient.tsx:524`, `PackagesClient.tsx:938`, `MenuTabs.tsx:27` (last one lower-confidence — may be a deliberate active-toggle fill rather than a status badge).

---

## Family E — catering staff (pipeline/quotes/customers/companies) + portal/storefront

Audited: `app/(authed)/catering/**` (companies, customers, insights, pipeline, quotes, `quotes/[id]`), `app/(authed)/lto/page.tsx`, `app/order/**` (all 10 files), `components/catering/**` (5 files), `components/portal/**` (5 files), `components/order/DeliveryRouteMap.tsx`.

### The catering/portal `text-co-cta` grammar — resolved, not a violation where it's ink-fill

Per the law's table, "Catering + portal" is a legitimate third button grammar: `rounded-xl`, ink fill, `text-co-cta`, `tracking-[0.12em]` (`CompaniesClient`, `QuotesClient`, `PrintButton`, `StorefrontOrderTray`). Direct read confirms this grammar is real, internally consistent, and contrast-compliant: every cited button (and ~30+ more like it across `app/order/*`) sits on a `bg-co-text` (near-black) fill, so `text-co-cta` there is red-on-dark — compliant, not the light-ground violation the law's `co-cta` rule warns about. **This grammar is sound as documented.** The *same files* separately contain a large population of `text-co-cta` on genuinely light grounds unrelated to this grammar (plain error text, tinted pills, price displays) — real violations, cataloged below, not to be confused with the compliant ink-fill pattern.

Two sites where the ink-fill/light-ground line is actually crossed: `app/order/page.tsx:117` (`"bg-co-bg text-co-cta hover:bg-white"`, one branch of a two-tone CTA) and `components/portal/StorefrontPackages.tsx:82` (`dark ? "bg-co-bg text-co-cta hover:bg-white" : "bg-co-text text-co-cta hover:bg-co-text/90"` — the branch named `dark` is the one using the light page-ground fill; the variable name reads inverted from its own logic, likely the root cause).

### Dimension 1 — Label roles

- **Systematic, 27 sites**: `text-xs/sm font-bold uppercase tracking-[0.14em] text-co-text-dim` used as the FIELD/SUB label spelling, when the law reserves 0.14em for section headers (canonical shape: `text-lg`) and specifies field/sub at `tracking-[0.12em]`: `components/catering/quotes/QuotesClient.tsx:438,527,586,758`, `components/catering/companies/CompaniesClient.tsx:97,101,171,198`, `app/(authed)/catering/insights/page.tsx:72,83,97,140`, `app/order/account/page.tsx:145,169`, `app/order/quote/[id]/page.tsx:95,118`, `app/order/build/page.tsx:773,982,1054,1101,1189,1195,1201`, `app/order/review/page.tsx:225,250,356,456`. The family's dominant, highest-count finding.
- `components/catering/quotes/QuotesClient.tsx:122` — `tracking-[0.18em]` (RV-18, a fourth family now, alongside A/B2/D3).
- `app/order/account/page.tsx:68` — `tracking-[0.16em]` ("Event" field label), matches no legal bucket.
- **The portal has its own, much larger, undocumented eyebrow/kicker tracking system**, independent of the four-role law: at least six distinct values across `app/order/*`/`components/portal/*` — `0.16em`, `0.18em`, `0.2em`, `0.22em` (nav wordmark, 7 sites), `0.24em`, `0.28em` (section eyebrows, 8+ sites), `0.32em` (hero eyebrow). Dense, consistent, clearly deliberate — reads as a genuine spec gap (the law's label-role table has no "portal marketing eyebrow" row) rather than random error. Flagging for a design-owner decision, not asserting 25+ individual violations.
- Confirmed clean: many `tracking-[0.14em] text-co-text-dim` section headers throughout the portal (`account:145,169`, `review:225,250,356,456`, `quote/[id]:95,118`, `build:663,773,982,1054,1101,1189,1195,1201`) — wait, cross-referenced against the field/sub finding above: the SAME lines are cited both as the systematic 0.14em-field-label violation and (mistakenly, in an earlier pass) as clean section headers. Resolution: these are field/sub labels by size and context (not `text-lg`), so they belong to the violation population above, not the clean list — noting explicitly to avoid double-counting in either direction.
- `components/catering/companies/CompaniesClient.tsx:97,101,171,198` — correct 0.14em... **also cross-referenced into the violation population above** (same resolution). No separate clean citation needed.
- Zero `text-co-gold-deep`-as-text hits in Family E. Clean on that specific check.

### Dimension 2 — 44px floor

Icon/stepper buttons are the weak spot; primary CTAs are strong and disciplined.

- `components/portal/StorefrontOrderTray.tsx:48,58` (Stepper ±, `h-9 w-9`/36px), `:140,150` (CompactRow ±, `h-8 w-8`/32px), `:158` (Add pill, padding-only, no explicit height), `:198,206,215` (SizedRow ±, `h-7 w-7`/28px).
- `components/catering/quotes/QuotesClient.tsx:460,472` (selects, `min-h-[40px]`), `:605` (status button, `min-h-[36px]`).
- `components/catering/companies/CompaniesClient.tsx:188,189,213,214` — domain/contact add-row, `min-h-[40px]`, 4 sites.
- `app/order/build/page.tsx:581` (`h-9`), `:664,971,1057,1059,1207,1209` (`h-8`, 6 sites), `:1031,1039` (`h-7`), `:815,837` (`h-6`, worst offenders), `:612` (`min-h-[36px]`).
- Lower confidence: `app/order/review/page.tsx:337` (h-7 w-12 toggle switch — may have a compliant 44px label hit area, unconfirmed) and `components/portal/FaqItem.tsx:18` (accordion trigger sized only by `px-5 py-4`, no explicit floor — likely clears 44px via content but not guaranteed).
- The primary/secondary CTA population (PrintButton, QuotesClient/CompaniesClient submit-cancel, SubCard, floating pill, every `/order` CTA) is already compliant at 44–56px + `items-center` — do not touch those in the batch fix.

### Dimension 3 — Card geometry

- **Confirmed correct and consistently applied**: `app/order/*` and `components/portal/*` use `rounded-3xl border border-co-border/70` for virtually every card — the documented portal exception, applied with real discipline across ~20+ sites.
- **Staff side, where the 3xl exception does NOT apply**: `components/order/DeliveryRouteMap.tsx:28` — `rounded-xl` (12px), violates either reading of the law (not 16px, not portal's 24px either, despite being rendered only inside `app/order/start`). `components/catering/companies/CompaniesClient.tsx:168` — `rounded-xl` card-shaped panel, should be `rounded-2xl`. `app/(authed)/catering/quotes/[id]/label/page.tsx:50` — `rounded-xl` print-label card, same finding, lower priority (print-context).

### Dimension 4 — Border-token roles

Clean in the portal (`border-co-border/70` is the law's own cited correct portal spelling). Staff side: no `border-co-gold-deep` misuse (not admin-form territory). `app/(authed)/catering/quotes/[id]/label/page.tsx:69` — **RV-CTA-BORDER**, `border-co-cta` as the edge of a light-tinted fill (`bg-co-cta/10`). `components/portal/StorefrontOrderTray.tsx:48` — Stepper minus button uses `border-co-border` (panel token) where it functions as a control (should be `border-co-border-2`), medium confidence.

### Dimension 5 — Button grammar coherence

- `components/portal/StorefrontPackages.tsx:82` and `app/order/page.tsx:117` — see the resolved-question section above; the "light" button variant crossing into an actual light-ground fill is as much a branch-logic bug as a token bug.
- **`CompaniesClient.tsx:189,214`** — clearest grammar-mixing violation in this family: `rounded-lg` (admin-form radius) + ink-fill colors, at 40px (matches no documented height), `tracking-wide` (matches no documented button-grammar tracking). Multi-axis mix.
- Secondary/cancel buttons in `QuotesClient.tsx:793,806` and `CompaniesClient.tsx:110` borrow ActionButton's secondary spelling but drop uppercase/tracking/bold, and are internally inconsistent with each other on text color (`text-co-text` vs `text-co-text-muted`) for the same role.
- No other unrelated grammar mixing — this family is otherwise a clean, single-grammar (catering/portal) implementation, a real contrast to the sprawl in Family A/C.

### Dimension 6 — Leftover literals

- **Price displays on light grounds — the highest brand/revenue-visibility finding in the ledger**: `app/order/build/page.tsx:580,608,849,969,1178` (5 sites, every package/item price shown mid-order) sit on `bg-co-surface`/`bg-co-bg` and use `text-co-cta`, not `text-co-cta-text`. `components/portal/StorefrontPackages.tsx:151,182,242` — three more, on the storefront landing page itself.
- Tinted-pill contrast bug: `app/order/account/page.tsx:49` (`bg-co-cta/10 text-co-cta`), `app/order/quote/[id]/pay-buttons.tsx:79` (`border-co-cta/40 bg-co-cta/5 text-co-cta`), `components/catering/quotes/QuotesClient.tsx:162,374,801`, `app/(authed)/catering/quotes/[id]/label/page.tsx:69` (shared with dimension 4).
- Plain error/status text on light grounds, ~15 sites: `QuotesClient.tsx:510,725,784`, `CompaniesClient.tsx:105,165,180(hover),222`, `CustomersClient.tsx:158,203,292`, `PipelineClient.tsx:109,433,538`, `app/(authed)/lto/page.tsx:156`, `app/(authed)/catering/quotes/[id]/label/page.tsx:59`.
- **RV-GOLD-TINT**: `components/catering/pipeline/PipelineClient.tsx:31,34` (`bg-co-gold/25 text-co-text` for "limited"/"below_lead_time" states) — versus the same object's `unavailable`/`blackout` states at `:32-33` which correctly use `bg-co-danger-surface text-co-cta-text`. A clean within-file before/after: two of four map entries right, two wrong, four lines apart.
- Confirmed compliant, worth citing: `StorefrontOrderTray.tsx:390` (`bg-co-cta` fill + `text-co-text` ink label, correct destructive-fill pairing).

---

## Family C — receiving / ordering / counts

Audited: `components/receiving/{CreditResolveControls,OpenCreditsPanel,VendorClaimPanel,IntakeLineRow,ReceivingForm}.tsx`, `components/ordering/{delivery-affordances,OrderingSurfaces,PoPanel}.tsx`, `components/counts/{CountForm,OnHandPanel}.tsx`, `app/(authed)/operations/counts/page.tsx`, `app/(authed)/operations/receiving/[id]/page.tsx`, `app/ordering/{page,loading}.tsx`. Excluded and untouched: `ReceivingTile.tsx`, `OrderingTile.tsx`, `ParPassWalker.tsx`, `CountsTile.tsx`, the receiving LIST page. Every citation below was independently spot-checked against source after this family's first audit attempt (which had gone out of scope and attempted the whole app) was discarded for containing fabricated citations.

### The 4th-grammar cross-cutting finding — corrected framing

An earlier pass reported `border-co-gold-deep bg-co-gold` (admin-form's spelling, paired with ActionButton's `tracking-[0.1em]`) as "an undocumented 4th grammar in 50+ files, more common than ActionButton itself." Verified directly: it's **58 files**, but the overwhelming majority are legitimate `components/admin/**`/`app/admin/**` files where that spelling **is** the correct, documented admin-form grammar — not a violation. The real finding is the ~13 files where this admin-form spelling leaks onto surfaces that are **not** admin forms and should be using `ActionButton` instead. Family C supplies the largest cluster of that leak: `ReceivingForm.tsx:721,1095`, `PoPanel.tsx:679,817,1249`, `OrderingSurfaces.tsx:195`, `CountForm.tsx:143`, `CreditResolveControls.tsx:160`, `VendorClaimPanel.tsx:392,626,659,680,729` — 13 sites across 5 files, none of them admin forms. (Family A contributes `ProductionForm.tsx:73`; Family B1 contributes `WrittenReportForm.tsx`/`WrittenReportsClient.tsx`; Family B2 contributes `UserMenu.tsx:236-237`.)

### Dimension 1 — Label roles (21 sites)

- `components/receiving/VendorClaimPanel.tsx:568,591` — group headers at `tracking-[0.1em]` instead of legal `tracking-wide`.
- `VendorClaimPanel.tsx:719` — field label at `0.1em`+`text-co-text-muted` instead of `0.12em`+`text-co-text-dim`.
- `components/ordering/PoPanel.tsx:618,650,697,711,854,887,912,940,963` — **9 sites**, internal inconsistency: this file's own section-introducing `h3` headers ("Frozen lines", "Auto-place", "Transmit", "Timeline", "Transmissions", "SMS", "Delivery") use `tracking-[0.12em]`, where the identical convention is confirmed `tracking-[0.14em]` everywhere else checked in this audit (`receiving/[id]/page.tsx:168`, `counts/page.tsx:38`, `ReceivingForm.tsx:555`, `CountForm.tsx:79`, Family A's `ProductionForm.tsx:48`/`cash-client.tsx`/`pm-report-client.tsx`/`MidDayPhase1/2Form.tsx`). `PoPanel.tsx` is the outlier, not the rest of the app.
- `PoPanel.tsx:621,748,783,1114,1123,1132,1196,1212,1224` — **9 more sites**, `dt`/table-header/field-microcopy at `tracking-[0.1em]` instead of `[0.12em]`.

### Dimension 2 — 44px floor (2 sites — the cleanest dimension in this family)

`app/ordering/page.tsx:153` (location-tab link, `min-h-[36px]`), `components/receiving/OpenCreditsPanel.tsx:153` (filter toggle, `min-h-[36px]`). Everything else in this family consistently pairs `min-h-[44px]`+`items-center`, including a model icon-button pattern at `IntakeLineRow.tsx:65,171,183,250,270` (`h-12 w-12 min-h-[44px]`, both axes sized together — exactly the law's icon-button rule).

### Dimension 3 — Card geometry (4 sites)

`components/counts/CountForm.tsx:78` and `components/receiving/ReceivingForm.tsx:733,860,891` — the "component-level card minus shadow" recipe (`rounded-xl border-2 border-co-border bg-co-surface p-4`) at 12px instead of 16px — the same class already confirmed real in Family A (`ProductionForm.tsx:47`, `pm-report-client.tsx:130`). The large `rounded-lg` row/panel population elsewhere in this family is list-row shaped (no shadow) and correctly not flagged.

### Dimension 4 — Border-token roles (1 site)

`components/receiving/VendorClaimPanel.tsx:701` — `border-co-danger`/`text-co-danger` outline on a light (`bg-co-surface`) fill. `co-danger` shares `co-cta`'s exact hex and text-role rule per `globals.css`'s own comment — should be `-cta-text` spelling, same fix class as RV-CTA-BORDER.

### Dimension 5 — Button grammar coherence (13 sites)

Covered by the corrected cross-cutting finding above — 13 local sites across `ReceivingForm.tsx`, `PoPanel.tsx`, `OrderingSurfaces.tsx`, `CountForm.tsx`, `CreditResolveControls.tsx`, `VendorClaimPanel.tsx`.

### Dimension 6 — Leftover literals (17 sites)

- **RV-CTA-TEXT, 13 confirmed light-ground sites**: `VendorClaimPanel.tsx:122,356,400,708,732,757`, `IntakeLineRow.tsx:399`, `CreditResolveControls.tsx:174`, `ReceivingForm.tsx:1077`, `OnHandPanel.tsx:119,161`, `CountForm.tsx:122,133`, `receiving/[id]/page.tsx:99,148`.
- **RV-GOLD-TINT, 3 sites, all in one file — corrected attribution**: `components/receiving/ReceivingForm.tsx:688,749,968` (an earlier pass had mis-attributed these to `VendorClaimPanel.tsx`, which was verified directly to have zero `bg-co-gold/NN` occurrences anywhere in the file). Plus `app/ordering/page.tsx:155` — `bg-co-gold/25` active-tab tint.
- `components/counts/CountsTile.tsx:75` — confirmed **compliant**, worth citing: correctly uses `text-co-cta-text` for its negative/danger state, sitting right next to this family's violations as a working example of the right pattern (file is otherwise excluded, #256).

---

## Summary table — violation sites by family × dimension

Counts are site-level tallies from the citations above (approximate where a fork described a pattern rather than enumerating every line — exact citations are in each family's section). Dimension 5 counts distinct grammar-mixing *sites*, not the number of grammars involved.

| Family | D1 Labels | D2 44px floor | D3 Card radius | D4 Border tokens | D5 Button grammar | D6 Leftover literals | **Family total** |
|---|---:|---:|---:|---:|---:|---:|---:|
| A — hot path | 21 | 13 | 2 | 3 | 8 | 24 | **71** |
| B1 — reports/trends/search | 11 | 8 | 1 | 0 | 4 | 24 | **48** |
| B2 — chrome/login/profile | 11 | 3 | 2 | 8 | 4 | 9 | **37** |
| C — receiving/ordering/counts | 21 | 2 | 4 | 1 | 13 | 17 | **58** |
| D1 — admin users/templates/builder | 24 | 40 | 2 | 2 | 3 | 40 | **111** |
| D2 — admin vendors/SKUs/items/recipes | 18 | 5 | 0 (clean) | 0 (clean) | 6 | 41 | **70** |
| D3 — admin catering | 25 | 2 | 0 (clean) | 0 (clean) | 0 (clean) | 23 | **50** |
| E — catering staff + portal | 29† | 27 | 3 | 2 | 3 | 30 | **94** |
| **Dimension total** | **160** | **100** | **14** | **16** | **41** | **208** | **≈539** |

† Excludes the portal's own undocumented marketing-eyebrow tracking system (~25+ additional sites across `app/order/*`/`components/portal/*` using 6 non-legal tracking values) — flagged for a design-owner ruling rather than asserted as violations; see Family E and Batch 0 below.

Dimension 6 (leftover literals, 208 sites) and Dimension 1 (label tracking, 160 sites) dominate by count and are the two most mechanically fixable — a handful of literal string patterns (`text-sm text-co-cta` on error paragraphs; `tracking-[0.14em]` on a field label; `tracking-[0.1em]` on a group header) account for the large majority of sites in each. Dimension 3 (card radius, 14 sites) is the smallest and cleanest — most of the app already gets this right. `TemplateBuilderClient.tsx` (Family D1) is the single worst file in the sweep, carrying the bulk of D1's 40-site dimension-2 count on its own.

## Recommended batch order (severity-weighted)

**Batch 0 — design-decision gate, before any mechanical fixes.** Three patterns are large, internally consistent, and *undocumented* rather than scattered mistakes — fixing them mechanically without a ruling first would either break a working convention or codify a bad one:
1. **Admin-form grammar leaking onto ~13 non-admin operational files** (`ProductionForm.tsx` [A], `WrittenReportForm.tsx`/`WrittenReportsClient.tsx` [B1], `UserMenu.tsx` [B2], `ReceivingForm.tsx`/`PoPanel.tsx`/`OrderingSurfaces.tsx`/`CountForm.tsx`/`CreditResolveControls.tsx`/`VendorClaimPanel.tsx` [C]). Decide: migrate these onto `ActionButton primary` (which is what the component's own docstring says it exists to replace), or formally document a fourth "operational confirm" grammar.
2. **The portal's marketing-eyebrow tracking system** (6 non-legal values, ~25+ sites across `app/order/*`, Family E) — decide whether this is a deliberate fifth typographic role needing documentation, or drift that should collapse onto the four existing roles.
3. **The auth flow's "ink-fill primary submit" grammar** (`bg-co-text` + `text-co-cta`, `rounded-xl`, 52px — `SetPasswordForm`/`ManagerLoginForm`/`PasswordModal`/`IdleTimeoutWarning`, Family B2) — contrast-compliant as-is, just needs adding to the law's grammar table alongside catering/portal.
4. **Resolved during this audit, propagate the answer**: `ActionButton`'s `danger` variant reads `border-co-cta-text`/`text-co-cta-text` in the live component (confirmed via its own "AA NOTE (token floor, 2026-08-19)" docstring) — the README's code table (`co-cta`, no `-text`) is stale documentation. Every `border-co-cta text-co-cta` outline-on-light-fill site found in this sweep (e.g. D3's `ToastTab.tsx:31,225`) should resolve to the `-text` spelling; no further ambiguity here.

**Batch 1 — repo-wide dimension-6 contrast sweep.** The single highest-count, lowest-risk, most mechanical fix in the ledger: `text-co-cta`/`text-co-danger` as text on light grounds (dominated by D1/D2/D3's `<p>{errorMsg}</p>` pattern, ~130+ of the 208 dimension-6 sites) plus the recurring tinted-pill (`border/bg-co-cta/NN + text-co-cta`) and **RV-GOLD-TINT** ad-hoc-tint patterns — now confirmed in independent file clusters across every one of the 8 families. That repetition is strong evidence the token system is genuinely missing a warning/gold-tint surface token, not that 8 unrelated authors made the same mistake. Do this as one or two scripted find-and-replace PRs scoped by pattern, not by family.

**Batch 2 — Family A (hot path).** Highest-traffic surface in the app — every employee, every shift. `ChecklistItem.tsx` alone carries the field-label `0.14em→0.12em` fix, the `border-co-cta`→`border-co-cta-text` error-state fix, and at least 3 of the family's 8 button-grammar near-misses. Also close the concrete `h-9`/`h-10` touch-target violations in cash/opening/mid-day entry controls — real usability bugs, not just token drift.

**Batch 3 — Family E customer-facing price displays.** Small in count (8 of E's 94 sites) but the highest brand/revenue visibility in the whole ledger — every package/item price shown to a paying customer mid-order uses the wrong red. Worth pulling out of Batch 1 and shipping/verifying on its own.

**Batch 4 — D2 admin (vendors/SKUs/items/recipes).** The single largest concentration of Batch 1's pattern (41 sites) plus the red-filled-destructive-button anti-pattern (6 sites, `ItemQuestions`/`RecipeInputRow`/`RecipeOutputRow`/`RecipeBuilder`) — high mechanical-fix ROI once Batch 1's scripted approach exists.

**Batch 5 — D1/D3 admin label-tracking + D1's 44px floor.** Gated on Batch 0 item 1's ruling for the admin-specific `0.1em`/`0.08em` conventions (~49 combined dimension-1 sites), plus `TemplateBuilderClient.tsx`'s standalone ~40-site dimension-2 problem, which needs no gate — it's a plain floor violation regardless of the grammar question.

**Batch 6 — B1/B2/C targeted fixes.** Smaller footprints but individually high-symbolic-value: `ReportFilterBar.tsx` (the design doc's own cited "correct" anchor, now confirmed drifted — one file, five sites, every reports-hub session), the login flow's 8-site `0.18em` field-label bug (the primary auth surface's own labels), `UserMenu`/`NotificationBell` icon-size harmonization (`h-10` vs `h-11` in the same nav row), `PoPanel.tsx`'s internally-inconsistent 18-site tracking drift.

**Batch 7 — Card-radius cleanup (dimension 3).** Lowest count (14 sites) and lowest urgency — most of the app already gets this right. Mop up `PersonDetail`, `ProductionForm`/`pm-report-client`, `UserActions`/`CreateUserForm`, `CompaniesClient`, `CountForm`/`ReceivingForm`, `DeliveryRouteMap` as a low-priority follow-on.

---

## LEAD RULINGS — Batch 0 (CC, 2026-08-20)

**R0 — Ledger trust level: LEADS, NOT FACTS.** The B2 claim "DashboardNav text-co-gold-deep confirmed still present" is FALSE (repo-wide grep: zero occurrences; fixed in PR #255). Every batch executor re-verifies each cited site against live code before editing; a site that doesn't match is skipped and reported, never forced.

**R1 — RV-4G (admin grammar on operational surfaces): CONVERT.** The ~13 non-admin files carrying admin-form button spelling adopt ActionButton/actionButtonClass (law: "a surface adopts one grammar whole"). Admin files (~45) keep admin-form grammar — legitimate.

**R2 — Auth primary grammar: RATIFY + DOCUMENT, no code change.** The consistent ink-fill treatment (rounded-xl, min-h-52, bg-co-text, text-co-cta, 0.12em) across SetPasswordForm/ManagerLoginForm/PasswordModal/IdleTimeoutWarning is contrast-compliant (dark ground) and coherent — it becomes the documented FOURTH grammar ("auth primary") in the AGENTS.md table. LogoutButton converts to ActionButton secondary (it already matches in all but one value).

**R3 — Portal eyebrow tracking system: RATIFY AS PORTAL GRAMMAR, no normalization.** The handoff itself kept the portal's looser eyebrows as deliberate exceptions; `app/order/*` + storefront components keep their tracking values, documented as part of the portal grammar's line in AGENTS.md. Not violations.

**R4 — RV-GOLD-TINT: fix by ROLE, mint NO new token.**
- Status/attention roles (temp badges, warnings) → `bg-co-warning-surface` (+ `text-co-warning-text` where text rides the tint).
- Hover/pressed/segmented-control states → `co-surface-2` per its documented role.
- BRAND-BADGE roles (profile role chips, brand accents) → `bg-co-gold/20` is hereby the DOCUMENTED legal spelling for a brand-gold badge tint (derives from the token anchor; no third pale-gold hex, no duplicate-role alias). Document in AGENTS.md token-roles line.

**R5 — Batch structure (collision-safe):**
- **Batch 1 (Sonnet, mechanical):** dimension-6 repo-wide EXCLUDING Family A files + RV-CTA-BORDER pairs + Family E's 8 customer-facing price-display sites (pulled forward: revenue-facing) + the AGENTS.md documentation from R2/R3/R4 + LogoutButton per R2.
- **Batch 2 (Opus, judgment):** Family A complete — all six dimensions incl. its 24 dim-6 sites, the RV-16 tile eyebrows (OpeningTile/CashDepositTile/MidDayPrepTile/PmReportTile — #256 only normalized the three rebuilt tiles), the cash/pm h-10 controls, the systemic "absent height" manual pass on cash-client mode toggles, and R1 conversions within A.
- Then: Batch 3 = D1 (worst file TemplateBuilderClient + labels/floor) · Batch 4 = D2+D3 · Batch 5 = B1+B2+C residuals · Batch 6 = E residuals + card radii. Sequenced after 1+2 merge; sizing may consolidate based on how 1+2 go.
