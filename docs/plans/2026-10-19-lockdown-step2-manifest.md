# Lockdown step 2 - five-table manifest (R7 chunk 1)

## Authoritative deploy runbook (2026-10-19 final review)

This is the sole deploy sequence; it supersedes R6 and the original plan's deployment order and migration numbering. **The app must NEVER ship before 0276 is installed and its preflight passes on the target database.** CC operates these gates; this builder task performs no database writes.

1. Apply `0276_checklist_guarded_writers.sql` on sim, then run `node scripts/preflight-0276-management.mjs --ref=<sim-ref>` on sim.
2. Run the Management-API lock proof on sim: `node scripts/sim/checklist-0276-lock-check-management.mjs --ref=<sim-ref>`. Require passing blocking/winner-loser evidence before proceeding.
3. Apply 0276 on prod, then run `node scripts/preflight-0276-management.mjs --ref=<prod-ref>` on prod. Stop on any missing signature or service_role EXECUTE.
4. Merge the app PR and require the production deployment to be READY.
5. Drain or SSO-gate old deployment URLs, then smoke closing and written-report flows on prod. READY alone does not eliminate old deployments.
6. Apply `0277_postgrest_checklist_write_lockdown.sql` on sim; perform harness-equivalent verification on real sim (role write denial, preserved SELECT/table and column ACLs/policies, service rights, all six prerequisites, callable definer-writer refusal, audit and rollback assertions). Only after that evidence and **Juan's yes**, apply 0277 on prod.

Operator credentials are supplied through the environment; do not load `.env`. Local PGlite harnesses are offline proof, not substitutes for the real sim gates. After lockdown, rollback only to a service-writer-compatible app; prefer forward repair. Restoring grants/policies requires separate emergency approval.


## Chunk-4 amendment (2026-10-19)

Part A applies CC's Opus review rulings: existing-instance reads require active actor and membership OR level >=8; creation still requires membership. Closing page nonmembers / refused write actors take the read-only loader with readOnly=true. The instance POST now validates template type, active state and exact requested shop. Completion cardinality and completion-RPC 23505 map to concurrent_modification; PIN confirm handles that and invalid_payload through reload + onError. Missing checklist RPCs log [checklist 0276_missing].

0277 revokes PUBLIC/anon/authenticated writes on all five tables, keeps SELECT and service_role rights, and asserts exact before/after SELECT ACL/policy parity. Its five per-table security.grants_change rows plus one migration-summary row carry migration_apply metadata; the summary targets schema_migrations to satisfy audit_log.resource_table NOT NULL. Read-only operator preflight: scripts/preflight-0276.mjs (explicit CHECKLIST_PREFLIGHT_DATABASE_URL; no .env; not run against a database by the builder). It checks the three checklist RPCs plus the chunk-3 report writer and both helper dependencies. CC still owns real sim verification and promotion. Detailed assertions/verification: 2026-10-19-lockdown-step2-chunk4-result.md.

## Chunk-3 amendment (2026-10-19, supersedes historical descriptions below)

Base `59f2d8bf`, branch `feat/lockdown-step2`. Written-report POST/PATCH now resolve the verified actor with `resolveChecklistWriteActor`; the library owns service writes. Create binds author/role exclusively to that actor, requires active level >=3 and null-or-member location. Update calls service-only `written_report_update_self` in **0276**, with author + strict `submitted_at > now()-interval '3 hours'` and `edit_count = coalesce(edit_count,0)+1` in the same SQL UPDATE; exactly one row succeeds, zero preserves `window_closed`. Read clients/callers remain unchanged (existing list/detail loaders already use service with app gates; no read cutover).

