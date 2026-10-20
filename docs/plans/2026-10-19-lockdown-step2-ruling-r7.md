# CC ruling R7 (2026-10-19) — answers the R3 blocker; supersedes R3 and the R1 "open parent" wording for confirm-time writes

Astra's counterexample is accepted: under a service-role cutover a completion replacement can land after confirmation and replace the attested live head; confirm's reasons/final submission are written after the claim, so a post-insert open check is wrong too. Fix = serialize on the parent row inside the database.

## Numbering
- **0276 = guarded checklist writers (prerequisite, ships with the app cutover).**
- **0277 = the privilege lockdown** (scope = old R4, unchanged).
- Both FILE-ONLY until CC applies (sim, then prod with Juan's yes).

## 0276 contents (service_role EXECUTE only; REVOKE from PUBLIC/anon/authenticated; SECURITY INVOKER; search_path pinned)
1. `checklist_write_completion(p_actor uuid, p_instance uuid, p_template_item uuid, <payload columns>, ...)`:
   `SELECT … FROM checklist_instances WHERE id = p_instance FOR UPDATE`; require `status = 'open'`; re-check the actor in SQL with the SAME predicates as today's two INSERT policies (OR) — actor active, session-free equivalents of current_user_id/locations/role_level computed from p_actor (users.active, user_locations, role→level map: reuse/factor the existing mapping, do not fork it); supersede the prior live head and insert the new row in the same transaction; return the new row. Raises typed errors (instance_not_open, not_authorized, item_mismatch …) the app maps to its existing response shapes.
2. `checklist_submit_batch(p_actor, p_instance, …)`: parent FOR UPDATE, require open + member, completion ids belong to the instance AND the actor; insert the submission.
3. `checklist_confirm_instance(p_actor, p_instance, p_confirmed_at, p_reasons jsonb, p_submission jsonb, …)`: parent FOR UPDATE, require open + member + level; claim confirmed, insert reasons + final submission — ALL in one transaction. The app's compensation/rollback path for confirm becomes unnecessary (delete it only once the function path is the sole writer; keep error mapping). PIN verification, lock-up/cash/hard gates and reason validation stay in the app BEFORE the call (they need app context); the function enforces only the statement-time invariants + actor predicates.
4. Instance creation (`getOrCreateInstance`) may stay a service-client insert with app checks (a new open row does not race confirm) — if you find otherwise, add a 4th function.
5. Every function: exact rowcount/cardinality assertions inside SQL; no DELETE anywhere.

## Parity (R2 extended)
**Superseded in part by CC R8 (2026-10-19):** membership in app guards and 0276 means `user_locations.active = true`. The live RLS oracle still includes inactive rows; this is the third intentional tightening, alongside the two hole closures below. The shared fixture now carries membership-row existence and membership active status independently. See the chunk-5 result for implementation and verification.

One case table (role × membership × active × parent status × template type × item floor/active/report-ref) run against: (a) the LIVE RLS predicates (from the rulings dump) in PGlite, (b) the 0276 functions' actor checks, (c) the app guard. (a) ≡ (b) ≡ (c) except the two documented hole closures (submissions/reasons require member + open-or-own-confirm parent; instance status changes only through the confirm function).

## Concurrency proof
PGlite (or sim later) tests with two connections: replace-vs-confirm in both orders → the attested set never changes after confirm; confirm-vs-confirm → exactly one wins.

## Chunks
- **Chunk 1 (now):** five-table manifest doc; actor/guard module + parity table; 0276 SQL FILE + harness script + migration test (incl. mutation tests: harness fails if a function is executable by authenticated, or if the FOR UPDATE/open check is removed). No app writer cutover yet.
- Chunk 2: cut checklist writers + routes over to the 0276 functions / service client; behavioural tests from the plan.
- Chunk 3: written_reports cutover (update_self = author + strict 3 h window at statement time via conditional update + rowcount).
- Chunk 4: 0277 lockdown + harness (old R4 scope).
