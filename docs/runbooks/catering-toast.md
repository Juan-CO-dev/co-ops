# Portal catering ↔ Toast cross-check (item 21)

Plan: CHIEF `03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-21-PORTAL-CATERING-TOAST-PLAN-r3.md` (Juan's 8 answers at its top override its defaults). Built so far: PRs 0, 1 and 2. Migration **0344** is authored, NOT applied (0343 may be claimed by the board PR in flight, so this work took 0344).

## What ships, and what it changes

| PR | What | Live behaviour |
|---|---|---|
| 0 | `tests/catering-pipeline-value-census.test.ts`, `tests/catering-toast-classifier-untouched.test.ts` | None |
| 1 | 0344 + `scripts/sql-harness-0344.mjs` + the ring-code capture fixture | None (file only) |
| 2 | House leads on the not-rung list with suggestions; the pipeline label on Sales → Catering | Only for a shop whose `catering_toast_settings.enabled` is true. No row = off. |

Nothing in PRs 0–2 writes a link, changes a sales number or changes pipeline value. A linked Toast check stays a `sale`.

## Applying 0344 (CC)

1. Sim first: apply `supabase/migrations/0344_catering_toast_house_side.sql`. It refuses by name (`ring_code_format_collides_with_ezcater`) if any stored ezCater order number has the house shape `CO` + 5.
2. Run the verify block at the end of the file (12 policies; zero links, settings, ring codes).
3. Read-only dry run on sim, then prod: `select count(*), evidence from plan_catering_toast('<shop>', current_date - 30, current_date, '[]') group by 2;` — it must answer within the page's budget.
4. Prod on Juan's word, then stamp the header (`-- APPLIED TO PROD <date> (schema_migrations version <v>, name '0344_catering_toast_house_side')`).

Before 0344 is applied the readers treat the missing tables as "not installed": the ezCater not-rung list is unchanged and no house row appears.

## Turning a shop on (Juan's word, per shop)

Settings have no app writer yet (PR 3 adds the card and its audited writer). CC runs, as the database owner:

```sql
insert into public.catering_toast_settings(location_id, enabled) values ('<shop id>', true)
on conflict (location_id) do update set enabled = true, updated_at = clock_timestamp();
```

What a manager then sees: house leads (booked, dated, not ezCater) with no Toast check linked appear on the pipeline's "Not rung in Toast yet" list, labelled "House order", with the best suggested check (ring code, Toast order, or amount and date) — and in the pulse and both digests. Sales → Catering shows "Of this, $X is also rung in Toast" under the pipeline block.

`enabled` turns on the LIST. With no links yet (PR 3 adds the first human links) every house lead is "not rung" — expect the list to be long until links exist. Turning a shop on before PR 3 ships is a preview, not an operation.

### Switches that must wait

- `ring_code_enabled` (codes are generated): NOT before the fixture gate below passes on a real ring.
- `auto_link_enabled`, `origin_auto_link_enabled`: PR 4. The database refuses either without `auto_link_from_date` (Juan answer 7: history before that date is suggestions only).
- `include_toast_origin_leads`: refused unless `origin_auto_link_enabled` is on. Toast-origin leads were created FROM a Toast order, so they are rung by construction; listing them as "not rung" before they can link by origin would be false.

## Fixture gate before `ring_code_enabled`

Staff type the ring code where they type the ezCater number today (Juan answer 1): as the **name of an open item**, or as a **special request** on an item. `tests/catering-ring-code-capture-fixture.test.ts` proves both paths end to end through the real planner. The check's **tab name** is read by nothing today (pinned in that test).

1. Have a manager ring one real portal order with its code, the way staff will be trained.
2. Export that order's raw JSON (ordersBulk), redact names / phones / payment fields, keep guids and the code, and replace `tests/fixtures/toast/catering-ring-code-sample.json` with it.
3. The test must still pass. If staff used the tab name, it will not: stop and extend the note lookup (below) first.

## Contracts for PR 3 and PR 4 (Astra r3, recorded here because they do not touch PRs 0–2)

These are binding on the next PRs; each lists the proof it owes.

1. **The publisher honours the dual-code exclusion (Astra r3 #1).** `publish_ezcater_shadow` inserts links straight from its payload and never calls a planner, so the dual-code rule must hold at the publisher's insertion boundary too: PR 3's never-raising `BEFORE INSERT` trigger on `ezcater_toast_links` returns NULL (skips the row, records a `dual_code` conflict) when the check is UNOWNED and also carries a live house ring code — not only when a house owner exists. Maps, reviews and shadow still commit. Proof: the real 0229 publisher run in PGlite before either planner, on an unowned dual-code check.
2. **Dual-code filtering never retires an existing ezCater owner (Astra r3 #2).** The exclusion is for UNOWNED ADMISSION only. In the re-emitted ezCater planner, a check with a raw `is_current` ezCater row keeps its incumbent evidence in `candidates` / `batch_checks` even after a ring code appears on it; otherwise the unchanged reconciler retires the links it no longer sees. Proof: an ezCater-owned check gains a house ring code → reconcile → the ezCater links are unchanged and an `ownership_conflict` shows on both lists. Both arrival orders on an unowned check are tested as well.
3. **The ring-code evidence contract (Astra r3 #3).** Evidence = the two ezCater paths, nothing else: item-bearing selection names from capture, and the ephemeral, version-fenced `loadKnownToastOrderCodes` intersection for `SPECIAL_REQUEST` notes, passed to `plan_catering_toast` as `p_note_codes` (codes only; the function refuses anything not code-shaped). PR 3's dual-code view and the ezCater publisher must see the SAME evidence: the reconcile pass calls the note lookup ONCE with ezCater numbers ∪ ring codes and hands the intersections to both. If staff are to use the tab name, the lookup reads `check.tabName` under the same intersect rule — one change, both sources — before `ring_code_enabled` flips.
4. **Toast-origin automatic linking (Astra r3 #4, Juan answer 5).** PR 4's reconciler auto-links two kinds of evidence: `ring_code` and `toast_origin`. Origin = `toast_catering_orders.lead_id`; it expands to every live, non-voided check of that order's latest snapshot at the lead's shop (the planner's `toast_origin` rows). Same rules as a code: never over an owner, never over a tombstone (`unlink` / `not_a_match` head), never for a `no_ring_expected` lead, never for an event before `auto_link_from_date` (backfill = suggestions only, answer 7), each behind its own switch (`origin_auto_link_enabled`, `auto_link_enabled`). Turning `origin_auto_link_enabled` on is what permits `include_toast_origin_leads`.

Juan's answers that shape the rest: the Toast check is the money of record (2); one check per order with deposits lumped in, so the comparison is the check TOTAL against the accepted quote total (3); Stripe-paid portal orders are rung too (4) — no special case; ezCater stays in pipeline value, labelled (6); link / unlink = catering manager + GM and up (8; PR 3's role constant).