Completion now returns `{completion, superseded_ids, kept_completed_at}`; audit consumes it without another read. Exactly one eligible prior head may carry its timestamp; two heads do not (accepted difference from the old app's `superseded[0]`). Confirmation reuses an existing `(instance, template_item, reported_by)` reason; `p_confirmed_at` is compatibility-only and ignored in favor of `clock_timestamp()`, returned from the stored instance. The migration asserts service-role EXECUTE on `assignment_author_level(uuid)` and records `security.grants_change` with `actor_context=migration_apply`. SECURITY INVOKER depends on service_role retaining table DML; any future service-role ceiling must account for all five functions.

**Follow-up ticket / PR disclosure:** `revokeCompletion`, `revokeWithReason`, `markNotDoneByAuthority`, `tagActualCompleter`, `replaceLiveClosingRefCompletion` (`lib/prep.ts`), and the prep single-submission lock race remain existing service-role paths outside 0276 serialization. Release claim remains **replacement + confirm through 0276**, not a universal freeze guarantee. Scope and assertion ledger: `2026-10-19-lockdown-step2-chunk3-result.md`.

0277 is now authored FILE ONLY (chunk 4); no migration applied. **Before any apply: two-connection sim proof must PASS and P2 findings must be closed.** Offline PGlite is not that proof. Unknown-role parity explicitly records the legacy helper's level-0 fallback versus the new actor/SQL refusal; the original 720 null-actor cases are not session coverage. Real revoked/expired/mismatched/inactive actor resolution is covered separately by behavioral tests.

Baseline: `34a3624a`, `feat/lockdown-step2`, 2026-10-19. Source inspection only; no database, credentials, environment files, or operator scripts were used. This inventories existing readers/writers before the chunk-2 cutover. R7 allocates 0276 to guarded writers and 0277 to lockdown. Neither migration is applied by this task.

## Authority and limits

The CC-supplied live policy/helper export in `2026-10-19-lockdown-step2-rulings.md` is the authorization evidence. All five tables currently grant anon/authenticated/service_role SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER; permissive RLS determines effective user writes. R4/R7 preserve SELECT and the existing service-role ceiling. This file does not claim to have independently queried production, nor does the supplied export contain every live RPC definition/signature/ACL. Repository function grants below are deployment-preflight evidence, not a live ACL certification. Confirm installed overloads and effective PUBLIC/anon/authenticated grants before 0277.

Tables: checklist_instances (I), checklist_completions (C), checklist_submissions (S), checklist_incomplete_reasons (R), written_reports (W). Authenticated clients (`authed`, `createAuthedClient`) enforce RLS. Service clients (`service`, service-backed `sb`) bypass RLS. A supplied client retains the caller's authority; its variable name alone does not guarantee RLS. `lib/supabase-server.ts:59` and `:73` define the factories. All query sites below preserve their current read client; no reader cutover is authorized in chunk 1.

R2: identity must resolve an unrevoked, unexpired matching session; role requires active user; memberships are actual user_locations rows, with no owner/global write override. RLS siblings OR together. The baseline completion policy does NOT require active/matching item or exclude report references; its closing sibling adds those checks. Preserve this distinction in policy parity and retain stronger existing application validation separately. Submission/reason self-only holes close with member/open parent (confirm's own transaction may write after its claim); arbitrary instance status UPDATE closes with the guarded confirm operation.

## Direct writer contracts and callers

| Site | Client | Existing checks / disposition |
|---|---|---|
| lib/checklists.ts:835 getOrCreateInstance | Supplied (`authed` on API, service on closing page) | lockLocationContext, employee floor for creation, configured submission gate; API now explicitly validates closing type, active=true and template.location_id === requested locationId (chunk-4 review fix; baseline checked type only). Existing-row path is a read. 23505 re-read. Keep plain INSERT with R2 actor guard in chunk 2. |
| lib/checklists.ts:994,1017,1043,1081 completeItem | service supersede/restore/link, supplied INSERT | Open parent, assignment, single-submission lock, item/template binding, active item, role floor, payload/count/photo checks. Supersede before insert; owned-stamp restoration; link write currently unchecked. R7 replaces transaction as a whole, not just INSERT. |
| lib/checklists.ts:1177 submitBatch | Supplied | Open, assignment, single-submission lock; each completion id present and belongs to instance AND actor; nonfinal event. R7 parent-locked RPC. |
| lib/checklists.ts:1519,1573,1598,1612 confirmInstance | Supplied | Open, assignment, role, lock-up/cash/hard gates, exact reasons and actor PIN; guarded claim, reason inserts, final submission, compensation on failure. R7 replaces this transaction; PIN/gates stay app-side. |
| lib/checklists.ts:1884 revokeCompletion | service | Live completion, task access, self, quick window; conditional live-row update and nonzero returned rows. |
| lib/checklists.ts:1999 revokeWithReason | service | Live completion/task access, self and reason rules; conditional live-row mutation and returned-row check. |
| lib/checklists.ts:2156 markNotDoneByAuthority | service | Authority role check, live completion/task access, reason; conditional live-row mutation and returned-row check. |
| lib/checklists.ts:2330 tagActualCompleter | service | Role/self/quick-window policy, allowed candidate, task access; conditional live row, attributed completer, returned-row check. |
| lib/checklists.ts:2782 dropInstance | service | Visible instance/task access, assigned to actor, not locked; UPDATE repeats assignment/lock predicates; returned row required. |
| lib/checklists.ts:2892 releaseClosingByOpener | supplied service | Closing template/open precheck; status=open conditional UPDATE and returned row; caller binds actor/shop. |
| lib/prep.ts:841,1278 | supplied service | AM task access/location route gate; template/shop/date identity; unique-race reload (AM), max instance count (midday). |
| lib/prep.ts:1805 finalizeMidDayPhase2 | supplied service | Task access; conditional phase1_complete transition, returned row or explicit not-found/not-in-phase2. |
| lib/prep.ts:1973,1988,1998,2020 replaceLiveClosingRefCompletion | supplied service | Internal reference reconciliation, instance/item key, live-head supersession, owned timestamp restore/link; metadata-backed auto completion. Separate existing service writer, no R7 cutover in chunk 1. |
| lib/opening.ts:2619 revokePhase2Completion | supplied service | Instance eligibility/task access and live completion, completion bound to instance, revocation reason rules; batch branch uses RPC instead. |
| lib/written-reports.ts:332 createWrittenReport | authenticated | Level >=3 and RLS self author; route validates null-or-member location and draft. |
| lib/written-reports.ts:376 updateWrittenReport | authenticated | RLS self + strict submitted_at > now()-3h and SELECT visibility; zero returned rows means denial. Read/increment edit_count is not atomic (chunk 3 concern). |

API callers: `app/api/checklist/instances/route.ts:112`, `completions/route.ts:79`, `submissions/route.ts:63`, `confirm/route.ts:90` pass authenticated clients/session actors. `app/(authed)/operations/closing/page.tsx:261` passes service to getOrCreateInstance. `app/api/written-reports/route.ts:77` and `[id]/route.ts:61` pass authenticated clients. All require session. No direct five-table writer exists in dashboard actions.

These pre-existing service writers are regression dependencies, not proof that every mutation in the application already shares R7's parent lock. In particular revoke/tag/reference reconciliation remain distinct paths. The new completion/confirm RPC race proof must not be represented as a universal freeze guarantee over all historical service writers.

## Reader scope contracts

- Checklist supplied-client reads use RLS parent membership OR level >=8, with operation-specific assignment checks. Service-backed closing page uses its explicit location gate; its getOrCreate call already bypasses RLS today.
- Opening/prep service reads use page/route session + location gates, task assignment checks, and instance/template/date filters. Internal helper readers accept already-authorized arguments, not arbitrary public requests.
- Written-report service list/detail explicitly apply viewer floor, author/visibility, employee-own-only, and null/member/global read scope; these deliberately differ from raw authenticated SELECT (which has no author visibility override). Update lookup remains authenticated.
- Reports hub/search use requireReportScope; trends' location authorization is upstream. Maintenance, midshift, pulse/fridges, assignment-taken, people/facts and digest helpers are internal service readers with caller scope and query filters, not independent authentication boundaries. Preserve the existing caller checks; an id filter by itself is not authorization.
- Dashboard/operations/cash pages require session and resolve allowed shop; API opening/prep routes require session, load instance and check location/task access. Week card checks canReadReportLocation; template builder applies its admin scope. Service report reads must not be silently replaced by authenticated reads or vice versa.

## Every direct application query site

The following inventory enumerates every literal five-table `.from(...)` in `lib` and `app` at baseline. Each entry records receiver, first operation, enclosing function, and the local query tail (including filters/row-return checks where adjacent). `S` means service factory/supplied service, `A` means supplied authenticated-client contract. `A*` in checklists means supplied client: closing-page callers may supply service. Application guard contracts are above; query filters are not claimed to be authorization by themselves. No browser client writes were found.

### lib/admin/template-builder.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 662 `runTemplateDoctor` | checklist_instances / select / S `sb` | `.select("id", { count: "exact", head: true }) .in("template_id", lineageIds) .eq("date", today);` |
| 856 `publishTemplateVersion` | checklist_instances / select / S `sb` | `.select("id", { count: "exact", head: true }) .in("template_id", lineageIds) .eq("location_id", src.location_id) .eq("date", today);` |

### lib/admin/week-card.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 144 `loadWeekCard` | checklist_instances / select / S `sb` | `.select("id, location_id, template_id, status, dropped_at") .in("location_id", shopIds).gte("created_at", since) .order("id", { ascending: true }).range(from, to)), // Global by design: labels (type + prep_subtype) for the shop-scoped instances above. selectAllRows<{ id: string;` |
| 152 `loadWeekCard` | checklist_completions / select / S `sb` | `.select('id, ${COMPLETION_INSTANCE_EMBED}') .in("checklist_instances.location_id", shopIds) .gte("completed_at", since).not("completed_by", "is", null) .is("superseded_at", null).is("revoked_at", null).is("auto_complete_meta", null) .order("id", { ascending: true }).range(from, to) .returns<Array<{ checklist_instances: EmbeddedInstance }>>()), selectAllRows<{ location_id: string }>((from, to) => sb.from("pm_reports").select("location_id") .in("location_id", shopIds).gte("submitted_at", since).is("superseded_at", null) .order("id", { ascending: true }).range(from, to)), selectAllRows<{ location_id: string }>((from, to) => sb.from("cash_reports").select("location_id") .in("location_id", shopIds).gte("created_at", since).is("superseded_at", null) .order("id", { ascending: true }).range(from, to)), selectAllRows<{ location_id: string }>((from, to) => sb.from("purchase_orders").select("location_id") .in("location_id", shopIds).gte("placed_at", since) .order("id", { ascending: true }).range(` |

### lib/am-prep-draft.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 187 `saveAmPrepDraft` | checklist_instances / select / S `service` | `.select("id, template_id, location_id, date, status") .eq("id", args.instanceId) .maybeSingle<{ id: string;` |

### lib/assignment-taken.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 22 `loadTakenTasks` | checklist_instances / select / S `service` | `.select("id,template_id,triggered_by_user_id,triggered_at,assigned_to,dropped_at") .eq("location_id", args.locationId).eq("date", args.date).order("id").range(from, to)), selectAllRows<{ id: string;` |

### lib/cash.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 137 `submitCashReport` | checklist_instances / select / S `service` | `.select("status") .eq("template_id", cTmpl.id).eq("location_id", args.locationId).eq("date", args.date) .maybeSingle<{ status: string }>();` |

### lib/checklists.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 612 `loadInstanceOrThrow` | checklist_instances / select / A* `authed` | `.select( INSTANCE_COLUMNS, ) .eq("id", instanceId) .maybeSingle<InstanceRow>();` |
| 710 `rejectIfPrepLocked` | checklist_instances / select / A* `authed` | `.select("id, template_id") .eq("id", instanceId) .maybeSingle<{ id: string;` |
| 728 `rejectIfPrepLocked` | checklist_submissions / select / A* `authed` | `.select("*", { count: "exact", head: true }) .eq("instance_id", instanceId);` |
| 774 `getOrCreateInstance` | checklist_instances / select / A* `authed` | `.select( INSTANCE_COLUMNS, ) .eq("template_id", templateId) .eq("location_id", locationId) .eq("date", date) .maybeSingle<InstanceRow>();` |
| 835 `getOrCreateInstance` | checklist_instances / insert / A* `authed` | `.insert({ template_id: templateId, location_id: locationId, date, shift_start_at: triggerTimestamp, status: "open" as ChecklistStatus, triggered_by_user_id: actor.userId, triggered_at: triggerTimestamp, }) .select( INSTANCE_COLUMNS, ) .maybeSingle<InstanceRow>();` |
| 853 `getOrCreateInstance` | checklist_instances / select / A* `authed` | `.select( INSTANCE_COLUMNS, ) .eq("template_id", templateId) .eq("location_id", locationId) .eq("date", date) .maybeSingle<InstanceRow>();` |
| 994 `completeItem` | checklist_completions / update / S `sb` | `.update({ superseded_at: claimStamp }) .eq("instance_id", instanceId) .eq("template_item_id", templateItemId) .is("superseded_at", null) .is("revoked_at", null) .select("id, completed_by, completed_at, count_value, photo_id, actual_completer_id");` |
| 1017 `completeItem` | checklist_completions / insert / A* `authed` | `.insert({ instance_id: instanceId, template_item_id: templateItemId, completed_by: actor.userId, count_value: args.countValue ?? null, photo_id: args.photoId ?? null, notes: args.notes ?? null, ...(carryAt ? { completed_at: carryAt } : {}), }) .select(COMPLETION_COLUMNS) .maybeSingle<CompletionRow>();` |
| 1043 `completeItem` | checklist_completions / update / S `sb` | `.update({ superseded_at: null }, { count: "exact" }) .eq("id", claimed.id) .eq("superseded_at", claimed.stamp);` |
| 1081 `completeItem` | checklist_completions / update / S `sb` | `.update({ superseded_by: newId }).eq("id", priorId).is("superseded_by", null);` |
| 1149 `submitBatch` | checklist_completions / select / A* `authed` | `.select("id, instance_id, completed_by") .in("id", completionIds);` |
| 1177 `submitBatch` | checklist_submissions / insert / A* `authed` | `.insert({ instance_id: instanceId, submitted_by: actor.userId, completion_ids: completionIds, is_final_confirmation: false, }) .select("id, instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation") .maybeSingle<SubmissionRow>();` |
| 1284 `confirmInstance` | checklist_completions / select / A* `authed` | `.select("id, template_item_id") .eq("instance_id", instanceId) .is("superseded_at", null);` |
| 1519 `confirmInstance` | checklist_instances / update / A* `authed` | `.update({ status: newStatus, confirmed_at: new Date().toISOString(), confirmed_by: actor.userId, }) .eq("id", instanceId) .eq("status", "open") // optimistic concurrency: confirm only if still open .select( INSTANCE_COLUMNS, ) .maybeSingle<InstanceRow>();` |
| 1540 `confirmInstance` | checklist_instances / select / A* `authed` | `.select("status").eq("id", instanceId).maybeSingle<{ status: ChecklistStatus }>();` |
| 1561 `confirmInstance` | checklist_incomplete_reasons / select / A* `authed` | `.select("id, instance_id, template_item_id, reason, reported_by, reported_at") .eq("instance_id", instanceId) .eq("reported_by", actor.userId) .in("template_item_id", itemIds);` |
| 1573 `confirmInstance` | checklist_incomplete_reasons / insert / A* `authed` | `.insert( toInsert.map((r) => ({ instance_id: instanceId, template_item_id: r.templateItemId, reason: r.reason, reported_by: actor.userId, })), ) .select("id, instance_id, template_item_id, reason, reported_by, reported_at");` |
| 1598 `confirmInstance` | checklist_submissions / insert / A* `authed` | `.insert({ instance_id: instanceId, submitted_by: actor.userId, completion_ids: [], is_final_confirmation: true, }) .select("id, instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation") .maybeSingle<SubmissionRow>();` |
| 1612 `confirmInstance` | checklist_instances / update / A* `authed` | `.update({ status: "open", confirmed_at: null, confirmed_by: null }, { count: "exact" }) .eq("id", instanceId) .eq("status", newStatus) .eq("confirmed_by", actor.userId);` |
| 1756 `loadPickerCandidates` | checklist_completions / select / S `sb` | `.select("completed_by") .eq("instance_id", args.instanceId) .is("revoked_at", null) .is("superseded_at", null);` |
| 1820 `loadLiveCompletionOrThrow` | checklist_completions / select / A* `authed` | `.select(COMPLETION_COLUMNS) .eq("id", completionId) .is("revoked_at", null) .is("superseded_at", null) .maybeSingle<CompletionRow>();` |
| 1884 `revokeCompletion` | checklist_completions / update / S `sb` | `.update({ revoked_at: nowIso, revoked_by: actor.userId, revocation_reason: "error_tap", }) .eq("id", completionId) .is("revoked_at", null) .is("superseded_at", null) .select(COMPLETION_COLUMNS);` |
| 1999 `revokeWithReason` | checklist_completions / update / S `sb` | `.update({ revoked_at: nowIso, revoked_by: actor.userId, revocation_reason: reason, revocation_note: reason === "other" ? note : null, }) .eq("id", completionId) .is("revoked_at", null) .is("superseded_at", null) .select(COMPLETION_COLUMNS);` |
| 2156 `markNotDoneByAuthority` | checklist_completions / update / S `sb` | `.update({ revoked_at: nowIso, revoked_by: actor.userId, revocation_reason: "not_actually_done", revocation_note: note, }) .eq("id", completionId) .is("revoked_at", null) .is("superseded_at", null) .select(COMPLETION_COLUMNS);` |
| 2330 `tagActualCompleter` | checklist_completions / update / S `sb` | `.update({ actual_completer_id: actualCompleterId, actual_completer_tagged_at: nowIso, actual_completer_tagged_by: actor.userId, }) .eq("id", completionId) .is("revoked_at", null) .is("superseded_at", null) .select(COMPLETION_COLUMNS);` |
| 2515 `loadChecklistChainAttribution` | checklist_submissions / select / S `service` | `.select( ' id, submitted_by, submitted_at, edit_count, original_submission_id, submitter:users!checklist_submissions_submitted_by_fkey(name) ', ) .or( 'id.eq.${args.originalSubmissionId},original_submission_id.eq.${args.originalSubmissionId}', ) .order("edit_count", { ascending: true });` |
| 2677 `evaluateGatePredicate` | checklist_instances / select / S `service` | `.select("status") .eq("template_id", tmpl.id) .eq("location_id", locationId) .eq("date", targetDate) .maybeSingle<{ status: ChecklistStatus }>();` |
| 2782 `dropInstance` | checklist_instances / update / S `service` | `.update({ assigned_to: null, dropped_at: droppedAt, dropped_by: actor.userId, dropped_reason: reason, }) .eq("id", instanceId) // Concurrency guard: only update if still assigned to this actor and // not concurrently locked. Mirrors the supersede pattern's optimistic // check. .eq("assigned_to", actor.userId) .eq("assignment_locked", false) .select(INSTANCE_COLUMNS) .maybeSingle<InstanceRow>();` |
| 2870 `releaseClosingByOpener` | checklist_instances / select / S `service` | `.select('${INSTANCE_COLUMNS}, template:checklist_templates!inner(type)') .eq("id", instanceId) .maybeSingle<InstanceRow & { template: { type: ChecklistType } \| { type: ChecklistType }[] }>();` |
| 2892 `releaseClosingByOpener` | checklist_instances / update / S `service` | `.update({ status: "auto_finalized" as ChecklistStatus, finalized_at_actor_type: "opener_release" as FinalizedAtActorType, }) .eq("id", instanceId) .eq("status", "open") .select(INSTANCE_COLUMNS) .maybeSingle<InstanceRow>();` |

### lib/maintenance.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 123 `loadFridgeReadings` | checklist_instances / select / S `service` | `.select("id") .eq("location_id",reportContext.locationId).eq("date",reportContext.date).order("id").range(from,to));` |
| 128 `loadFridgeReadings` | checklist_completions / select / S `service` | `.select("template_item_id,count_value,completed_at,notes") .in("instance_id",instances.slice(i,i+50).map(r=>r.id)).in("template_item_id",itemIds) .match(ownUserId ? {completed_by:ownUserId} : {}).is("superseded_at",null).is("revoked_at",null).order("id").range(from,to));` |
| 138 `loadFridgeReadings` | checklist_completions / select / S `service` | `.select("template_item_id, instance_id, count_value, completed_at, notes") .match(ownUserId ? { completed_by: ownUserId } : {}) .in("template_item_id", itemIds) .is("superseded_at", null) .is("revoked_at", null);` |
| 157 `loadFridgeReadings` | checklist_instances / select / S `service` | `.select("id, date") .in("id", instanceIds);` |
| 407 `loadEquipmentDetail` | checklist_completions / select / S `service` | `.select("notes, completed_at") .in("template_item_id", itemIds) .is("superseded_at", null) .is("revoked_at", null) .not("notes", "is", null) .gte("completed_at", operationalDayUtcRange(args.sinceDate).startIso);` |
| 496 `listMaintenanceReportDates` | checklist_instances / select / S `service` | `.select("id, date").eq("location_id", locationId).gte("date",dateFrom).lte("date",dateTo).order("id").range(from,to));` |
| 508 `listMaintenanceReportDates` | checklist_completions / select / S `service` | `.select(skeletonOnly ? "template_item_id, instance_id" : "template_item_id, instance_id, count_value") .in("instance_id", boundedInstances.slice(i, i + 50).map(instance => instance.id)) .match(ownUserId ? { completed_by: ownUserId } : {}) .in("template_item_id", itemIds) .is("superseded_at", null).is("revoked_at", null) .not("count_value", "is", null) .order("instance_id", { ascending: true }).order("id", { ascending: true }).range(from, to) .returns<Array<{template_item_id:string;` |

### lib/midshift.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 106 `loadInstanceStatus` | checklist_instances / select / S `service` | `.select("id, status, confirmed_at, confirmed_by") .in("template_id", tmplIds) .eq("location_id", args.locationId) .eq("date", args.date) // Newest wins if a duplicate day-instance ever exists (designed-against but // maybeSingle would THROW on 2 rows — degrade deterministically instead). .order("created_at", { ascending: false }) .limit(1) .maybeSingle<{ id: string;` |
| 225 `loadActiveToday` | checklist_instances / select / S `service` | `.select("id, template_id, confirmed_by") .eq("location_id", args.locationId) .eq("date", args.date) .returns<Array<{ id: string;` |
| 251 `loadActiveToday` | checklist_completions / select / S `service` | `.select("completed_by, instance_id") .in("instance_id", instanceIds) .is("superseded_at", null) .is("revoked_at", null) .returns<Array<{ completed_by: string \| null;` |

### lib/opening.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 748 `canAccessOpeningInstance` | checklist_instances / select / S `service` | `.select("location_id, date").eq("id", args.instanceId) .maybeSingle<{ location_id: string;` |
| 762 `auditOpeningOverride` | checklist_instances / select / S `service` | `.select("location_id, date").eq("id", args.instanceId) .maybeSingle<{ location_id: string;` |
| 937 `loadOpeningState` | checklist_instances / select / S `service` | `.select(INSTANCE_COLUMNS) .eq("id", rpcResult.instance_id) .maybeSingle<InstanceRow>();` |
| 993 `loadOpeningState` | checklist_completions / select / S `service` | `.select(COMPLETION_COLUMNS) .eq("instance_id", instanceRow.id) .is("superseded_at", null) .is("revoked_at", null);` |
| 1229 `materializeCloserCountSnapshots` | checklist_instances / select / S `service` | `.select("id") .eq("template_id", amPrepTmpl.id) .eq("location_id", args.locationId) .eq("date", args.priorOperationalDate) .maybeSingle<{ id: string }>();` |
| 1251 `materializeCloserCountSnapshots` | checklist_completions / select / S `service` | `.select("id, template_item_id, instance_id, edit_count, completed_at, prep_data") .eq("instance_id", amPrepInstance.id) .in("template_item_id", Array.from(amPrepIds)) .is("revoked_at", null);` |
| 1847 `submitPhase1Atomic` | checklist_instances / select / S `service` | `.select("status") .eq("id", args.instanceId) .maybeSingle<{ status: ChecklistStatus }>();` |
| 2056 `readLivePhase2Completion` | checklist_completions / select / S `service` | `.select(COMPLETION_COLUMNS) .eq("instance_id", instanceId) .eq("template_item_id", templateItemId) .is("superseded_at", null) .is("revoked_at", null);` |
| 2185 `savePhase2Item` | checklist_instances / select / S `service` | `.select("status") .eq("id", args.instanceId) .maybeSingle<{ status: ChecklistStatus }>();` |
| 2426 `revokePhase2Completion` | checklist_instances / select / S `service` | `.select("status") .eq("id", args.instanceId) .maybeSingle<{ status: ChecklistStatus }>();` |
| 2456 `revokePhase2Completion` | checklist_completions / select / S `service` | `.select(COMPLETION_COLUMNS) .eq("id", args.completionId) .eq("instance_id", args.instanceId) .is("revoked_at", null) .is("superseded_at", null) .maybeSingle<CompletionRow>();` |
| 2619 `revokePhase2Completion` | checklist_completions / update / S `service` | `.update({ revoked_at: nowIso, revoked_by: args.actor.userId, revocation_reason: revocationReason, revocation_note: revocationNote, }) .eq("id", args.completionId) .eq("instance_id", args.instanceId) .is("revoked_at", null) .is("superseded_at", null) .select(COMPLETION_COLUMNS);` |
| 2793 `submitPhase2Atomic` | checklist_instances / select / S `service` | `.select("status") .eq("id", args.instanceId) .maybeSingle<{ status: ChecklistStatus }>();` |

### lib/people/facts.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 49 `loadPeopleFacts` | checklist_instances / select / S `service` | `.select("id, confirmed_by, confirmed_at") .eq("location_id", locationId) .order("id", { ascending: true }).range(from, to), ) : await selectAllRows<InstanceFact>( (from, to) => service .from("checklist_instances").select("id").eq("location_id", locationId) .order("id", { ascending: true }).range(from, to), );` |
| 55 `loadPeopleFacts` | checklist_instances / select / S `service` | `.select("id").eq("location_id", locationId) .order("id", { ascending: true }).range(from, to), );` |
| 69 `loadPeopleFacts` | checklist_completions / select / S `service` | `.select("instance_id, template_item_id, completed_by, completed_at, notes") .in("instance_id", chunk) .gte("completed_at", start).lt("completed_at", end) .is("superseded_at", null).is("revoked_at", null) .order("completed_at", { ascending: true }).order("id", { ascending: true }).range(from, to), ) : await selectAllRows<CompletionFact>( (from, to) => service .from("checklist_completions").select("instance_id, template_item_id, completed_at, notes") .eq("completed_by", person).in("instance_id", chunk) .gte("completed_at", start).lt("completed_at", end) .is("superseded_at", null).is("revoked_at", null) .order("completed_at", { ascending: true }).order("id", { ascending: true }).range(from, to), );` |
| 78 `loadPeopleFacts` | checklist_completions / select / S `service` | `.select("instance_id, template_item_id, completed_at, notes") .eq("completed_by", person).in("instance_id", chunk) .gte("completed_at", start).lt("completed_at", end) .is("superseded_at", null).is("revoked_at", null) .order("completed_at", { ascending: true }).order("id", { ascending: true }).range(from, to), );` |
| 94 `loadPeopleFacts` | checklist_instances / select / S `service` | `.select("date, confirmed_at") .eq("location_id", locationId).eq("confirmed_by", person).not("confirmed_at", "is", null) .gte("confirmed_at", start).lt("confirmed_at", end) .order("id", { ascending: true }).range(from, to), );` |
| 378 `loadSkillFamilies` | checklist_instances / select / S `service` | `.select("id, date, template_id, shift_start_at, triggered_at") .eq("location_id", locationId).in("template_id", ids).is("dropped_at", null) .gte("date", window.dates.from).lte("date", window.dates.to) .order("id", { ascending: true }).range(from, to)));` |
| 389 `loadSkillFamilies` | checklist_completions / select / S `service` | `.select("id, instance_id, template_item_id, completed_by, completed_at") .in("instance_id", ids).is("superseded_at", null).is("revoked_at", null) .order("id", { ascending: true }).range(from, to)));` |
| 409 `loadSkillFamilies` | checklist_instances / select / S `service` | `.select("id, status, confirmed_at").in("id", part) .order("id", { ascending: true }).range(from, to)));` |
| 412 `loadSkillFamilies` | checklist_submissions / select / S `service` | `.select("instance_id").in("instance_id", part).eq("is_final_confirmation", true) .order("instance_id", { ascending: true }).range(from, to))) finals.add(r.instance_id);` |
| 489 `loadProfileFacts` | checklist_completions / select / S `service` | `.select("completed_at") .eq("completed_by", targetUserId).is("superseded_at", null).is("revoked_at", null) .order("completed_at", { ascending: true }).range(from, to), );` |

### lib/pm-report.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 86 `loadShiftWrapUp` | checklist_instances / select / S `service` | `.select("id, confirmed_by") .eq("location_id", args.locationId) .eq("date", args.date);` |
| 103 `loadShiftWrapUp` | checklist_completions / select / S `service` | `.select("completed_by, instance_id, template_item_id") .in("instance_id", instIdList) .is("superseded_at", null) .is("revoked_at", null);` |

### lib/prep.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 541 `loadChainHeadItemIds` | checklist_submissions / select / S `service` | `.select("id, completion_ids") .eq("instance_id", instanceId) .is("original_submission_id", null) .maybeSingle<{ id: string;` |
| 551 `loadChainHeadItemIds` | checklist_completions / select / S `service` | `.select("template_item_id") .in("id", ids);` |
| 565 `loadLiveCompletions` | checklist_completions / select / S `service` | `.select(COMPLETION_COLUMNS) .eq("instance_id", instanceId) .is("superseded_at", null) .is("revoked_at", null);` |
| 828 `loadAmPrepState` | checklist_instances / select / S `service` | `.select(INSTANCE_COLUMNS) .eq("template_id", tmplRow.id) .eq("location_id", args.locationId) .eq("date", args.date) .maybeSingle<InstanceRow>();` |
| 841 `loadAmPrepState` | checklist_instances / insert / S `service` | `.insert({ template_id: tmplRow.id, location_id: args.locationId, date: args.date, shift_start_at: triggerTimestamp, status: "open", triggered_by_user_id: args.actor.userId, triggered_at: triggerTimestamp, }) .select(INSTANCE_COLUMNS) .maybeSingle<InstanceRow>();` |
| 858 `loadAmPrepState` | checklist_instances / select / S `service` | `.select(INSTANCE_COLUMNS) .eq("template_id", tmplRow.id) .eq("location_id", args.locationId) .eq("date", args.date) .maybeSingle<InstanceRow>();` |
| 938 `loadAmPrepState` | checklist_completions / select / S `service` | `.select(COMPLETION_COLUMNS) .eq("instance_id", instanceRow.id) .is("superseded_at", null) .is("revoked_at", null);` |
| 1047 `loadMidDayPrepState` | checklist_instances / select / S `service` | `.select(INSTANCE_COLUMNS) .eq("id", args.instanceId) .maybeSingle<InstanceRow>();` |
| 1103 `loadMidDayPrepState` | checklist_completions / select / S `service` | `.select(COMPLETION_COLUMNS) .eq("instance_id", instanceRow.id) .is("superseded_at", null) .is("revoked_at", null);` |
| 1228 `requirePrepInstanceTaskAccess` | checklist_instances / select / S `service` | `.select("location_id, date").eq("id", args.instanceId) .maybeSingle<{ location_id: string;` |
| 1245 `auditPrepOverride` | checklist_instances / select / S `service` | `.select("location_id, date").eq("id", args.instanceId) .maybeSingle<{ location_id: string;` |
| 1266 `createMidDayPrepInstance` | checklist_instances / select / S `service` | `.select("id", { count: "exact", head: true }) .eq("template_id", args.templateId) .eq("location_id", args.locationId) .eq("date", args.date);` |
| 1278 `createMidDayPrepInstance` | checklist_instances / insert / S `service` | `.insert({ template_id: args.templateId, location_id: args.locationId, date: args.date, shift_start_at: triggerTimestamp, status: "open", triggered_by_user_id: args.actor.userId, triggered_at: triggerTimestamp, allows_multiple_per_day: true, }) .select("id") .maybeSingle<{ id: string }>();` |
| 1382 `loadMidDayPrepDashboardState` | checklist_instances / select / S `service` | `.select("id, status, triggered_at, confirmed_at, confirmed_by") .eq("template_id", template.id) .eq("location_id", args.locationId) .eq("date", args.date) .order("triggered_at", { ascending: true });` |
| 1805 `finalizeMidDayPhase2` | checklist_instances / update / S `service` | `.update({ status: "phase2_complete", confirmed_at: nowIso, confirmed_by: args.actor.userId }) .eq("id", args.instanceId) .eq("status", "phase1_complete") .select(INSTANCE_COLUMNS) .maybeSingle<InstanceRow>();` |
| 1814 `finalizeMidDayPhase2` | checklist_instances / select / S `service` | `.select("id") .eq("id", args.instanceId) .maybeSingle<{ id: string }>();` |
| 1883 `autoCompleteClosingMidDayRef` | checklist_instances / select / S `service` | `.select("id") .eq("template_id", cTmpl.id) .eq("location_id", args.locationId) .eq("date", args.date) .maybeSingle<{ id: string }>();` |
| 1895 `autoCompleteClosingMidDayRef` | checklist_instances / select / S `service` | `.select("id, triggered_at, confirmed_at") .eq("template_id", mTmpl.id) .eq("location_id", args.locationId) .eq("date", args.date) .eq("status", "phase2_complete") .order("triggered_at", { ascending: true });` |
| 1973 `replaceLiveClosingRefCompletion` | checklist_completions / update / S `service` | `.update({ superseded_at: nowIso }, { count: "exact" }) .eq("id", args.headId) .eq("instance_id", key.instance_id) .eq("template_item_id", key.template_item_id) .is("superseded_at", null) .is("revoked_at", null);` |
| 1988 `replaceLiveClosingRefCompletion` | checklist_completions / update / S `service` | `.update({ superseded_at: null }) .eq("instance_id", key.instance_id) .eq("template_item_id", key.template_item_id) .eq("superseded_at", nowIso) .is("superseded_by", null);` |
| 1998 `replaceLiveClosingRefCompletion` | checklist_completions / insert / S `service` | `.insert({ ...key, completed_by: args.actor.userId, completed_at: nowIso, auto_complete_meta: args.meta, }) .select("id") .maybeSingle<{ id: string }>();` |
| 2020 `replaceLiveClosingRefCompletion` | checklist_completions / update / S `service` | `.update({ superseded_by: inserted.id }) .eq("instance_id", key.instance_id) .eq("template_item_id", key.template_item_id) .eq("superseded_at", nowIso) .is("superseded_by", null) .neq("id", inserted.id);` |
| 2153 `ensureClosingRefCompletion` | checklist_completions / select / S `service` | `.select("id, revoked_at, auto_complete_meta") .eq("instance_id", args.closingInstanceId) .eq("template_item_id", args.refItemId) .is("superseded_at", null) .maybeSingle<{ id: string;` |
| 2260 `reconcileClosingReportRefs` | checklist_instances / select / S `service` | `.select("id, confirmed_at") .eq("template_id", oTmpl.id) .eq("location_id", args.locationId) .eq("date", args.date) .in("status", ["phase2_complete", "confirmed"]) .order("confirmed_at", { ascending: false, nullsFirst: false }) .limit(1) .maybeSingle<{ id: string;` |
| 2306 `reconcileClosingReportRefs` | checklist_instances / select / S `service` | `.select("id, confirmed_at") .eq("template_id", amTmpl.id) .eq("location_id", args.locationId) .eq("date", args.date) .eq("status", "confirmed") .order("confirmed_at", { ascending: false, nullsFirst: false }) .limit(1) .maybeSingle<{ id: string;` |
| 2343 `reconcileClosingReportRefs` | checklist_instances / select / S `service` | `.select("id, triggered_at, confirmed_at") .eq("template_id", mTmpl.id) .eq("location_id", args.locationId) .eq("date", args.date) .eq("status", "phase2_complete") .order("triggered_at", { ascending: true });` |
| 2533 `reconcileRefTrackItems` | checklist_instances / select / S `service` | `.select("id") .eq("template_id", effRefTmpl.id) .eq("location_id", refTmpl.location_id) .eq("date", args.date) .order("triggered_at", { ascending: false, nullsFirst: false }) .limit(1) .maybeSingle<{ id: string }>();` |
| 2560 `reconcileRefTrackItems` | checklist_completions / select / S `service` | `.select("id, completed_at") .eq("instance_id", refInst.id) .eq("template_item_id", effRefItemId) .is("superseded_at", null) .is("revoked_at", null) .limit(1) .maybeSingle<{ id: string;` |
| 2702 `loadAmPrepDashboardState` | checklist_instances / select / S `service` | `.select("id, status, confirmed_at, confirmed_by") .eq("template_id", tmplRow.id) .eq("location_id", args.locationId) .eq("date", args.date) .maybeSingle<{ id: string;` |
| 2792 `loadAmPrepDashboardState` | checklist_submissions / select / S `service` | `.select("id") .eq("instance_id", todayInstance.id) .is("original_submission_id", null) .maybeSingle<{ id: string }>();` |
| 2807 `loadAmPrepDashboardState` | checklist_submissions / select / S `service` | `.select("edit_count") .or( 'id.eq.${originalSubmissionId},original_submission_id.eq.${originalSubmissionId}', );` |
| 2843 `loadAmPrepDashboardState` | checklist_instances / select / S `service` | `.select("status") .in("template_id", closingTemplateIds) .eq("date", args.date) .order("created_at", { ascending: false }) .limit(1) .maybeSingle<{ status: ChecklistInstance["status"] }>();` |
| 2960 `computeChangedFields` | checklist_submissions / select / S `service` | `.select("id, edit_count, completion_ids") .or('id.eq.${originalSubmissionId},original_submission_id.eq.${originalSubmissionId}') .order("edit_count", { ascending: true });` |
| 2977 `computeChangedFields` | checklist_completions / select / S `service` | `.select("id, template_item_id, prep_data, edit_count") .in("id", allCompletionIds);` |
| 3118 `submitAmPrep` | checklist_instances / select / S `service` | `.select("id, template_id, location_id, date, status") .eq("id", args.instanceId) .maybeSingle<{ id: string;` |
| 3334 `submitAmPrepUpdate` | checklist_submissions / select / S `service` | `.select("id, submitted_by, submitted_at, instance_id, original_submission_id, completion_ids") .eq("id", args.originalSubmissionId) .maybeSingle<{ id: string;` |
| 3366 `submitAmPrepUpdate` | checklist_submissions / select / S `service` | `.select("edit_count") .or( 'id.eq.${args.originalSubmissionId},original_submission_id.eq.${args.originalSubmissionId}', );` |
| 3381 `submitAmPrepUpdate` | checklist_instances / select / S `service` | `.select("id, template_id, location_id, date, status") .eq("id", args.instanceId) .maybeSingle<{ id: string;` |
| 3414 `submitAmPrepUpdate` | checklist_instances / select / S `service` | `.select("status") .in("template_id", closingTemplateIds) .eq("date", instRow.date) .order("created_at", { ascending: false }) .limit(1) .maybeSingle<{ status: ChecklistInstance["status"] }>();` |
| 3472 `submitAmPrepUpdate` | checklist_completions / select / S `service` | `.select("template_item_id, prep_data") .in("id", chainHeadRow.completion_ids);` |

### lib/pulse/fridges.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 58 `loadFridgesToday` | checklist_instances / select / S `service` | `.select("id").eq("location_id", locationId).eq("date", date).order("id").range(from, to), signal, ));` |
| 64 `loadFridgesToday` | checklist_completions / select / S `service` | `.select("template_item_id, count_value, completed_at") .in("instance_id", instances.map((i) => i.id)).in("template_item_id", itemIds) .is("superseded_at", null).is("revoked_at", null).order("id").range(from, to).returns<CompRow[]>(), signal, ), 500);` |

### lib/report-digests.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 141 `loadFinalizedClosings` | checklist_instances / select / S `sb` | `.select("location_id, date").in("template_id", ids).in("date", days) .in("status", FINALIZED_CLOSING).order("id").range(from, to));` |

### lib/report-related.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 31 `loadReportRelations` | checklist_instances / select / S `service` | `.select("date") .eq("id", id).eq("location_id", args.locationId).maybeSingle<{ date: string }>();` |

### lib/reports-hub.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 130 `latestFinalizedClosingDate` | checklist_instances / select / S `service` | `.select("date") .eq("location_id", args.locationId) .in("template_id", templateIds) .in("status", [...FINALIZED_REPORT_STATUSES]) .lte("date", args.onOrBefore) .gte("date", etYmdMinusDays(args.onOrBefore, LAST_CLOSE_MAX_LOOKBACK_DAYS - 1)) .order("date", { ascending: false }) .limit(1);` |
| 163 `listReportSkeleton` | checklist_instances / select / S `service` | `.select("id, location_id, date, status, confirmed_by, confirmed_at, template_id") .eq("location_id", f.locationId) .gte("date", f.dateFrom) .lte("date", f.dateTo) .order("id", { ascending: true }) .range(from, to), );` |
| 187 `listReportSkeleton` | checklist_completions / select / S `service` | `.select("instance_id") .in("instance_id", rows.slice(i, i + 50).map(r => r.id)).eq("completed_by", f.viewer.userId) .is("superseded_at", null).is("revoked_at", null).order("id").range(from, to));` |
| 410 `loadChecklistDetail` | checklist_instances / select / S `service` | `.select("id, template_id, date, status, location_id") .eq("id", args.instanceId) .maybeSingle<{ id: string;` |
| 461 `loadChecklistDetail` | checklist_completions / select / S `service` | `.select("template_item_id, completed_by, count_value, notes, photo_id, auto_complete_meta") .eq("instance_id", args.instanceId) .match(args.viewer.level < 4 ? { completed_by: args.viewer.userId } : {}) .is("superseded_at", null) .is("revoked_at", null) .order("id", { ascending: true }) .range(from, to), );` |
| 485 `loadChecklistDetail` | checklist_incomplete_reasons / select / S `service` | `.select("template_item_id, reason, reported_by, reported_at") .eq("instance_id", args.instanceId) .order("reported_at", { ascending: true }) .range(from, to), );` |
| 732 `loadOpeningDetail` | checklist_instances / select / S `service` | `.select("id, template_id, date, status, location_id, opener_no_prior_data_reason") .eq("id", args.instanceId) .maybeSingle<{ id: string;` |
| 792 `loadOpeningDetail` | checklist_completions / select / S `service` | `.select("template_item_id, completed_by, count_value, notes, prep_data, photo_id") .eq("instance_id", args.instanceId) .match(args.viewer.level < 4 ? { completed_by: args.viewer.userId } : {}) .is("superseded_at", null) .is("revoked_at", null) .order("id", { ascending: true }) .range(from, to), );` |
| 1347 `countHotTempReadings` | checklist_instances / select / S `service` | `.select("id") .eq("location_id", f.locationId).gte("date", range.from).lte("date", range.to).order("id").range(from, to));` |
| 1352 `countHotTempReadings` | checklist_completions / select / S `service` | `.select("template_item_id, count_value") .in("instance_id", instances.slice(i, i + 50).map((r) => r.id)).in("template_item_id", [...registry.keys()]) .match(f.viewer.level < 4 ? { completed_by: f.viewer.userId } : {}) .is("superseded_at", null).is("revoked_at", null).order("id").range(from, to));` |
| 1413 `computeReportSignals` | checklist_instances / select / S `service` | `.select("template_id") .eq("id", args.id) .maybeSingle<{ template_id: string }>();` |
| 1439 `computeReportSignals` | checklist_completions / select / S `service` | `.select("template_item_id, count_value, prep_data") .eq("instance_id", args.id) .match(args.viewer && args.viewer.level < 4 ? { completed_by: args.viewer.userId } : {}) .is("superseded_at", null) .is("revoked_at", null) .order("id", { ascending: true }) .range(from, to), );` |
| 1569 `computeReportSignalsBatch` | checklist_instances / select / S `service` | `.select("id, template_id") .in("id", instanceIds).returns<Array<{ id: string;` |
| 1583 `computeReportSignalsBatch` | checklist_completions / select / S `service` | `.select("instance_id, template_item_id, count_value, prep_data") .in("instance_id", instanceIds).match(viewer && viewer.level < 4 ? { completed_by: viewer.userId } : {}).is("superseded_at", null).is("revoked_at", null) .order("id", { ascending: true }).range(from, to), );` |

### lib/reports-search.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 123 `buildSearchCorpus` | checklist_instances / select / S `service` | `.select("id, template_id") .eq("location_id", args.locationId).in("id", instanceIds) .order("id", { ascending: true }).range(from, to), );` |
| 168 `buildSearchCorpus` | checklist_completions / select / S `service` | `.select("instance_id, completed_by, notes, template_item_id, prep_data") .in("instance_id", authorizedInstanceIds).match(!isManager ? {completed_by: args.viewer.userId} : {}).is("superseded_at", null).is("revoked_at", null) .order("instance_id", { ascending: true }).order("id", { ascending: true }).range(from, to), ) : [];` |

### lib/reports-trends.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 233 `loadTrendWindow` | checklist_instances / select / S `service` | `.select("id, location_id, date, template_id, status") .eq("location_id", args.locationId) .gte("date", loadFrom) .lte("date", loadTo) .order("id", { ascending: true }) .range(from, to), );` |
| 296 `loadTrendWindow` | checklist_completions / select / S `service` | `.select("instance_id, template_item_id, count_value, prep_data") .in("instance_id", instIds) .is("superseded_at", null) .is("revoked_at", null) .order("id", { ascending: true }) .range(from, to), );` |

### lib/written-reports.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 176 `listWrittenReports` | written_reports / select / S `service` | `.select(ROW_COLS) .not("submitted_at", "is", null) .order("submitted_at", { ascending: false }) .order("id", { ascending: true }) .limit(pageSize + 1);` |
| 268 `loadWrittenReport` | written_reports / select / S `service` | `.select(ROW_COLS) .eq("id", args.id) .maybeSingle<WrittenReportRow>();` |
| 332 `createWrittenReport` | written_reports / insert / A `authed` | `.insert({ location_id: args.locationId, submitted_by: args.authorId, submitted_by_role: args.authorRole, title: args.draft.title, body: args.draft.body, category: args.draft.category, visibility_min_level: args.draft.visibilityMinLevel, }) .select("id") .single<{ id: string }>();` |
| 369 `updateWrittenReport` | written_reports / select / A `authed` | `.select("edit_count") .eq("id", args.id) .maybeSingle<{ edit_count: number \| null }>();` |
| 376 `updateWrittenReport` | written_reports / update / A `authed` | `.update({ title: args.draft.title, body: args.draft.body, category: args.draft.category, visibility_min_level: args.draft.visibilityMinLevel, last_edited_at: new Date().toISOString(), edit_count: nextCount, }) .eq("id", args.id) .select("id");` |

### app/(authed)/cash/page.tsx

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 89 `CashPage` | checklist_instances / select / S `sb` | `.select("status") .eq("template_id", cTmpl.id) .eq("location_id", locationParam) .eq("date", today) .maybeSingle<{ status: string }>();` |

### app/(authed)/dashboard/page.tsx

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 182 `loadOperationalState` | checklist_instances / select / S `sb` | `.select("id, date, status") .eq("template_id", tmpl.id) .eq("location_id", locationId) .in("date", [today, yesterday]);` |
| 216 `loadOperationalState` | checklist_completions / select / S `sb` | `.select("template_item_id") .eq("instance_id", todayInstance.id) .is("superseded_at", null) .is("revoked_at", null);` |
| 495 `DashboardPage` | checklist_instances / select / S `sb` | `.select("status, confirmed_at, confirmed_by") .eq("template_id", oTmpl.id) .eq("location_id", selectedLocation.id) .eq("date", dashboardDate) .maybeSingle<{ status: string;` |

### app/(authed)/operations/am-prep/page.tsx

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 257 `loadChainStateForPage` | checklist_submissions / select / S `args.sb` | `.select("id") .eq("instance_id", args.instance.id) .is("original_submission_id", null) .maybeSingle<{ id: string }>();` |
| 300 `loadChainStateForPage` | checklist_instances / select / S `args.sb` | `.select("status") .in("template_id", closingTemplateIds) .eq("date", args.date) .order("created_at", { ascending: false }) .limit(1) .maybeSingle<{ status: ChecklistInstance["status"] }>();` |

### app/(authed)/operations/closing/page.tsx

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 241 `ClosingPage` | checklist_instances / select / S `sb` | `.select(INSTANCE_COLUMNS) .eq("template_id", templateRow.id) .eq("location_id", locationParam) .eq("date", targetDate) .maybeSingle<InstanceRow>();` |
| 323 `ClosingPage` | checklist_completions / select / S `sb` | `.select(COMPLETION_COLUMNS) .eq("instance_id", instanceRow.id) .is("superseded_at", null) .is("revoked_at", null);` |
| 391 `ClosingPage` | checklist_submissions / select / S `sb` | `.select("id, instance_id, submitted_by") .in("instance_id", prepInstanceIds) .is("original_submission_id", null);` |
| 493 `ClosingPage` | checklist_instances / select / S `sb` | `.select("id") .in("template_id", amTmplIds) .eq("location_id", locationParam) .eq("date", targetDate) .returns<Array<{ id: string }>>();` |
| 505 `ClosingPage` | checklist_completions / select / S `sb` | `.select("id", { count: "exact", head: true }) .in("instance_id", amInstanceIds) .is("superseded_at", null) .is("revoked_at", null);` |
| 524 `ClosingPage` | checklist_incomplete_reasons / select / S `sb` | `.select("template_item_id, reason, reported_by, reported_at") .eq("instance_id", instanceRow.id) .order("reported_at", { ascending: true }) .returns<Array<{ template_item_id: string;` |

### app/(authed)/operations/opening/page.tsx

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 119 `loadPriorClosingState` | checklist_instances / select / S `sb` | `.select("status") .eq("template_id", tmpl.id) .eq("location_id", args.locationId) .eq("date", args.yesterdayDate) .maybeSingle<{ status: string }>();` |

### app/api/opening/phase1/draft/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 118 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, status") .eq("id", instanceId) .maybeSingle<{ id: string;` |

### app/api/opening/prep/item/revoke/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 117 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, status") .eq("id", instanceId) .maybeSingle<{ id: string;` |

### app/api/opening/prep/item/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 226 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, status") .eq("id", instanceId) .maybeSingle<{ id: string;` |

### app/api/opening/submit/phase1/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 341 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, date, status, template_id") .eq("id", body.instanceId) .maybeSingle<{ id: string;` |

### app/api/opening/submit/phase2/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 72 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, status") .eq("id", instanceId) .maybeSingle<{ id: string;` |

### app/api/prep/mid-day/phase1/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 72 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, date") .eq("id", body.instanceId) .maybeSingle<{ id: string;` |

### app/api/prep/mid-day/phase2/finalize/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 35 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, date") .eq("id", instanceId) .maybeSingle<{ id: string;` |

### app/api/prep/mid-day/phase2/item/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 110 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, date") .eq("id", body.instanceId) .maybeSingle<{ id: string;` |

### app/api/prep/submit/route.ts

| Line / function | Table / operation / client | Query filters and returned shape |
|---|---|---|
| 205 `POST` | checklist_instances / select / S `service` | `.select("id, location_id, date, status, template_id") .eq("id", body.instanceId) .maybeSingle<{ id: string;` |

Literal application query total: **161**. Relation embed: `lib/admin/week-card.ts:91` names `checklist_instances!checklist_completions_instance_id_fkey!inner(location_id)`; used at :152 with service client and authorized shop ids. This is the only extra target-table relation embed outside the direct query inventory.

## SQL/RPC dependency manifest

Each lineage is ordered by filename and is NOT an application receipt. Latest repository body is shown with its five-table statements; earlier bodies remain explicit provenance. This includes obsolete RPCs that may still exist as overloads, read helpers, and triggers, because an unused callable function can remain a PostgREST escape. Execution-role excerpts are repository evidence only. For overloads, compare the full signature in the linked source, not name alone.

Application RPC call sites (all supplied service clients):

| Call site | RPC | Caller checks |
|---|---|---|
| lib/opening.ts:912 | create_opening_instance_atomic | task access, selected shop/date/template; atomic creation/snapshot |
| lib/opening.ts:1757 | submit_phase1_atomic | opening task access, section/recount/schema validation; SQL phase and row checks |
| lib/opening.ts:2158 | save_phase2_item_atomic | task access, payload and production/batch eligibility; SQL status/item checks |
| lib/opening.ts:2582 | revoke_phase2_item_atomic | task access/live completion/instance eligibility, batch revocation |
| lib/opening.ts:2780 | submit_phase2_atomic | task access, completion/finalize validation; SQL phase check |
| lib/prep.ts:1495 | submit_mid_day_phase1_atomic | task access, instance/location route scope, phase-one entries |
| lib/prep.ts:1641 | save_mid_day_phase2_item_atomic | task access, instance/location route scope, phase-two payload |
| lib/prep.ts:3194,3532 | submit_am_prep_atomic | AM task access, input validation; edit branch validates original submission/chain |
| lib/checklists.ts:2966 | release_overdue_closings | server-selected user locations; SQL aging/closing/open criteria |
| lib/am-prep-draft.ts:231 | save_am_prep_draft | actor location/task checks and instance binding; SQL instance lock/read |
| lib/assignments.ts:443,452 | station_business_date, station_closures | service station workflow; shop scoped |
| lib/assignments.ts:143,254,276 | write_station_event, write_task_assignment | actor/location/station/task controls; indirectly uses station lifecycle helpers |
| lib/toast/labor.ts:142 | reconcile_station_lifecycle | trusted integration; indirectly uses station_closures |
| lib/whos-here-tick.ts:46,72 | reconcile_shop_closed | trusted tick; explicit location/day, reconciliation guards |

No written_reports RPC was found. `submit_opening_atomic` is legacy SQL with no current app call; verify it is absent or service-only in live preflight. `checklist_station_lifecycle` is trigger-invoked, not an application RPC. Do not drop these dependencies as part of ACL lockdown.

### `submit_am_prep_atomic`

Lineage: `supabase/migrations/0044_c46_audit_emission_column_fix.sql:27`, `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:123`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:149`: `v_chain_head_row checklist_submissions%ROWTYPE;`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:166`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:189`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:206`: `UPDATE checklist_instances`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:243`: `FROM checklist_instances ci`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:246`: `JOIN checklist_instances prep_ci`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:269`: `UPDATE checklist_completions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:277`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:301`: `UPDATE checklist_completions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:319`: `FROM checklist_submissions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:340`: `FROM checklist_submissions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:346`: `FROM checklist_submissions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:369`: `FROM checklist_completions cc`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:408`: `UPDATE checklist_completions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:416`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:445`: `UPDATE checklist_completions`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:452`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:498`: `'checklist_submissions',`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:522`: `FROM checklist_instances ci`

Execution ACL lineage:

- `supabase/migrations/0132_revoke_anon_execute_definer_rpcs.sql:19` `REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated;`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:546` `REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text ) FROM PUBLIC;`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:550` `REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text ) FROM anon;`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:554` `REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text ) FROM authenticated;`
- `supabase/migrations/0186_am_prep_chain_edit_supersede.sql:558` `GRANT EXECUTE ON FUNCTION public.submit_am_prep_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text ) TO service_role;`

### `release_overdue_closings`

Lineage: `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:55`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:68`: `FROM checklist_instances ci`
- `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:76`: `UPDATE checklist_instances`
- `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:90`: `'checklist_instances',`

Execution ACL lineage:

- `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:119` `REVOKE EXECUTE ON FUNCTION release_overdue_closings(uuid[]) FROM PUBLIC;`
- `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:120` `REVOKE EXECUTE ON FUNCTION release_overdue_closings(uuid[]) FROM anon;`
- `supabase/migrations/0046_state_finalize_columns_and_auto_release.sql:121` `GRANT EXECUTE ON FUNCTION release_overdue_closings(uuid[]) TO authenticated, service_role;`
- `supabase/migrations/0189_rls_perimeter_revokes_and_read_floors.sql:71` `revoke execute on function public.release_overdue_closings(uuid[]) from authenticated;`

### `submit_opening_atomic`

Lineage: `supabase/migrations/0048_create_submit_opening_atomic_rpc.sql:43`, `supabase/migrations/0050_opening_phase2_rpc_extension.sql:60`, `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:104`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:131`: `v_chain_head_row checklist_submissions%ROWTYPE;`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:184`: `FROM checklist_instances ci`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:238`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:403`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:456`: `'checklist_completions', v_completion_id, v_location_id, p_actor_id`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:518`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:527`: `UPDATE checklist_instances`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:546`: `FROM checklist_instances ci`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:549`: `JOIN checklist_instances opening_ci`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:558`: `FROM checklist_completions cc`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:565`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:587`: `UPDATE checklist_completions`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:593`: `FROM checklist_completions cc`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:594`: `JOIN checklist_instances ci ON ci.id = cc.instance_id`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:595`: `JOIN checklist_instances opening_ci`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:621`: `FROM checklist_submissions`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:642`: `FROM checklist_submissions`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:647`: `FROM checklist_submissions`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:666`: `FROM checklist_completions cc`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:682`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:822`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:849`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:864`: `p_actor_id, 'report.update', 'checklist_submissions', v_submission_id,`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:883`: `FROM checklist_instances ci`

Execution ACL lineage:

- `supabase/migrations/0048_create_submit_opening_atomic_rpc.sql:390` `REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) FROM PUBLIC;`
- `supabase/migrations/0048_create_submit_opening_atomic_rpc.sql:391` `REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) FROM anon;`
- `supabase/migrations/0048_create_submit_opening_atomic_rpc.sql:392` `GRANT EXECUTE ON FUNCTION public.submit_opening_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) TO authenticated, service_role;`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:911` `REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb ) FROM PUBLIC;`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:915` `REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb ) FROM anon;`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:919` `REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb ) FROM authenticated;`
- `supabase/migrations/0053_submit_opening_atomic_c50_rewrite.sql:923` `GRANT EXECUTE ON FUNCTION public.submit_opening_atomic( uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb ) TO service_role;`

