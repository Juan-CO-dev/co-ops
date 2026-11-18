# Demand signals (item 4): PR 2 build notes — source register, gate, signal tables, NWS adapter

Plan: CHIEF `03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-04-DEMAND-SIGNALS-PLAN-r2.md`, sections 6 and 7. Contract: `lib/demand-signals/contracts-shared.ts` (Astra r2 P2 #3). Built on `9b650638` (origin/main), 2026-11-18. Migration `0343_demand_signal_sources.sql`, file only.

## Juan's answers (2026-11-18) and where each one landed

| Answer | Where |
|---|---|
| Free sources only; register as many as can be found | `docs/demand-signal-sources.md` (55 sources) and `docs/seed/demand-sources-dc-2026-11-18.json`. 0343 refuses a source whose `cost` is not `free`. |
| List paid services for Pete | Same doc, last section, and the PR body. Nothing is bought or built. |
| Events: manual entry by GM+ AND automatic discovery | One table, `demand_day_events`, holds both (`origin` `manual` or `feed`). The manual writer is `demand_event_save` (0343). The page is PR 5. Discovery adapters come source by source after each is verified; this PR stores NWS alerts that way. |
| Go-live approval: MoO+ (not only Juan) | `canApproveSignalGoLive` (`lib/demand-signals/access-shared.ts`): moo, owner, cgs. The approval itself ships with the state machine (PR 4) and the chips (PR 6). Marking a source verified uses the same three roles now. |
| Signals adjust THAT DAY's order only | Unchanged from the plan (section 5): a signal prefills one order line for one walk through its own writer. It never touches a par column, `parWriteColumns` or `par_suggestion_actions`. Nothing in this PR writes an order or a par at all. |

## A separate mechanism for standing pars (its own later PR)

Recorded here because Juan asked for it to be written down: **demand signals never change a standing par.** A signal says "this Thursday is different"; it is consumed by that day's order and then it is over.

Changing what a shop's par IS, because demand moved for good, is a different decision with a different owner, evidence bar and undo. It will be **its own later PR**, not part of items 4 PR 1 to 8. It is expected to build on Dynamic Pars (the machine lane, the band, the budget, the pin) and not on the signal tables. Until that PR exists, the only things that move a standing par are the ones that move it today: a manager's edit, and the Dynamic Pars engine under its own gate.

## What this PR decided (CC to confirm)

1. **Sources are data, not a migration.** The tenant law says one migrations lineage and tenant difference in data. 0343 ships an empty register and asserts it; `scripts/seed-demand-sources.ts` registers the rows through `demand_source_register` (dry run by default; CC runs `--apply` on sim, then prod). The NWS definition lives beside its adapter because the adapter sends that definition's hash with every write.
2. **A definition is content-addressed.** Status belongs to a source's CURRENT definition. Editing an endpoint, the adapter version, the gate or the terms fields makes a new definition, which is unverified. This is how "an endpoint or adapter change needs re-verification" (plan 6) is enforced rather than remembered.
3. **A fifth gate value, `pending_terms`.** The research found real feeds whose terms nobody could read (OPM status, the DCPS calendar, Audi Field's calendar and others). They are neither "allow" nor "by hand only". They cannot be marked verified; a person reads the terms and registers a new definition.
4. **The gate is in SQL too.** The TypeScript check (`signalUsable` through `collectDecision` / `keepUsable`) is the early answer. 0343's writers and readers ask the register again inside their own statement, under a per-source advisory key that the mark takes exclusively. A revocation between a fetch and its write is therefore refused by the writer.
5. **The mark route ships without a page.** `POST /api/admin/demand-signals/sources/mark` (same-origin, MoO+, Tier B). Without it nobody could ever verify a source and the gate would have no human door. PR 5 puts a screen on it; until then CC drives it from an authenticated session.
6. **Shop coordinates come from `catering_fulfillment_nodes`.** `locations` has no latitude or longitude; that table is the one place a shop's point is stored. A shop without a node is simply not collected.
7. **The cron is inert before its lease**, like the schedule draft: secret, `DEMAND_SIGNALS=1`, then the register must say NWS is verified now, and only then the lease, a request and a heartbeat. A refusal writes nothing at all.
8. **Weather rows are service hours only** (06:00 to 21:00 ET, sixteen a day, seven days): 112 a shop, 224 a run, which is the plan's cap. The cap is held in the collector and again in 0343.
9. **The PR 1 census check was widened by name, not loosened.** A `revocation` module must call `signalUsable` or one of the four helpers built on it (`usableNow`, `collectDecision`, `keepUsable`, `collectionPrecheck`); a new test proves each helper ends in `signalUsable` with a freshly read register.

## Left for later PRs (stated, not hidden)

- **Retention (25 months)** and its sweep. Nothing is deleted by this PR; a revocation deletes nothing by design.
- **The ops-health line with table sizes** (plan 7). It belongs on the page (PR 5). Until then the run ledger (`demand_signal_runs`) and the heartbeat show freshness.
- **Vintage volume on sim.** The plan's estimate (about 82k weather rows a year) is to be measured on sim before `DEMAND_SIGNALS` is set in prod. The runbook has the query.
- **Observed weather (NCEI)**: PR 3, and only after a person reads its policy.
- **The accept re-check.** `demand_sources_assert_usable(ids)` is the function an accept writer calls inside its write (PR 6). The interleaving "shown, then revoked, then accepted" is proved against that function in the 0343 harness; the accept writer's own test ships with it.
- **i18n.** No screen is added, so no string is. Every refusal is a named code; PR 5 ships en + es for each.
- **0340 to 0342 file headers** carry no "APPLIED TO PROD" stamp. This PR did not add them because it could not read `schema_migrations` (no database calls); CC stamps them.

## PR 4 / 5 / 6 must (from this PR)

1. Read stored signals only through `loadUsableWeather` / `loadUsableDayEvents`, passing the use point. Never `from("demand_weather_hourly")` (a census test fails).
2. Put `sourceIds` on every persisted term (the readers already return them per row).
3. The accept writer calls `demand_sources_assert_usable(source_ids)` inside its own transaction and maps `source_revoked` / `source_unverified` to a named 409.
4. A new adapter adds its definition next to its code, joins `seedDefinitions()`, and is added to the census as `revocation`.
