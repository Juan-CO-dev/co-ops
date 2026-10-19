**Historical plan: deployment order and migration numbering SUPERSEDED.** Follow only the [authoritative deploy runbook](2026-10-19-lockdown-step2-manifest.md#authoritative-deploy-runbook-2026-10-19-final-review). 0276 is the guarded-writer prerequisite; 0277 is lockdown. Never ship the app before 0276 and a passing preflight on the target DB.

**Plan only; no files changed.** HEAD is `bd72a8c2`. The original release outline below is historical; use the runbook above.

**Evidence limits:** original policies predate the migration lineage; their repository source is Foundation Spec v1.3, subsequently amended by 0058/0217. No live SQL connector is available here. CC must supply `pg_policies`, effective table/column grants, helper definitions, and migration receipts before this becomes an implementation-ready authorization specification. Do not treat the spec as a verified live-policy dump.

**1. Freeze the inventory and authorization contract — ½ day**

Direct application writes located:

| File and line | Writer/client today | Existing application checks |
|---|---|---|
| `lib/checklists.ts:835` | `getOrCreateInstance`; supplied client | Location, employee floor, submission gate; API restricts template to closing |
| `:1017` | `completeItem`; supplied client | Open, assignment, submission lock, item/template binding, active item, role, answers/count/photo |
| `:1177` | `submitBatch`; supplied client | Open, assignment, submission lock; completion belongs to instance **and actor** |
| `:1519,1573,1598,1612` | `confirmInstance`; supplied client | Open, assignment, lock-up/cash/hard gates, role, reasons, actor PIN; guarded claim and compensation |
| `lib/written-reports.ts:332,376` | Create/update; authenticated client | Create floor; update currently relies on RLS for ownership/window |

Consumers to change: `app/api/checklist/{instances,completions,submissions,confirm}/route.ts` calls at **112/79/63/90**; written-report collection/item routes at **77/61**. `app/(authed)/operations/closing/page.tsx:261` also calls `getOrCreateInstance`, already with service context. No additional direct writer was found in dashboard server actions.

Already-service direct writes remain regression dependencies:

- `lib/checklists.ts`: completion supersession/restore/link **994/1043/1081**, revoke/reopen/tag **1884/1999/2156/2330**; instance drop/release **2782/2892**.
- `lib/prep.ts`: instance creation **841/1278**, finalize **1805**; completion supersede/restore/insert/link **1973/1988/1998/2020**.
- `lib/opening.ts:2619`: completion revoke.
- Service RPC consumers: opening create/phase-one/save/revoke/finalize; prep AM-submit/AM-edit/midday-submit/save; overdue-closing release. Their SQL bodies and execution grants belong in the migration preflight manifest.

Scripts also matter: `test-station-lifecycle.sql:61,78,84,87,100`; `test-whos-here.sql:71,201,203,207,213,216,225,229,231`; guide reset scripts delete/update instances at **52/54** and **55/57**. These are fixture/operator SQL, not live authenticated application writers. The 0272 harness has synthetic writes. Concurrency scripts drive application endpoints and inspect persisted rows.

**Read preservation:** keep every existing authenticated read authenticated; do not remove SELECT. Some reads already use service context—particularly written-report list/detail **176/268**, opening/prep loaders, and reporting. Preserve those contracts rather than silently migrating them.

The read inventory spans checklist helpers **612/710/728/774/853/1149/1284/1540/1561/1756/1820/2515/2677/2870**, written edit lookup **369**, opening/prep libraries and routes, operations pages, dashboard/cash pages, reports hub/search/trends/digests/related, maintenance, midshift, PM reports, people facts, fridge pulse, assignments, drafts, template builder and week card. Sim contracts/concurrency scripts also read these tables. **An exhaustive line-by-line read/RPC manifest remains a prerequisite deliverable; this summary is not that complete manifest.**

**2. Test first, then cut over writers — 1½–2 days**

Touch `lib/checklists.ts`, `lib/written-reports.ts`, the six routes above, closing-page caller, and affected tests. Introduce a session-derived write context; never accept attribution or authority from request-body fields. Preserve public response/error shapes and audit vocabulary.

Policy mapping to verify against live export:

| Policy | Required application enforcement |
|---|---|
| `checklist_instances_insert`—0058 | Actual membership; opening/prep ≥4, other types ≥3 |
| `checklist_instances_insert_closing_staff`—0217 | Session identity, ≥3, membership, open, current ET date, active closing template matching shop |
| `checklist_instances_update`—baseline | Membership and ≥3, plus existing operation-specific guards |
| `checklist_completions_insert`—baseline | Actor attribution, item role floor, parent membership and open status |
| `checklist_completions_insert_closing_staff`—0217 | Attribution, ≥2, membership/open parent, closing template, active matching item, item floor; exclude report/tracked references |
| `checklist_submissions_insert` | `submitted_by = session user`; preserve stronger batch checks |
| `checklist_incomplete_reasons_insert` | `reported_by = session user`; preserve exact required-item reason validation |
| `written_reports_insert` | Session author and ≥3; preserve route’s null-or-member location rule |
| `written_reports_update_self` | Session author; strict `submitted_at > now()-3h`; preserve existing SELECT eligibility |
| Existing false UPDATE/DELETE policies | No new public mutation capability; retain append-only behavior |

The two INSERT policies on each checklist table are **OR alternatives**, not cumulative requirements. Preserve legitimate older-date workflows and employee handoffs. Another person starting a shared checklist does not make it forbidden; foreign completion attribution or unauthorized assignment does.

Do not substitute `lockLocationContext` blindly: its owner override differs from the membership predicate shown in SQL. Likewise level-8 global **read** authority is not write authority. Verify current active-user/session/membership semantics from 0189/0200 and live helpers.

App prechecks alone cannot preserve statement-time open-state/window enforcement. Use narrow service-only guarded SQL writers where necessary, with matching application checks. **SUPERSEDED:** prerequisite allocation is resolved as 0276; lockdown is 0277. See the authoritative runbook above.

**3. Rowcounts and concurrency — ½–1 day**

Every single-row update must return exactly one row; errors, null counts and unexpected cardinalities fail explicitly. Preserve conflict/denial responses.

- Confirmation: conditional `id + location + status=open`.
- Compensation: same actor, claimed status **and exact confirmation timestamp**, preventing an earlier attempt from undoing a later claim.
- Written edit: author/window predicates at mutation time; avoid losing concurrent `edit_count` increments.
- Supersession: distinguish allowed zero-row race losses from failed restoration; verify expected claimed-head cardinality. Check the currently unchecked link update at `checklists.ts:1081`.
- No application DELETE is introduced.

Add behavioral tests for each moved writer: spoofed actor, foreign shop including globally readable shop, revoked assignment/session, closed instance, wrong/missing PIN, foreign completion, incorrect reasons, rollback by another claimant, three-hour boundary, concurrent confirm and completion-versus-confirm. Use separate fake read/write clients that fail if a mutation reaches the authenticated client.

**4. Migration 0276 and executable proof — 1 day**

New files: `supabase/migrations/0276_postgrest_checklist_write_lockdown.sql`, `scripts/sql-harness-0276.mjs`, `tests/postgrest-checklist-write-lockdown-migration.test.ts`.

Mirror the read 0272 harness/test structure:

- Transactional five-table manifest; revoke table **and column** writes from PUBLIC/anon/authenticated.
- Drop every permissive write policy, including both 0217 siblings; retain explicit false denies and all SELECT policies/grants.
- 0257-style service ceiling: revoke broad rights, grant only required SELECT/INSERT/UPDATE; assert absence of DELETE/TRUNCATE/REFERENCES/TRIGGER.
- Per-table guards: RLS enabled, effective privileges correct, SELECT grants/policies unchanged, no callable definer-writer escape.
- Five `security.grants_change` audit rows; retained authoring gate and application-readiness prerequisite.
- PGlite role tests plus mutations leaving table/column/PUBLIC grants or permissive sibling policies. Each mutation must fail for its expected reason.
- Real PostgreSQL sim verification is mandatory: 0272 explicitly documents PGlite’s column-ACL limitation.

**Ceiling risk:** existing sim restoration deletes history. Resolve its approved reset authority before applying the service ceiling; do not restore service DELETE merely to make fixtures pass.

**5. Sim, deployment and rollback — ½–1 day**

Extend the lease-protected launch-readiness runner with a new walkthrough contract: open → complete → batch submit → incomplete reason/PIN confirmation → injected dependent-insert failure and owned rollback → retry → written-report create/edit. Test both shops and role boundaries. Fault injection must remain test-only.

Run:

```text
npm test
npm run typecheck
npm run lint
npm run build
node scripts/sql-harness-0276.mjs
node --import tsx scripts/sim/launch-readiness/run.ts --suite opening --fixture cold-empty --repeat 2
```

Include existing confirmation-denial, supersession-compensation, closing-participation, assignment, finalize-gate, note-timestamp, opening tests, plus concurrency races/full-day under the authorized runner.

**SUPERSEDED deploy instructions:** use the authoritative runbook above; this historical section is not an operator procedure.

Before lockdown, app rollback remains possible. After lockdown, roll back only to a service-writer-compatible build; prefer forward repair. Restoring captured grants/policies requires explicit emergency approval and reopens the vulnerability.

**CC decisions:** live-policy evidence; prerequisite numbering/order; owner-membership semantics; sim reset authority. Review against BC-001/004/007/023/030/038/041/056/060.

**Result:** plan only; repository reads and history inspection performed, no tests executed. Estimated **4–6 engineering days plus review/deployment gates**. Detached worktree: `C:/Users/conta/co-ops-sol-sec`, `bd72a8c2`.