### `create_opening_instance_atomic`

Lineage: `supabase/migrations/0052_create_opening_instance_atomic_rpc.sql:28`, `supabase/migrations/0063_fix_opening_instance_create_onconflict.sql:15`, `supabase/migrations/0215_batch_vs_bottle.sql:1417`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0215_batch_vs_bottle.sql:1438`: `INSERT INTO checklist_instances (`
- `supabase/migrations/0215_batch_vs_bottle.sql:1452`: `FROM checklist_instances`

Execution ACL lineage:

- `supabase/migrations/0052_create_opening_instance_atomic_rpc.sql:130` `REVOKE EXECUTE ON FUNCTION create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) FROM PUBLIC;`
- `supabase/migrations/0052_create_opening_instance_atomic_rpc.sql:133` `REVOKE EXECUTE ON FUNCTION create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) FROM anon;`
- `supabase/migrations/0052_create_opening_instance_atomic_rpc.sql:136` `REVOKE EXECUTE ON FUNCTION create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) FROM authenticated;`
- `supabase/migrations/0052_create_opening_instance_atomic_rpc.sql:139` `GRANT EXECUTE ON FUNCTION create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) TO service_role;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2703` `revoke execute on function public.create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2704` `grant execute on function public.create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) to service_role;`

### `submit_phase1_atomic`

Lineage: `supabase/migrations/0055_create_submit_phase1_atomic_rpc.sql:95`, `supabase/migrations/0185_phase1_chain_edit_supersede.sql:53`, `supabase/migrations/0215_batch_vs_bottle.sql:296`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0215_batch_vs_bottle.sql:366`: `v_chain_head_row checklist_submissions%ROWTYPE;`
- `supabase/migrations/0215_batch_vs_bottle.sql:395`: `FROM checklist_instances ci`
- `supabase/migrations/0215_batch_vs_bottle.sql:665`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:712`: `UPDATE checklist_instances`
- `supabase/migrations/0215_batch_vs_bottle.sql:766`: `'checklist_instances',`
- `supabase/migrations/0215_batch_vs_bottle.sql:857`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:874`: `UPDATE checklist_instances`
- `supabase/migrations/0215_batch_vs_bottle.sql:943`: `FROM checklist_submissions`
- `supabase/migrations/0215_batch_vs_bottle.sql:964`: `FROM checklist_submissions`
- `supabase/migrations/0215_batch_vs_bottle.sql:969`: `FROM checklist_submissions`
- `supabase/migrations/0215_batch_vs_bottle.sql:1007`: `FROM checklist_completions cc`
- `supabase/migrations/0215_batch_vs_bottle.sql:1167`: `UPDATE checklist_completions`
- `supabase/migrations/0215_batch_vs_bottle.sql:1182`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:1212`: `UPDATE checklist_completions`
- `supabase/migrations/0215_batch_vs_bottle.sql:1225`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:1248`: `'checklist_submissions',`
- `supabase/migrations/0215_batch_vs_bottle.sql:1270`: `FROM checklist_completions cc`
- `supabase/migrations/0215_batch_vs_bottle.sql:1289`: `FROM checklist_instances ci`

