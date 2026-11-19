# Demand-signal sources: the register, the gate and the NWS collection (item 4 PR 2)

What this is: a list of outside sources (weather, closures, events), a rule that nothing is taken from a source until a person has marked it verified, the tables the signals are stored in, and one adapter (the National Weather Service). It changes no par, no prep number, no order and no schedule.

Law: `AGENTS.md`, section "Demand signals, PR 2". Migration: `supabase/migrations/0343_demand_signal_sources.sql` (applied to prod 2026-11-18, schema_migrations version 20261118181429). The sources and their terms: `docs/demand-signal-sources.md`.

## State as shipped

- 0343 is applied to prod (2026-11-18, 20261118181429).
- The register is empty, so every source is `unverified`.
- `DEMAND_SIGNALS` and `NWS_USER_AGENT` are unset. The cron answers `demand_signals_off` and reads nothing.
- Nothing sends an email, an SMS or a notification.

## The four keys (all four, in this order)

Nothing is requested from api.weather.gov until every one of these is true.

1. **0343 applied** (sim, then prod on Juan's word).
2. **The sources registered** (`scripts/seed-demand-sources.ts --apply`). They are still `unverified`.
3. **NWS marked verified by a MoO, the Owner or the CGS**, with a note, after re-reading its terms page.
4. **`DEMAND_SIGNALS=1` and `NWS_USER_AGENT` set** in Vercel (server env), then a redeploy.

## Applying 0343 (CC)

Pre-flight (the same three statements are in the file's header):

```sql
select to_regprocedure('public.demand_today_et()');   -- present (0342)
select to_regclass('public.demand_sources');          -- null
select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where proname = 'claim_cron_route';
-- 170e841ae33f33e666ca30b71bd61bea (0337's body). Any other value: a later migration re-defined the lease; stop and re-emit from it.
```

1. Apply to **sim**. Run `npx vitest run tests/demand-signals-0343-harness.test.ts --maxWorkers=1` locally (the offline proof of the same file).
2. On sim: `select * from demand_source_states();` returns no row, and `select claim_cron_route('demand-signals');` returns true.
3. Apply to **prod** on Juan's word. Stamp the file header (`-- APPLIED TO PROD <date> ...`), keeping the authoring line.

The file refuses by name if 0342 is missing, if it was already applied, or if the cron lease is not 0337's.

## Registering the sources (CC)

```bash
npx tsx --env-file=.env.local scripts/seed-demand-sources.ts            # dry run
npx tsx --env-file=.env.local scripts/seed-demand-sources.ts --apply    # sim first, then prod
```

It prints one line per source (`register`, `unchanged`, or `REDEFINE`). It cannot mark anything verified. After it: `select source_id, gate, status from demand_source_states() order by 1;` shows 55 rows, every status `unverified`.

Re-running is safe. A source whose definition changed in the file becomes a new definition and is unverified again.

## Marking a source verified (a MoO, the Owner or the CGS)

There is no screen yet (PR 5). The door is `POST /api/admin/demand-signals/sources/mark` from a signed-in session, right after a password step-up:

```json
{ "sourceId": "nws", "definitionHash": "<from demand_source_states()>", "status": "verified", "note": "Read weather.gov/documentation/services-web-api on <date>" }
```

Before marking, open the source's terms page (the link is in `docs/demand-signal-sources.md`) and read it. The quote in the register was read through a page-fetch tool; the mark is a person saying they read it themselves.

What it refuses, by name:

| Code | Meaning |
|---|---|
| `forbidden` / `demand_source_forbidden` | Not an active MoO, Owner or CGS |
| `step_up_required` | No fresh password |
| `source_definition_moved` | The definition changed since you read it. Read the new one |
| `source_not_ingestible` | The source's gate is "terms unread", "by hand only" or "refuse". It cannot be verified as it stands |
| `source_terms_evidence_missing` | The definition says its terms were read but does not carry the terms page and a quote from it. Fix the definition, register it again, then mark |
| `source_status_unchanged` | It already has that status |
| `demand_signals_unavailable` | 0343 is not applied |

Every mark writes one `demand_source_events` row and one audit row (`demand_source.mark`: who, when, which definition; never the note).

**To stop a source at once:** the same call with `"status": "revoked"`. From that instant nothing is collected from it and nothing already stored from it is returned to any reader. Nothing is deleted.

## Turning the collection on (CC)

1. Set `NWS_USER_AGENT` in Vercel to a string that identifies the application and a contact, as NWS asks (Juan's choice of wording; the adapter makes no request without it).
2. Set `DEMAND_SIGNALS=1`. Redeploy.
3. The cron runs at 03:50, 09:50, 15:50 and 21:50 UTC. Or call it once by hand with the cron secret.

## What a healthy run looks like

- One audit row `cron.success`, `metadata.job = 'demand-signals'`, `status: "ran"`, `failed: 0`, and per shop `weather {seen, written}` and `alerts {seen, written}`.
- First run: up to 112 weather rows a shop. Later runs write only the hours whose forecast changed; an unchanged fetch writes a run row and no weather row.
- Freshness: `select source_id, feed, outcome, error_code, rows_seen, rows_written, rows_withdrawn, finished_at from demand_signal_runs order by finished_at desc limit 10;`
- Cancelled alerts: each alerts run is the complete list in force for the shop. An alert that is no longer listed before its end gets a withdrawal row (`withdrawn = true`, counted in `rows_withdrawn`) and is not shown or used from then on; nothing is deleted. `select external_key, title, withdrawn, available_at from demand_day_events where origin = 'feed' order by seq desc limit 20;`
- A read of stored signals that cannot be completed answers `signal_reads_incomplete` (503). Ask again; it never returns part of a list.
- Volume (measure on sim for a week before prod): `select count(*), pg_size_pretty(pg_total_relation_size('demand_weather_hourly')) from demand_weather_hourly;`

## When it does not run

The cron answers `{ skipped: true, reason }` and writes nothing (no lease, no heartbeat):

| Reason | Meaning |
|---|---|
| `demand_signals_off` | `DEMAND_SIGNALS` is not `1` |
| `not_installed` | 0343 is not applied |
| `source_unverified` | NWS is not marked verified, or the register's definition is not the one this build's adapter was written for (the adapter or the definition changed: register again, then mark again), or the register could not be read |
| `source_revoked` | NWS was revoked |
| `cron_route_busy` | Another run holds the lease |

A run that started and then stopped has `status` `source_revoked` / `source_unverified` (revoked in the middle) or `user_agent_missing`.

`cron.failure` (`error: signal_feeds_failed`) names each shop's feed by a fixed code:

| Code | Meaning | What to do |
|---|---|---|
| `server_error`, `rate_limited`, `network_error`, `http_error`, `not_found` | api.weather.gov did not answer usefully after at most 2 retries | Nothing: the next run tries again. Persistent `http_error` or `not_found`: the endpoint changed |
| `bad_payload` | The answer was not the documented shape. Nothing was stored from it | Compare a live answer with the fixtures in `tests/demand-signals-collect.test.ts`. A shape change means a new adapter version, a new definition and a new mark |
| `rows_over_cap` | The run would have passed 224 weather rows. That shop was refused whole | More than two shops with a point: raise the cap in the collector AND in 0343 together, by a reviewed change |
| `bad_shop_point` | The shop's coordinates are not a real point | Fix its catering fulfilment node |
| `no_coordinates` | The shop has no ACTIVE catering fulfilment node. No request was made for it | Give it one: "Shop points" below |
| `multiple_points` | The shop has more than one active node and none is marked primary (the table has no such flag), so none is picked | Leave one active (0138's UNIQUE (location_id) makes this unreachable today) |
| `bad_coordinates` | The shop's active node has a non-numeric lat / lng | Fix its catering fulfilment node |
| `deadline` | The pass ran out of its 45 seconds | Check api.weather.gov latency |
| `write_failed`, `weather_rows_invalid`, `events_invalid` | 0343's writer refused the rows | Read the row shape against 0343 |

Every active shop is in the run result: collected, or listed with one of the three point codes above (both feeds carry the code, so each such shop counts 2 in `failed` and the heartbeat is `cron.failure` until it has a point).

## Shop points (CC, before turning the collection on)

A shop's point is its ACTIVE `catering_fulfillment_nodes` row (one per shop; `lib/demand-signals/shop-points-shared.ts`). On 2026-11-18 prod had **0 rows**, so the collector would collect nothing. The seed adds one per shop that has none:

```
npx tsx --env-file=.env.local scripts/seed-shop-points.ts            # dry run: prints insert / exists / REFUSED per shop
npx tsx --env-file=.env.local scripts/seed-shop-points.ts --apply    # sim first, then prod
```

- Data: `docs/seed/shop-points-dc-2026-11-18.json`, geocoded with the U.S. Census Bureau geocoder (`onelineaddress`, benchmark `Public_AR_Current`), one match each:

  | Shop | Address | lat | lon | Matched as |
  |---|---|---|---|---|
  | Capitol Hill | 526 8th St SE, Washington, DC 20003 | 38.882490405378 | -76.994901886996 | 526 8TH ST SE, WASHINGTON, DC, 20003 (address-range interpolation, TIGER edge 76230676) |
  | P Street | 2029 P St NW, Washington, DC 20036 | 38.909697992057 | -77.046018059515 | 2029 P ST NW, WASHINGTON, DC, 20036 (address-range interpolation, TIGER edge 76225279) |

  Interpolated along the street segment, so tens of metres at most: far below the NWS forecast grid (2.5 km).
- A shop is matched by NAME against active locations (the `names` list in the file, case-insensitive, exactly one). `location_not_found` / `location_ambiguous` on the dry run: correct the names in the file, never the code.
- The row is inserted with `offers_delivery = false`, `offers_pickup = false`, `active = true` and a placeholder `delivery_radius_meters` (1609, NOT NULL > 0). **The customer order funnel does not change:** `/order/start` shows "we deliver" only for a node offering delivery and lists only nodes offering pickup, and `routeDelivery` considers only nodes offering delivery. The admin page `/admin/catering/fulfillment` will show the shop as configured with delivery and pickup off; turning catering delivery on there edits the same row (and sets the real radius).
- A shop that already has a node is never touched (`exists`, printed with its coordinates). One audit row `catering.fulfillment.node_upsert` per insert (`actor_context: seed_shop_points`).
- Check: `select l.name, n.lat, n.lng, n.active, n.offers_delivery, n.offers_pickup from catering_fulfillment_nodes n join locations l on l.id = n.location_id;`
- Known coupling, stated: the weather point and catering's delivery centre are one row. If a shop's delivery centre is ever moved away from the shop, or its node deactivated to stop catering, the collector follows. A separate shop-point source (e.g. coordinates on `locations`) would need a migration; propose it only if that ever happens.

## Known limits

- The alert reader was written from a live alert elsewhere in the country (DC had none on 2026-11-18). The first real DC alert is the canary: check its row in `demand_day_events`.
- The hourly forecast reaches about 6.5 days. It informs within-week decisions, not the Wednesday schedule draft.
- Nothing reads these tables on an operational path yet. The state machine (PR 4), the page (PR 5) and the chips (PR 6) do, through the gated readers only.

## Rolling back

Unset `DEMAND_SIGNALS` (the cron goes quiet at once), or revoke the source (collection AND use stop). 0343's tables are append-only and are left in place.
