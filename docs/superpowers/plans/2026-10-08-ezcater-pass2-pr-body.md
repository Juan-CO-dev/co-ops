# PR #408 - ezCater PASS 2b review fixes

ezCater order-line UUIDs cannot identify repeat menu items. Mappings now use menu_item_size_id plus sorted customization IDs and quantities; line UUIDs remain observational. Blank POS IDs become NULL. Authorized reviewers can approve a Toast menu/item/package target or ignore a candidate from `/admin/catering/ezcater-review`; future shadow runs consume those decisions without overwriting or reopening them.

Manual wrong-shop corrections remain valid after completion or loss. Provider/shop disagreement is informational. Toast note matching is transient and cannot change capture snapshots. Shadow failures have their own heartbeat and do not fail operational Toast sales health.

## Review fix anchors

| Finding | Implementation |
| --- | --- |
| P1 stable item identity / NULL POS IDs | `lib/ezcater/pass2-shared.ts:23`; `lib/ezcater/orders-shared.ts:123`; `supabase/migrations/0225_ezcater_pass2.sql:324` |
| P1 approve / pick / ignore UI | `app/admin/catering/ezcater-review/review-client.tsx:9`; `app/admin/catering/ezcater-review/page.tsx:9`; hub link `app/admin/catering/page.tsx:73`; bilingual labels in `lib/i18n/en.json:2` and `es.json:2` |
| P1 fresh role / step-up / destructive audit / history | `lib/admin/ezcater-review.ts:72`; `app/api/admin/catering/ezcater-review/route.ts:7`; `lib/destructive-actions.ts:39`; SQL decisions table `0225_ezcater_pass2.sql:346`, decision RPC `:379`, publisher preservation `:454` |
| P1 confirmed mapping consumption, packages | `lib/ezcater/pass2.ts:131`; `lib/ezcater/shadow-package.ts:11` |
| P2-1 no persisted free-text tokens | `lib/toast/capture-shared.ts:75`; transient known-code matcher `lib/ezcater/toast-codes.ts:16`; catering/source-version scope `lib/ezcater/pass2.ts:94` |
| P2-2 independent heartbeat / health | `lib/toast-sales-pull-run.ts:98`, `:108` |
| P2-3 manual shop information | `0225_ezcater_pass2.sql:74`, `:144`; `lib/catering/ezcater-reconciliation.ts:20`; `components/catering/pipeline/EzcaterReconciliationPanel.tsx:28` |
| P2-4 late transfer double-count gate | `lib/ezcater/pass2-shared.ts:48`; audit read and flag gate `lib/ezcater/pass2.ts:57`; regressions `tests/ezcater-pass2.test.ts` and `tests/ezcater-shadow.test.ts` |
| P2-5 missing-schema deploy safety | shadow skip `lib/ezcater/pass2.ts:29`; transfer 503 `lib/catering/transfers.ts:39`; transfer Retry-After `app/api/catering/pipeline/[id]/transfer/route.ts:27`; legacy sync location_mismatch probe `lib/ezcater/sync.ts:21` |
| P3 completed/lost, deadlock, event index | `scripts/test-catering-transfers.sql:53`; `lib/catering/transfers.ts:33`; `0225_ezcater_pass2.sql:6` |
| SIM reapply / SQL harnesses | `scripts/sim-revert-0225.sql:1`; `scripts/test-ezcater-pass2.sql:66`; `scripts/test-catering-transfers.sql:1` |

## PASS 3 activation contract

`EZCATER_DEPLETION_ENABLED=1` does not activate operational depletion in this PASS 2 build. Before any PASS 3 reader can use ezCater sales fallback, it must use the transfer-aware evidence path:

- Read real transfer audit rows for the lead, including `metadata.from_location_id`. Informational `manual_location_kept` observations are not transfers.
- A move on or after midnight ET on D-1 adds both its former and destination shops to the production evidence set; multiple late moves include all involved shops.
- Check live, non-revoked/non-superseded production on ET D-1 and D at every involved shop. Old-shop prep suppresses corresponding prep-mediated sales consumption at the new shop. Direct raw ingredients retain existing recipe semantics.
- Evidence read failures refuse publication; with the flag enabled, malformed transfer evidence also refuses it. Never fall back to current-shop-only production on error.
- Keep production where it happened. Production lacks a catering-lead FK, so the existing item/day production suppression remains conservative.

The flag-enabled regression exercises old-shop suppression and refusal on failed/malformed audit evidence. ET boundary, DST, multi-hop, unrelated-shop, nested recipe, and package cases are covered.

## Verification

Final full suite and typecheck exited 0 on 2026-10-08:

```text
npm.cmd test
Test Files  327 passed (327)
Tests       5321 passed | 1 skipped (5322)

npm.cmd run typecheck
tsc --noEmit - passed

git diff --check - passed (line-ending warnings only)
```

The first integrated run identified the new client's missing Tier B registry entry and two TypeScript fixture/result-shape errors; all were corrected before the passing run. A final Spanish accent correction changes strings only. Static parity checks confirmed that the schema fragment matches 0225 and the guarded SIM revert restores the exact original 0223 writer.

Full build attempted:

```text
npm.cmd run build - exit 1
next/font: error: Failed to fetch `DM Sans` from Google Fonts.
Import trace: app/layout.tsx
```

This environment could not connect to Google Fonts. No successful production build or browser/preview smoke is claimed. SQL was inspected and its embedded-schema/restored-writer parity checked; no SQL was executed. CC still needs the SIM harness and cross-family final review before merge. Applicable review classes: BC-001/002/003/004/005, BC-006/007/008/009/010, BC-014/018/023/032/036/037/038/040/042.

## CC reapply and deployment gate

Original 0225 is applied only on SIM as version `20261008073152`. Revised 0225 is edited in place. On SIM, with CC's existing private connection configuration:

```sh
psql -v ON_ERROR_STOP=1 -f scripts/sim-revert-0225.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0225_ezcater_pass2.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-catering-transfers.sql
psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-pass2.sql
```

The revert is destructive only to SIM PASS 2 derived tables. It requires both `maya@sim.co-ops` and the exact original migration version, restores the original 0223 apply writer, and removes only 0225's lineage row. It preserves operational transfers already recorded, production, and audit history. The harnesses roll back. Use the normal migration operator for reapplication/lineage recording; raw psql does not insert a Supabase migration ledger row itself.

**PR gate: apply reviewed 0225 before deploying the code.** The missing-schema skip/503 paths protect accidental code-first skew; they do not waive this gate. 0224 remains untouched. No migration was applied by Astra.

## Remaining limits

- Historical customizations missing stable IDs remain unmapped until a successful provider refresh supplies them; names never establish identity.
- Transient note links require a non-null captured source timestamp equal to the raw order version. Changed/unknown versions remain unlinked and need ordinary capture refresh. Notes/tokens are never stored in selection_units.
- Approved package targets use existing full-assortment even-mix semantics. Missing composition refuses the entire package line. Reviewers choose the intended variant/target explicitly.
- The shadow ledger is comparison-only. Whole-shop `current_day_sales_oz` repeats on item rows and must not be summed across ezCater lines.
- Step-up, SQL authorization/grants, and append-only decision history are covered by local regressions plus the unexecuted SIM harness; UI phone/browser validation remains pending.

Branch/worktree: `feat/ezcater-pass2`, `C:\Users\conta\co-ops-reports-h1`. Changes remain uncommitted. No git write, production access, provider request, push, merge, or deployment was performed.