Execution ACL lineage:

- `supabase/migrations/0055_create_submit_phase1_atomic_rpc.sql:988` `REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) FROM PUBLIC;`
- `supabase/migrations/0055_create_submit_phase1_atomic_rpc.sql:992` `REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) FROM anon;`
- `supabase/migrations/0055_create_submit_phase1_atomic_rpc.sql:996` `REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) FROM authenticated;`
- `supabase/migrations/0055_create_submit_phase1_atomic_rpc.sql:1000` `GRANT EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) TO service_role;`
- `supabase/migrations/0185_phase1_chain_edit_supersede.sql:995` `REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) FROM PUBLIC;`
- `supabase/migrations/0185_phase1_chain_edit_supersede.sql:999` `REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) FROM anon;`
- `supabase/migrations/0185_phase1_chain_edit_supersede.sql:1003` `REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) FROM authenticated;`
- `supabase/migrations/0185_phase1_chain_edit_supersede.sql:1007` `GRANT EXECUTE ON FUNCTION public.submit_phase1_atomic( uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text ) TO service_role;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2699` `revoke execute on function public.submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2700` `grant execute on function public.submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text) to service_role;`

### `save_phase2_item_atomic`

Lineage: `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql:95`, `supabase/migrations/0215_batch_vs_bottle.sql:1509`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0215_batch_vs_bottle.sql:1578`: `SELECT status INTO v_status FROM checklist_instances WHERE id = p_opening_instance_id;`
- `supabase/migrations/0215_batch_vs_bottle.sql:1595`: `FROM checklist_completions cc`
- `supabase/migrations/0215_batch_vs_bottle.sql:1620`: `FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;`
- `supabase/migrations/0215_batch_vs_bottle.sql:1878`: `UPDATE checklist_completions`
- `supabase/migrations/0215_batch_vs_bottle.sql:1886`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:1899`: `FROM checklist_completions cc WHERE cc.id = v_completion_id;`

Execution ACL lineage:

- `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql:541` `REVOKE EXECUTE ON FUNCTION public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;`
- `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql:544` `GRANT EXECUTE ON FUNCTION public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text) TO service_role;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2705` `revoke execute on function public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2706` `grant execute on function public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb) to service_role;`

### `submit_phase2_atomic`

Lineage: `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql:280`, `supabase/migrations/0066_phase2_stamp_finalize_provenance.sql:13`, `supabase/migrations/0197_submit_phase2_universe_active_only.sql:27`, `supabase/migrations/0215_batch_vs_bottle.sql:2243`, `supabase/migrations/0255_under_par_alert_recipients.sql:35`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0255_under_par_alert_recipients.sql:89`: `FROM checklist_instances ci`
- `supabase/migrations/0255_under_par_alert_recipients.sql:114`: `SELECT 1 FROM checklist_completions cc`
- `supabase/migrations/0255_under_par_alert_recipients.sql:130`: `JOIN checklist_completions cc`
- `supabase/migrations/0255_under_par_alert_recipients.sql:152`: `FROM checklist_completions cc1`
- `supabase/migrations/0255_under_par_alert_recipients.sql:222`: `'checklist_completions', v_completion_id, v_location_id, p_actor_id`
- `supabase/migrations/0255_under_par_alert_recipients.sql:254`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0255_under_par_alert_recipients.sql:267`: `UPDATE checklist_instances`
- `supabase/migrations/0255_under_par_alert_recipients.sql:283`: `FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;`

Execution ACL lineage:

- `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql:542` `REVOKE EXECUTE ON FUNCTION public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;`
- `supabase/migrations/0056_create_submit_phase2_atomic_rpc.sql:545` `GRANT EXECUTE ON FUNCTION public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) TO service_role;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2709` `revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2710` `grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;`
- `supabase/migrations/0255_under_par_alert_recipients.sql:300` `revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;`
- `supabase/migrations/0255_under_par_alert_recipients.sql:301` `grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;`

### `submit_mid_day_phase1_atomic`

Lineage: `supabase/migrations/0060_create_submit_mid_day_phase1_atomic_rpc.sql:12`, `supabase/migrations/0215_batch_vs_bottle.sql:1324`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0215_batch_vs_bottle.sql:1375`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:1389`: `INSERT INTO checklist_submissions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:1395`: `UPDATE checklist_instances`
- `supabase/migrations/0215_batch_vs_bottle.sql:1404`: `SELECT to_jsonb(ci) INTO v_instance_row FROM checklist_instances ci WHERE ci.id = p_instance_id;`

Execution ACL lineage:

- `supabase/migrations/0132_revoke_anon_execute_definer_rpcs.sql:20` `REVOKE EXECUTE ON FUNCTION public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2701` `revoke execute on function public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2702` `grant execute on function public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) to service_role;`

### `save_mid_day_phase2_item_atomic`

Lineage: `supabase/migrations/0061_create_save_mid_day_phase2_item_rpc.sql:11`, `supabase/migrations/0062_mid_day_phase2_save_with_reason.sql:13`, `supabase/migrations/0064_mid_day_phase2_structural_over_under.sql:13`, `supabase/migrations/0199_mid_day_phase2_supersede_before_insert.sql:20`, `supabase/migrations/0215_batch_vs_bottle.sql:1932`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0215_batch_vs_bottle.sql:1982`: `PERFORM 1 FROM checklist_instances`
- `supabase/migrations/0215_batch_vs_bottle.sql:1991`: `FROM checklist_completions`
- `supabase/migrations/0215_batch_vs_bottle.sql:2003`: `FROM checklist_instances ci WHERE ci.id = p_instance_id;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2084`: `FROM checklist_completions cc WHERE cc.id = v_prior_id;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2184`: `UPDATE checklist_completions`
- `supabase/migrations/0215_batch_vs_bottle.sql:2191`: `INSERT INTO checklist_completions (`
- `supabase/migrations/0215_batch_vs_bottle.sql:2210`: `UPDATE checklist_completions`
- `supabase/migrations/0215_batch_vs_bottle.sql:2217`: `UPDATE checklist_completions`

Execution ACL lineage:

- `supabase/migrations/0132_revoke_anon_execute_definer_rpcs.sql:21` `REVOKE EXECUTE ON FUNCTION public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb) FROM PUBLIC, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2707` `revoke execute on function public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, jsonb) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2708` `grant execute on function public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, jsonb) to service_role;`

### `save_am_prep_draft`

Lineage: `supabase/migrations/0214_am_prep_drafts.sql:173`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0214_am_prep_drafts.sql:199`: `from public.checklist_instances`
- `supabase/migrations/0214_am_prep_drafts.sql:224`: `from public.checklist_instances where id = v_row.instance_id;`

Execution ACL lineage:

- `supabase/migrations/0214_am_prep_drafts.sql:257` `revoke all on function public.save_am_prep_draft(uuid, jsonb, uuid) from public, anon, authenticated;`
- `supabase/migrations/0214_am_prep_drafts.sql:259` `grant execute on function public.save_am_prep_draft(uuid, jsonb, uuid) to service_role;`

### `revoke_phase2_item_atomic`

Lineage: `supabase/migrations/0215_batch_vs_bottle.sql:2648`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0215_batch_vs_bottle.sql:2663`: `update checklist_completions cc`

Execution ACL lineage:

- `supabase/migrations/0215_batch_vs_bottle.sql:2695` `revoke execute on function public.revoke_phase2_item_atomic(uuid, uuid, uuid, text, text) from public, anon, authenticated;`
- `supabase/migrations/0215_batch_vs_bottle.sql:2696` `grant execute on function public.revoke_phase2_item_atomic(uuid, uuid, uuid, text, text) to service_role;`

### `station_business_date`

Lineage: `supabase/migrations/0217_assignments_stations.sql:103`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0217_assignments_stations.sql:105`: `select coalesce((select i.date from public.checklist_instances i`

Execution ACL lineage:

- `supabase/migrations/0217_assignments_stations.sql:189` `revoke all on function public.station_business_date(uuid) from public,anon,authenticated;`
- `supabase/migrations/0217_assignments_stations.sql:193` `grant execute on function public.station_business_date(uuid) to service_role;`

### `station_closures`

Lineage: `supabase/migrations/0230_station_lifecycle.sql:89`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0230_station_lifecycle.sql:93`: `select i.id,i.template_id from public.checklist_instances i`
- `supabase/migrations/0230_station_lifecycle.sql:101`: `left join public.checklist_completions c on c.instance_id=i.id and c.template_item_id=ti.id`

Execution ACL: no literal name-bound GRANT/REVOKE found; inspect dynamic ACL blocks listed below and live effective grants. Absence of a literal grant is not evidence of denial.

### `checklist_station_lifecycle`

Lineage: `supabase/migrations/0230_station_lifecycle.sql:219`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0230_station_lifecycle.sql:223`: `select i.location_id,i.date into v_location,v_day from public.checklist_instances i`

Execution ACL: no literal name-bound GRANT/REVOKE found; inspect dynamic ACL blocks listed below and live effective grants. Absence of a literal grant is not evidence of denial.

### `reconcile_shop_closed`

Lineage: `supabase/migrations/0233_whos_here.sql:341`.

Latest repository body: SECURITY DEFINER. Five-table statements/references:

- `supabase/migrations/0233_whos_here.sql:354`: `select i.id,i.status,i.confirmed_at into v_inst from public.checklist_instances i`
- `supabase/migrations/0233_whos_here.sql:364`: `and not exists(select 1 from public.checklist_submissions sub`

Execution ACL: no literal name-bound GRANT/REVOKE found; inspect dynamic ACL blocks listed below and live effective grants. Absence of a literal grant is not evidence of denial.

Dynamic ACL blocks: `supabase/migrations/0230_station_lifecycle.sql:378` enumerates lifecycle function signatures and :386/:387 revokes PUBLIC/anon/authenticated and grants service_role. `supabase/migrations/0233_whos_here.sql:409` does the same at :417/:418. `supabase/migrations/0217_assignments_stations.sql` also carries its function ACL block; inspect it for station_business_date. `supabase/migrations/0189_rls_perimeter_revokes_and_read_floors.sql:71` removes authenticated EXECUTE on release_overdue_closings. RLS identity/role/membership helpers intentionally remain callable by policies; they are not generic write RPCs.

Indirect dependencies: station lifecycle writes invoked by the checklist completion triggers (`0230_station_lifecycle.sql:239,241`) are part of the same database transaction; SQL grant changes must preserve the invoking service path. `opening_phase2_compute_delta` and `prep_batch_context` supply calculations/eligibility to writers, although they do not directly query the five tables. 0196's per-phase unique live-head index is required by completion supersession and must not be tightened to per-item.

## Operator, simulation and harness sites

These are not authenticated production writers. They are inventoried because service DELETE/reset and synthetic test grants must not be mistaken for application requirements. No listed script was executed for this inventory. In-memory harness operations are local fixtures, not external database writes. Existing scripts can read environment variables when run; reading their target-table lines does not authorize running them.

| Source | Target-table reference / operation | Client / checks |
|---|---|---|
| `scripts/aggie-submit-am-prep.py:30` | `inst = get(f"checklist_instances?select=id,status&template_id=eq.{am_tmpl_id}&business_date=eq.2026-06-14&status=eq.open&limit=1")` | operator-supplied client; historical script, not a request authority |
| `scripts/aggie-submit.py:34` | `inst = get(f"checklist_instances?select=id&template_id=eq.{tmpl_id}&business_date=eq.2026-06-14&status=eq.open&limit=1")` | operator-supplied client; historical script, not a request authority |
| `scripts/guide-test/reset-fn.sql:44` | `select coalesce(array_agg(id), '{}') into inst from public.checklist_instances where location_id = loc and date = d;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/guide-test/reset-fn.sql:52` | `delete from public.checklist_instances where id = any(inst);` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/guide-test/reset-fn.sql:54` | `update public.checklist_instances ci` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/guide-test/reset-sim-day.sql:47` | `select coalesce(array_agg(id), '{}') into inst from public.checklist_instances where location_id = loc and date = d;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/guide-test/reset-sim-day.sql:55` | `delete from public.checklist_instances where id = any(inst);` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/guide-test/reset-sim-day.sql:57` | `update public.checklist_instances ci` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/sim/concurrency/fullday.mjs:86` | `const { count: liveHeads } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/fullday.mjs:88` | `const { data: dupRows } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/fullday.mjs:105` | `const { count: live } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/fullday.mjs:120` | `const { data: doneRows } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/fullday.mjs:127` | `const { count: finals } = await db.from("checklist_submissions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/fullday.mjs:129` | `const { data: instRow } = await db.from("checklist_instances").select("status").eq("id", instanceId).maybeSingle();` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/fullday.mjs:145` | `const { data: forked } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/race2-quantify.mjs:35` | `const { count: live } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:55` | `const { count: instCount } = await db.from("checklist_instances")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:73` | `const { count: liveDupes } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:89` | `const { count: bothLanded } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:109` | `const { data: doneRows } = await db.from("checklist_completions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:119` | `const { count: finals } = await db.from("checklist_submissions")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:121` | `const { count: reasonRows } = await db.from("checklist_incomplete_reasons")` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/concurrency/races.mjs:123` | `const { data: instRow } = await db.from("checklist_instances").select("status").eq("id", instanceId).maybeSingle();` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/contracts/fixtures.spec.ts:34` | `const { data, error } = await driver.db.from("checklist_completions").select("id").eq("instance_id", instanceId);` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/contracts/fixtures.spec.ts:54` | `const { data, error } = await driver.db.from("checklist_instances").select("id").eq("id", dirtyId);` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/contracts/fixtures.spec.ts:56` | `const { data: children, error: childError } = await driver.db.from("checklist_completions").select("id").eq("instance_id", dirtyId);` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/contracts/opening.spec.ts:35` | `const instances = (await readRows<Instance>("checklist_instances", "id,template_id,status,opener_no_prior_data_reason", { location_id: SIM_LOCATIONS[code].id, date: driver.todayEt() })).filter(row => ids.has(row.template_id));` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/contracts/opening.spec.ts:44` | `return readRows<Completion>("checklist_completions", "id,template_item_id,completed_by,completed_at,count_value,notes,count_provenance,superseded_at,revoked_at,prep_data", { instance_id: instanceId });` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/contracts/opening.spec.ts:202` | `const submissions = await readRows<{ submitted_by: string; submitted_at: string; completion_ids: string[]; is_final_confirmation: boolean }>("checklist_submissions", "submitted_by,submitted_at,completion_ids,is_final_confirmation", { instance_id: instanceId });` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim/launch-readiness/journeys/opening.spec.ts:298` | `const submissions = await readRows<{ submitted_by: string; submitted_at: string; completion_ids: string[]; is_final_confirmation: boolean }>("checklist_submissions", "submitted_by,submitted_at,completion_ids,is_final_confirmation", { instance_id: instanceId });` | sim service reader/API driver; sim target/lease guard at runner |
| `scripts/sim-undo-0233.sql:25` | `drop trigger if exists checklist_shop_closed_release on public.checklist_instances;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/sql-harness-0272.mjs:8` | `const excluded = ["checklist_instances", "checklist_completions", "checklist_submissions", "checklist_incomplete_reasons", "written_reports"];` | local PGlite fixture; synthetic grants only |
| `scripts/sql-harness-0272.mjs:50` | `await db.exec("grant update (value) on public.written_reports to authenticated;");` | local PGlite fixture; synthetic grants only |
| `scripts/test-station-lifecycle.sql:61` | `update public.checklist_instances set shift_start_at=clock_timestamp()-interval '17 hours'` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-station-lifecycle.sql:78` | `insert into public.checklist_instances(template_id,location_id,date,shift_start_at,status,triggered_by_user_id,triggered_at)` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-station-lifecycle.sql:84` | `insert into public.checklist_completions(instance_id,template_item_id,completed_by)` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-station-lifecycle.sql:87` | `insert into public.checklist_completions(instance_id,template_item_id,completed_by)` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-station-lifecycle.sql:100` | `update public.checklist_completions set revoked_at=clock_timestamp(),revoked_by=crew where id=completion;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-step5-notifications.ts:85` | `relatedTable: "checklist_completions",` | operator-supplied client; historical script, not a request authority |
| `scripts/test-whos-here.sql:71` | `update public.checklist_instances set shift_start_at=clock_timestamp()-interval '17 hours'` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:188` | `assert not exists(select 1 from pg_trigger where tgrelid='public.checklist_instances'::regclass and not tgisinternal` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:189` | `and tgname like '%shop_closed%'),'no shop-closed trigger on checklist_instances (P1-4/P2-8)';` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:201` | `insert into public.checklist_instances(template_id,location_id,date,shift_start_at,status,triggered_by_user_id,triggered_at)` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:203` | `update public.checklist_instances set status='auto_finalized',finalized_at_actor_type='system_auto' where id=other_instance;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:207` | `insert into public.checklist_instances(template_id,location_id,date,shift_start_at,status,triggered_by_user_id,triggered_at)` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:213` | `update public.checklist_instances set status='confirmed',confirmed_at=clock_timestamp(),confirmed_by=hi where id=instance;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:216` | `update public.checklist_instances set status='open',confirmed_at=null,confirmed_by=null where id=instance;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:225` | `update public.checklist_instances set status='confirmed',confirmed_at=clock_timestamp()-interval '30 minutes',confirmed_by=hi where id=instance;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:229` | `update public.checklist_instances set status='open',confirmed_at=null,confirmed_by=null where id=instance;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |
| `scripts/test-whos-here.sql:231` | `update public.checklist_instances set status='auto_finalized',finalized_at_actor_type='system_auto' where id=instance;` | operator SQL; explicit fixture assertions/rollback or reset function (not run) |

Dynamic query helpers: `scripts/sim/launch-readiness` readRows calls use the named table arguments above; driver fixtures restore database snapshots and can mutate tables dynamically without table literals. They retain their existing isolated-sim target/lease constraints. 0272's `excluded` list deliberately includes all five tables and synthetic written_reports column UPDATE exercises that exemption; it is not an application writer. Test mocks under `tests/` exercise these sites but are not additional production clients.

## Verification and remaining deployment evidence

Inventory was built from source reads and `rg` across lib/app/scripts plus all repository migration function bodies; every literal application `.from` site is listed once, with embedded and dynamic call paths separately noted. Query tails are source excerpts, not newly authored SQL. Historical migrations are not rerun. Neither SELECT grants nor read policies change here.

Before application cutover: retain operation guards, session-derived attribution and exact rowcount checks; test caller read/write client separation. Before 0277: CC must compare deployed function overloads/effective ACLs to this source manifest, verify all old deployments drained, and run real PostgreSQL sim verification. The supplied live dump lacks those RPC grants/overload receipts, so that deployment assertion remains open. Chunk 1 does not authorize a DB write or an app writer cutover.

## Chunk-1 additions (not baseline callers)

`supabase/migrations/0276_checklist_guarded_writers.sql:13` defines checklist_actor_level (active user, plain membership, existing assignment_author_level role map). `:26` defines checklist_write_completion; `:88` checklist_submit_batch; `:114` checklist_confirm_instance. All are SECURITY INVOKER with pinned search_path. `:170` revokes all function privileges from PUBLIC/anon/authenticated; `:174` grants service_role EXECUTE; the closing assertion checks effective privileges and execution context. These are file-only definitions with NO app callers yet. Completion/batch/confirm each lock the parent row, require open, validate actor, and assert mutation cardinality; confirm writes reasons/final submission after its own claim in the same transaction.

Historical standalone data/structure changes also relevant to these writers: `0046_state_finalize_columns_and_auto_release.sql:145` backfills instance finalization; `0176_checklist_completion_single_live_head.sql:52` superseded duplicate completions (its per-item index was corrected later); `0196_checklist_completions_live_head_per_phase.sql:97` restores phase-one rows and :120 creates the per-phase live-head unique index. These are migration-owner operations, not callable app writes. 0054 adds provenance columns, 0057 extends revocation reasons, 0059 introduces the midday instance uniqueness discriminator, and 0217 adds the two closing-staff INSERT sibling policies. None is rerun by this work.

### Chunk-2 integration contract and proof limits

- `lib/checklist-write-actor.ts:19` resolves the actor from a verified AuthContext, rechecking matching live session, active user and unfiltered membership. SQL accepts that server-derived UUID; it does **not** verify a session token. Session parity therefore tests the composed actor gate plus SQL, with no actor for an invalid session. App token verification remains `requireSession`'s responsibility.
- `lib/checklist-write-guard-shared.ts` implements the policy floor separately from existing assignment/PIN/manual-item checks. The shared `tests/fixtures/checklist-write-parity.mjs` generates 3,300 cases used by app tests and the PGlite harness. The harness executes real RLS INSERT/UPDATE statements and actual guarded functions, including both 0217 OR siblings, the real 0189/0200 helpers and 0228 role mapping.
- Confirmation takes `(actor, instance, confirmed_at, reasons, expected_completion_ids)`. Reasons use `{templateItemId, reason}`. It returns `{instance, reasons, submission}`. The app must pass the exact IDs read during its gate/reason validation; changed IDs produce `completion_set_changed` and require a reload/revalidation, not a blind retry. Final submission metadata is derived in SQL (actor, empty IDs, final=true), never supplied as arbitrary JSON.
- Completion returns the new table row; batch returns its new submission row. Common SQL P0001 refusals are `instance_not_found`, `instance_not_open`, `not_authorized`; operation-specific refusals include `item_mismatch`, `empty_batch`, `completion_not_found`, `completion_wrong_instance`, `completion_wrong_author`, `completion_set_changed`, `invalid_payload`, `invalid_reasons` and cardinality failures. Chunk 2 must map these to the established route response shapes. No response mapping or writer cutover is done here.
- Existing completion behavior replaces both phase heads when present; 0276 links every superseded head and checks exact cardinalities. A single notes-only head retains its timestamp per `carriedCompletedAt`; other replacements timestamp after acquiring the parent lock. Failed insert/claim/reason/final-submission work rolls back as one transaction, with no compensation DELETE.
- `scripts/sql-harness-0276.mjs` checks function ACLs by OID and real caller EXECUTE refusals, foreign/missing completion IDs, insert-failure rollback, confirmation dependent-failure rollback, stale snapshots and closed-parent refusals. Mutations expose anon/authenticated EXECUTE and remove each of the three writer locks/open checks. Lock detection is structural in PGlite, not a claim of two-backend execution.
- `scripts/sim/checklist-0276-lock-check.mjs` is **written, syntax-checked, NOT RUN**. PGlite has one backend. CC's later sim run needs `pg`, the explicit guarded SIM_DATABASE_URL and three pre-created disposable open instances (dated 2099+) with a matching actor/item. It proves blocking via `pg_blocking_pids`, tests replacement/confirm in both orders and two confirms, and preserves fixture history. It performs commits only when explicitly run; no sim connection was opened for Chunk 1.

No existing test assertion was changed or removed. All Chunk-1 files are new; old application callers, authenticated reads, policies and grants remain unchanged. CC cross-family review and real-sim concurrency proof remain outstanding before cutover/deployment.
