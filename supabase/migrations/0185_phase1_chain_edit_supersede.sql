-- Migration 0185_phase1_chain_edit_supersede
-- AUTHORED 2026-08-29. NOT YET APPLIED — GATE (LEAD/JUAN).
--
-- 0185: submit_phase1_atomic's chain-edit branch supersedes the live completion head
-- before it inserts, so it stops violating 0176's one-live-head index.
--
-- ── PROVENANCE (wiring audit, checklists-cash cluster) ─────────────────────────────────
-- Migration 0176 (2026-08-11, the concurrency sim) added
--     UNIQUE (instance_id, template_item_id) WHERE superseded_at IS NULL AND revoked_at IS NULL
-- on checklist_completions and reworked lib/checklists.ts completeItem to supersede-then-
-- insert. Every other completion writer in the codebase does the same flip:
-- save_phase2_item_atomic (0056), submit_am_prep_atomic's auto-complete path (0044),
-- autoCompleteClosingMidDayRef (lib/prep.ts), submitCashReport's sibling pattern in
-- lib/cash.ts. submit_phase1_atomic (0055) does NOT — it contains no reference to
-- superseded_at at all, on either path — and its p_is_update branch bare-INSERTS a new
-- completion for a (instance_id, template_item_id) whose original is still live.
--
-- VERIFIED AGAINST THE LIVE SYSTEM (read-only probes, 2026-08-29):
--   · checklist_completions_one_live_head EXISTS in prod, exactly as 0176 declares it.
--   · prod's submit_phase1_atomic prosrc contains NO occurrence of 'superseded_at'.
--   · prod's prosrc is byte-identical to 0055's function body once comments and
--     insignificant whitespace are normalised away (md5 2b5fb2a09d9e310b49a82092de6bd7fe,
--     16857 chars, both sides) — so the file below is a faithful re-emission of what is
--     actually running, not a re-emission of a drifted record. The body here was COPIED
--     from 0055 mechanically; the only edits are the three marked 0185 blocks.
--
-- ── WHY THIS IS AUTHORED AND NOT APPLIED ───────────────────────────────────────────────
-- The branch is UNREACHABLE today: no caller passes isUpdate for Phase 1 (lib/opening.ts
-- submitPhase1Atomic documents the parameter as "forward-compat per migration 0055's
-- chain-edit branch but no UI exercises it yet", and app/api/opening/submit/phase1 never
-- sets it). So this is a LATENT defect — nothing in prod is failing on it right now — and
-- replacing a 500-line SECURITY DEFINER function that sits on the opening submit path is
-- not a change to slip in beside two library fixes. It is authored so the fix exists the
-- day the chain-edit UI is built, and it is gated so a human decides when the opening
-- path's RPC gets replaced. NOTHING IN THIS PR APPLIES IT.
--
-- ── WHAT CHANGED, EXACTLY (three blocks, all inside the p_is_update branch) ─────────────
--   1. DECLARE      v_superseded_completion_id uuid;
--   2. Before the chain-edit INSERT: flip the LIVE head's superseded_at to v_submitted_at,
--      capturing its id. The live head — not v_original_completion_id, which is the CHAIN
--      HEAD's completion and is already superseded by the time a second edit runs.
--   3. After the INSERT: write superseded_by = the new completion id on that captured row.
-- Everything else is byte-for-byte 0055, including the whole C.54 §9 verification gate,
-- whose three preservation properties this change does not touch: provenance still comes
-- from v_original_count_provenance, and superseding a completion writes no notification.
--
-- ── APPLY ORDER (for whoever gates this) ───────────────────────────────────────────────
-- CREATE OR REPLACE preserves ACLs, so the grant block at the bottom is a re-assertion of
-- 0055's + 0132's posture, not a change. There is no data half: no existing row needs
-- fixing, because the branch has never run. Apply via MCP, then this file IS the record.

CREATE OR REPLACE FUNCTION public.submit_phase1_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_section_verifications jsonb DEFAULT NULL,
  p_opener_no_prior_data_reason text DEFAULT NULL,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  -- Pre-load context
  v_location_id uuid;
  v_opening_date date;
  v_location_code text;
  v_actor_name text;
  v_submitted_at timestamptz := now();

  -- Per-entry locals
  v_entry jsonb;
  v_phase text;
  v_template_item_id uuid;
  v_item_label text;
  v_section_key text;
  v_section_verified boolean;
  v_count_value numeric;
  v_photo_id uuid;
  v_notes text;
  v_spot_check_status text;          -- input from entry payload
  v_resolved_spot_check_status text; -- server-derived (flagged_recount | matched_via_section_verify)
  v_opener_recount numeric;
  v_closer_count numeric;
  v_par_value numeric;
  v_ground_truth numeric;
  v_prep_need numeric;
  v_count_provenance text;           -- C.54: 'closer_captured' | 'reconstructed_morning' | NULL
  v_prep_data_phase1 jsonb;

  -- Section lookup map + verified section keys
  v_section_by_item_id jsonb;
  v_verified_sections text[] := ARRAY[]::text[];
  v_section_ver jsonb;

  -- Completion + submission state
  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_opening_instance_row jsonb;

  -- C.54 NULL-source per-instance state (Pattern A)
  v_has_null_source boolean := false;
  v_null_source_count int := 0;
  v_null_source_notif_id uuid;

  -- Counters returned to the JS layer for opening.phase1_submit audit metadata
  v_stations_verified int := 0;
  v_items_recounted int := 0;
  v_provenance_markers_set int := 0;

  -- Notification dispatch
  v_notif_title text;

  -- C.46 chain-edit state
  v_chain_head_row checklist_submissions%ROWTYPE;
  v_original_completion_id uuid;
  v_original_count_provenance text;  -- §9 preservation read
  v_max_edit_count int;
  v_new_edit_count int;
  -- 0185: the live completion head this chain edit supersedes (NULL when the
  -- item has no live head — a revoked or already-superseded original).
  v_superseded_completion_id uuid;
BEGIN
  -- ──── Pre-load instance + location ────
  --
  -- The locations FK on checklist_instances guarantees the JOIN never
  -- drops a row when the instance exists — so a NULL v_location_id here
  -- unambiguously means "instance not found."
  --
  -- Note: 0053:182-193 used a single 3-way JOIN (instance + locations +
  -- users) with a single disjunctive "instance OR actor not found" raise.
  -- That collapses two distinct failure modes (bad instance vs bad actor)
  -- into one error message, misattributing the failure. Per Triad A code-
  -- gate review 2026-05-26, the instance lookup and actor lookup are
  -- separated below so each failure raises with its own precise message.
  -- Both still raise as foreign_key_violation so the JS-side translation
  -- behavior is preserved.
  SELECT ci.location_id, ci.date, l.code
  INTO v_location_id, v_opening_date, v_location_code
  FROM checklist_instances ci
  JOIN locations l ON l.id = ci.location_id
  WHERE ci.id = p_opening_instance_id;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase1_atomic: opening instance % not found',
      p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Pre-load actor display name ────
  --
  -- Separated from the instance lookup above (Triad A fix-1 ruling) so
  -- a missing actor raises distinctly from a missing instance. Both
  -- raises still use foreign_key_violation; the JS layer's mapOpeningError
  -- translation behavior is unchanged.
  SELECT name INTO v_actor_name FROM users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase1_atomic: actor % not found',
      p_actor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Pre-load section assignments for Phase 1 items in p_entries ────
  --
  -- Builds a JSONB lookup { template_item_id::text -> section_key } from
  -- checklist_template_items.prep_meta->>'section'. Single query for the
  -- whole batch (manageable for current scale of ~10-15 spot-check items).
  -- Mirrors 0053:199-206.
  SELECT jsonb_object_agg(cti.id::text, cti.prep_meta->>'section')
  INTO v_section_by_item_id
  FROM checklist_template_items cti
  WHERE cti.id IN (
    SELECT (entry->>'templateItemId')::uuid
    FROM jsonb_array_elements(p_entries) entry
    WHERE COALESCE(entry->>'phase', 'phase1') = 'phase1'
  );

  -- ──── Pre-extract verified section keys → text[] ────
  --
  -- Empty array when no sections verified (legitimate state when all
  -- items are individually recounted). Mirrors 0053:212-220.
  IF p_section_verifications IS NOT NULL AND p_section_verifications <> 'null'::jsonb THEN
    SELECT array_agg(sv->>'sectionKey')
    INTO v_verified_sections
    FROM jsonb_array_elements(p_section_verifications) sv
    WHERE (sv->>'verified')::boolean = TRUE;
  END IF;
  IF v_verified_sections IS NULL THEN
    v_verified_sections := ARRAY[]::text[];
  END IF;

  IF NOT p_is_update THEN
    -- ════════════════════════════════════════════════════════════════════
    -- ORIGINAL-SUBMISSION PATH
    -- ════════════════════════════════════════════════════════════════════

    -- ──── Loop entries: per-item validation, server compute, INSERT ────
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');
      IF v_phase <> 'phase1' THEN
        RAISE EXCEPTION 'submit_phase1_atomic: unexpected phase "%" in entry % (expected phase1)',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_template_item_id := (v_entry->>'templateItemId')::uuid;

      SELECT label INTO v_item_label
      FROM checklist_template_items
      WHERE id = v_template_item_id;

      -- Extract top-level fields (countValue/photoId/notes apply to ALL
      -- Phase 1 items — fridge temps, cleanliness notes, etc.)
      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');

      -- Discriminator: spotCheckStatus IS NULL on non-spot-check Phase 1
      -- items (cleanliness, station-ready ticks). Spot-check items always
      -- carry a non-null spotCheckStatus per OpeningEntryPhase1's contract
      -- (lib/types.ts:797 — "NULL on non-spot-check items").
      v_spot_check_status := NULLIF(v_entry->>'spotCheckStatus', '');
      v_opener_recount := CASE
        WHEN v_entry->>'openerRecount' IS NULL THEN NULL
        ELSE NULLIF(v_entry->>'openerRecount', '')::numeric
      END;

      IF v_spot_check_status IS NOT NULL THEN
        -- ════ SPOT-CHECK ITEM ════
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        -- Read closer-count snapshot (materialized at instance create per
        -- migration 0052). closer_count IS NULLABLE — that nullability IS
        -- the C.54 NULL-source signal.
        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- ──── Responsibility 1: verification gate (resolution rule) ────
        --
        -- Resolution rule per brief:
        --   non-NULL closer_count → section-verify OR recount (either valid)
        --   NULL closer_count     → recount ONLY (section-verify NOT a valid
        --                            path; you cannot verify-as-correct a
        --                            count that doesn't exist)
        --
        -- The NULL-closer-section-verified-without-recount case is the
        -- typed-error site that maps to OpeningNullSourceRequiresRecountError
        -- via mapOpeningError (Aggie's A2 lane; lib/opening.ts:208 + 79).
        IF v_closer_count IS NULL
           AND v_opener_recount IS NULL
           AND v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic: null_source_requires_recount for item % (%) — closer_count IS NULL and item was section-verified; a per-item recount is required (section-verify is not a valid resolution for NULL-source items)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- General unresolved gate covers both NULL-closer-no-recount-no-verify
        -- AND non-NULL-closer-no-recount-no-verify cases. The discriminating
        -- raise above fires first when applicable; this is the catch-all.
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic: ground_truth_unresolved for item % (%) — section not verified AND opener_recount IS NULL',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- ──── Responsibility 4: server compute (ground_truth + prep_need) ────
        --
        -- ground_truth = openerRecount IF NOT NULL ELSE closer_count (which
        -- is NOT NULL here because the gate above eliminated the
        -- NULL/NULL case). Server is authoritative — client's groundTruthCount
        -- is a UX hint only.
        v_ground_truth := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth IS NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass (defensive)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- prep_need = MAX(0, par - ground_truth). NULL when par is NULL
        -- (par-null items have no prep_need semantic).
        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth)
          ELSE NULL
        END;

        -- ──── Responsibility 5: C.54 NULL-source detection (per-item) ────
        --
        -- count_provenance = 'reconstructed_morning' when the source closer
        -- count was absent and the morning recount is the new source of
        -- truth; else 'closer_captured'. Pattern A: set v_has_null_source on
        -- ANY reconstructed_morning entry; dispatch ONE notification post-loop.
        IF v_opener_recount IS NOT NULL AND v_closer_count IS NULL THEN
          v_count_provenance := 'reconstructed_morning';
          v_has_null_source := true;
          v_null_source_count := v_null_source_count + 1;
        ELSE
          v_count_provenance := 'closer_captured';
        END IF;
        v_provenance_markers_set := v_provenance_markers_set + 1;

        -- Spot-check status discriminator (OpeningSpotCheckStatus enum):
        --   'flagged_recount'              → opener provided a recount
        --   'matched_via_section_verify'   → opener tapped section verify only
        v_resolved_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        IF v_opener_recount IS NOT NULL THEN
          v_items_recounted := v_items_recounted + 1;
        END IF;

        -- Build prep_data->phase1 — invariant shape for Phase 2's downstream
        -- read. All 8 fields persist regardless of section-verify vs recount
        -- path (consistent with C.50 §8.4 invariant pattern for Phase 2).
        --
        -- ⚠ PHASE 2 CONTRACT DEPENDENCY (Triad A code-gate item 3, 2026-05-26):
        -- The Phase 2 RPC (submit_phase2_atomic, downstream commit) will
        -- READ this JSONB to source the persisted ground_truth_count + prep_need
        -- when computing delta_vs_prep_need. The exact key names below are
        -- the binding contract for Phase 2's reader:
        --   • prep_data->'phase1'->>'phase'              (always 1)
        --   • prep_data->'phase1'->>'closer_count'       (numeric or null)
        --   • prep_data->'phase1'->>'opener_recount'     (numeric or null)
        --   • prep_data->'phase1'->>'section_verified'   (boolean)
        --   • prep_data->'phase1'->>'ground_truth_count' (numeric, NOT NULL on spot-check items)
        --   • prep_data->'phase1'->>'prep_need'          (numeric or null when par_value is null)
        --   • prep_data->'phase1'->>'par_value'          (numeric or null)
        --   • prep_data->'phase1'->>'spot_check_status'  ('flagged_recount' | 'matched_via_section_verify')
        -- When Phase 2's RPC ships, the reader MUST be checked against these
        -- exact keys; any rename here is a Phase 2 break and requires the
        -- coupled-commit discipline (AGENTS.md "wire-shape coupling at
        -- architectural level, not conversational level").
        v_prep_data_phase1 := jsonb_build_object(
          'phase', 1,
          'closer_count', v_closer_count,
          'opener_recount', v_opener_recount,
          'section_verified', v_section_verified,
          'ground_truth_count', v_ground_truth,
          'prep_need', v_prep_need,
          'par_value', v_par_value,
          'spot_check_status', v_resolved_spot_check_status
        );

      ELSE
        -- ════ NON-SPOT-CHECK ITEM (cleanliness, station-ready, fridge temp) ════
        --
        -- No snapshot read, no ground-truth derivation, no provenance
        -- marker (count_provenance stays NULL — the C.54 marker only applies
        -- to items whose count was either closer-captured or morning-
        -- reconstructed; a cleanliness tick has no count semantic at all).
        v_count_provenance := NULL;
        v_prep_data_phase1 := NULL;
      END IF;

      -- INSERT the completion. count_provenance is set per the discriminator
      -- above; prep_data carries the Phase 1 metadata blob (or NULL for
      -- non-spot-check items where there's nothing to record beyond
      -- count_value/photo_id/notes).
      INSERT INTO checklist_completions (
        instance_id, template_item_id, completed_by, completed_at,
        count_value, photo_id, notes, prep_data, count_provenance
      )
      VALUES (
        p_opening_instance_id,
        v_template_item_id,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        CASE
          WHEN v_prep_data_phase1 IS NOT NULL
            THEN jsonb_build_object('phase1', v_prep_data_phase1)
          ELSE NULL
        END,
        v_count_provenance
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

    -- ──── Responsibility 6: C.54 attestation gate (per-instance) ────
    --
    -- When ANY entry above set v_has_null_source, the opener MUST have
    -- supplied the no-prior-data attestation. Raises P0001 'provenance_
    -- required' which the JS layer maps to OpeningProvenanceRequiredError
    -- (lib/opening.ts:182).
    --
    -- The CHECK constraint on opener_no_prior_data_reason (migration 0054)
    -- enforces the enum values at write time, but we surface a friendlier
    -- error here so bad values raise as P0001 instead of as a 23514 check
    -- violation with a noisy constraint name.
    IF v_has_null_source THEN
      IF p_opener_no_prior_data_reason IS NULL THEN
        RAISE EXCEPTION 'submit_phase1_atomic: provenance_required for instance % — at least one item resolved via reconstructed_morning provenance; opener_no_prior_data_reason is required',
          p_opening_instance_id
          USING ERRCODE = 'P0001';
      END IF;
      IF p_opener_no_prior_data_reason NOT IN ('planned_closure', 'missed_or_unknown') THEN
        RAISE EXCEPTION 'submit_phase1_atomic: provenance_required for instance % — invalid p_opener_no_prior_data_reason "%": expected one of (planned_closure, missed_or_unknown)',
          p_opening_instance_id, p_opener_no_prior_data_reason
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE checklist_instances
      SET opener_no_prior_data_reason = p_opener_no_prior_data_reason
      WHERE id = p_opening_instance_id;
    END IF;

    -- ──── Responsibility 7: C.54 notification dispatch (per-instance, single) ────
    --
    -- Pattern A: v_has_null_source was set in the entries loop above; we
    -- dispatch ONE notification here (NOT N-per-item). Recipients mirror
    -- 0053:462-482 verbatim per the brief — the IN-list is correct because
    -- current_user_role_level() reads the caller's role, useless for
    -- resolving target users' roles.
    --
    -- Notification type 'opening_no_prior_data_alert' is a new value in the
    -- lib/notifications.ts NOTIFICATION_TYPES vocabulary; Aggie's lib lane
    -- adds the const value (DB-side column is open text per the
    -- "type vocabulary at lib layer not DB layer" lock).
    --
    -- i18n keys 'notifications.opening_no_prior_data.title' + '.body' are
    -- placeholders; Aggie's S2 swarm lane populates EN + ES translations
    -- (gated as merge requirement before route handler goes live).
    IF v_has_null_source THEN
      v_notif_title := 'No prior closing data — opening at ' || v_location_code;

      INSERT INTO notifications (
        type, category, priority, title, body, data,
        related_table, related_id, location_id, created_by
      )
      VALUES (
        'opening_no_prior_data_alert',
        NULL,
        'urgent',
        v_notif_title,
        NULL,
        jsonb_build_object(
          'action', 'opening.submitted_with_no_prior_closing_data',
          'titleKey', 'notifications.opening_no_prior_data.title',
          'titleParams', jsonb_build_object(
            'locationCode', v_location_code,
            'openingDate', v_opening_date::text
          ),
          'bodyKey', 'notifications.opening_no_prior_data.body',
          'bodyParams', jsonb_build_object(
            'openerName', v_actor_name,
            'locationCode', v_location_code,
            'openingDate', v_opening_date::text,
            'nullSourceCount', v_null_source_count,
            'attestationReason', p_opener_no_prior_data_reason
          ),
          'instanceId', p_opening_instance_id::text,
          'openingDate', v_opening_date::text,
          'nullSourceCount', v_null_source_count,
          'attestationReason', p_opener_no_prior_data_reason
        ),
        'checklist_instances',
        p_opening_instance_id,
        v_location_id,
        p_actor_id
      )
      RETURNING id INTO v_null_source_notif_id;

      -- ──── Recipients: MoO + Owner + KH+ at location, DISTINCT ────
      --
      -- Mechanism: literal IN-list of KH+ role codes, paired with a
      -- location-membership EXISTS for location-scoped roles, OR'd with
      -- unconditional inclusion of moo + owner (per CO's role registry,
      -- moo + owner sit above location scope).
      --
      -- Verbatim diff against 0053:467-481 — this is the same mechanism
      -- (role-name IN-list, NOT a level comparison). Diffed literally by
      -- Triad A code-gate review 2026-05-26; semantics + names match.
      --
      -- The IN-list values map to KH+ (level ≥ 3) per lib/roles.ts:37-48:
      --   cgs(8), owner(7), moo(6.5), gm(6), agm(5), catering_mgr(5),
      --   shift_lead(4), key_holder(3), trainer(3), employee(3).
      -- The DB CHECK constraint on users.role lists eleven values; the
      -- omitted role is 'trainee' (level 2 per lib/roles.ts:48), correctly
      -- excluded as the only sub-KH+ role.
      --
      -- ⚠ COUPLING HAZARD (AGENTS.md sibling lesson, "Role-level gate
      -- audits must include UI-side gates"): adding a future role at
      -- level >= 3 to lib/roles.ts + the users.role CHECK constraint
      -- requires updating THIS IN-list AND 0053:467-481 AND any other
      -- recipient-resolution site driven by names. A grep-sweep for
      -- u.role IN (... is the discipline. Forward improvement: define a
      -- SQL-side role_level_of(role text) RETURNS int helper so recipient
      -- resolution can drive from levels instead of enumerated names —
      -- tracked as out-of-scope for B2 / this migration; raise as its
      -- own architectural change.
      --
      -- The "current_user_role_level() reads the actor, useless for
      -- target resolution" clause in the B2 brief is why the IN-list
      -- mechanism is correct here vs the helper: the helper resolves
      -- the caller's role from JWT claims, not arbitrary target rows.
      INSERT INTO notification_recipients (
        notification_id, user_id, delivery_method, delivery_status
      )
      SELECT v_null_source_notif_id, recipients.user_id, 'in_app', 'pending'
      FROM (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        WHERE u.active = TRUE
          AND (
            (u.role IN (
              'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',
              'shift_lead', 'key_holder', 'trainer', 'employee'
            )
             AND EXISTS (
               SELECT 1 FROM user_locations ul
               WHERE ul.user_id = u.id AND ul.location_id = v_location_id
             ))
            OR u.role = 'moo'
            OR u.role = 'owner'
          )
      ) recipients;
    END IF;

    -- ──── Responsibility 2: section verifications INSERT ────
    --
    -- Append-only — no UNIQUE constraint on (instance, sectionKey); multi-
    -- toggle in client state collapses to final value at submit. One row
    -- per verified=true entry. Mirrors 0053:499-515.
    IF p_section_verifications IS NOT NULL AND p_section_verifications <> 'null'::jsonb THEN
      FOR v_section_ver IN SELECT * FROM jsonb_array_elements(p_section_verifications)
      LOOP
        IF (v_section_ver->>'verified')::boolean = TRUE THEN
          INSERT INTO opening_section_verifications (
            opening_instance_id, section_key, verified_at, verified_by
          )
          VALUES (
            p_opening_instance_id,
            v_section_ver->>'sectionKey',
            v_submitted_at,
            p_actor_id
          );
          v_stations_verified := v_stations_verified + 1;
        END IF;
      END LOOP;
    END IF;

    -- ──── Submission row ────
    --
    -- is_final_confirmation = FALSE per Triad A: Phase 1 is not the final
    -- confirmation (Phase 3 is, with the closing auto-complete + the
    -- 'confirmed' status transition).
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, FALSE
    )
    RETURNING id INTO v_submission_id;

    -- ──── Responsibility 9: status transition (race-safe) ────
    --
    -- Single UPDATE with status='open' filter. NOT FOUND means another
    -- submitter beat us OR the instance is already past Phase 1. Translates
    -- to P0001 'phase1_not_eligible' which the JS layer maps to
    -- OpeningPhase1NotEligibleError (lib/opening.ts:279).
    --
    -- confirmed_at / confirmed_by / finalized_at_actor_type stay NULL —
    -- Phase 3 sets them at the 'confirmed' transition.
    UPDATE checklist_instances
    SET status = 'phase1_complete'
    WHERE id = p_opening_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_phase1_atomic: phase1_not_eligible — instance % is not in status=open (concurrent submit OR status already past Phase 1)',
        p_opening_instance_id
        USING ERRCODE = 'P0001';
    END IF;

    -- NO opening→closing auto-complete (per Triad A ruling, C.54 §2.A). Phase 3
    -- owns that responsibility when the instance transitions to 'confirmed'.

  ELSE
    -- ════════════════════════════════════════════════════════════════════
    -- C.46 CHAIN-EDIT PATH — §9 NAMED VERIFICATION GATE
    -- ════════════════════════════════════════════════════════════════════
    --
    -- The C.46 chain-edit path is the historically highest-risk region in
    -- this function: the C.54 §9 production bug (Juan's NULL-SENTINEL smoke
    -- at EM 2026-05-25, instance d49d1504-...) lived in 0053's auto-complete
    -- branch carrying a "preserved from 0050" comment that was true at the
    -- literal level but architecturally wrong after C.50 changed the
    -- operational assumption ("absence of prior data" became a valid state).
    --
    -- This block IS the brief's named verification gate. The three
    -- preservation properties are demonstrated by the actual SQL structure
    -- below, NOT asserted in comments.
    --
    -- (a) Original completion's count_provenance is PRESERVED on chain edit
    --     — never rewritten from current snapshot/recount state.
    --     → Verified at the INSERT below: the new completion's
    --       count_provenance is set to v_original_count_provenance, which is
    --       READ FROM the original completion row (SELECT below). The
    --       chain-edit branch NEVER recomputes provenance from current
    --       (closer_count, opener_recount) state.
    --
    -- (b) The missing-closing notification (opening_no_prior_data_alert) is
    --     NOT re-emitted on chain edit.
    --     → Verified by structural absence: this branch contains NO
    --       INSERT INTO notifications statement. The original-path dispatch
    --       block above is gated under IF NOT p_is_update (the outer
    --       IF/ELSE here), so chain edits cannot reach it.
    --
    -- (c) The missing-closing notification is NOT retracted on chain edit.
    --     → Verified by structural absence: NO UPDATE notifications, NO
    --       UPDATE notification_recipients, NO DELETE FROM notifications, NO
    --       DELETE FROM notification_recipients statement exists ANYWHERE
    --       in this function. The original notification stands across all
    --       chain edits.
    --
    -- (d) Verification is against Phase 1's specific provenance model — NOT
    --     inherited assumption from 0053's structure.
    --     → Phase 1 stores count_provenance in the dedicated column added by
    --       migration 0054 (checklist_completions.count_provenance). The
    --       preservation read below pulls from THAT exact column, not from
    --       prep_data.phase1 metadata or from any 0053 location. Phase 1's
    --       per-instance attestation (checklist_instances.opener_no_prior
    --       _data_reason) is likewise untouched on chain edit — there is no
    --       UPDATE to that column in this branch.

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_phase1_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Lock chain head + concurrent chain rows (mirrors 0053 chain pattern).
    SELECT * INTO v_chain_head_row
    FROM checklist_submissions
    WHERE id = p_original_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_phase1_atomic: chain head submission % not found', p_original_submission_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_chain_head_row.original_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'submit_phase1_atomic: % is an update row, not a chain head', p_original_submission_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_chain_head_row.instance_id <> p_opening_instance_id THEN
      RAISE EXCEPTION 'submit_phase1_atomic: chain head % is for instance %, not %',
        p_original_submission_id, v_chain_head_row.instance_id, p_opening_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM 1
    FROM checklist_submissions
    WHERE original_submission_id = p_original_submission_id
    FOR UPDATE;

    SELECT COALESCE(MAX(edit_count), 0) INTO v_max_edit_count
    FROM checklist_submissions
    WHERE id = p_original_submission_id
       OR original_submission_id = p_original_submission_id;

    IF v_max_edit_count >= 3 THEN
      RAISE EXCEPTION 'submit_phase1_atomic: edit cap reached for chain % (current_max=%)',
        p_original_submission_id, v_max_edit_count
        USING ERRCODE = 'P0001';
    END IF;

    v_new_edit_count := v_max_edit_count + 1;

    -- ──── Chain-edit entries loop ────
    --
    -- For each entry: lookup original completion in chain head, READ original
    -- count_provenance (§9 preservation point a), re-apply per-item compute
    -- against CURRENT snapshot/recount state (so the new completion's
    -- prep_data is current/valid), but INSERT the new row with the
    -- ORIGINAL provenance value.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');
      IF v_phase <> 'phase1' THEN
        RAISE EXCEPTION 'submit_phase1_atomic (update): unexpected phase "%" in entry % (expected phase1)',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_template_item_id := (v_entry->>'templateItemId')::uuid;

      -- ──── §9 PRESERVATION READ ────
      --
      -- Look up the original completion in the chain head AND read its
      -- count_provenance in a single query. This is the preservation source
      -- for §9 point (a). The value flows directly into the new INSERT
      -- below; the chain-edit branch never derives a new provenance value.
      SELECT id, count_provenance
      INTO v_original_completion_id, v_original_count_provenance
      FROM checklist_completions cc
      WHERE cc.id = ANY(v_chain_head_row.completion_ids)
        AND cc.template_item_id = v_template_item_id
      LIMIT 1;

      IF v_original_completion_id IS NULL THEN
        RAISE EXCEPTION 'submit_phase1_atomic (update): template_item_id % in update entries not found in chain head submission %',
          v_template_item_id, p_original_submission_id
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT label INTO v_item_label
      FROM checklist_template_items
      WHERE id = v_template_item_id;

      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');
      v_spot_check_status := NULLIF(v_entry->>'spotCheckStatus', '');
      v_opener_recount := CASE
        WHEN v_entry->>'openerRecount' IS NULL THEN NULL
        ELSE NULLIF(v_entry->>'openerRecount', '')::numeric
      END;

      IF v_spot_check_status IS NOT NULL THEN
        -- Spot-check item (chain edit): re-apply gates + compute against
        -- CURRENT state for prep_data freshness. Provenance stays preserved
        -- per the §9 read above.
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- Resolution gates (same as original path)
        IF v_closer_count IS NULL
           AND v_opener_recount IS NULL
           AND v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): null_source_requires_recount for item % (%)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): ground_truth_unresolved for item % (%) — section not verified AND opener_recount IS NULL',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_ground_truth := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth IS NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass (defensive)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth)
          ELSE NULL
        END;
        v_resolved_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        IF v_opener_recount IS NOT NULL THEN
          v_items_recounted := v_items_recounted + 1;
        END IF;

        v_prep_data_phase1 := jsonb_build_object(
          'phase', 1,
          'closer_count', v_closer_count,
          'opener_recount', v_opener_recount,
          'section_verified', v_section_verified,
          'ground_truth_count', v_ground_truth,
          'prep_need', v_prep_need,
          'par_value', v_par_value,
          'spot_check_status', v_resolved_spot_check_status
        );
      ELSE
        v_prep_data_phase1 := NULL;
      END IF;

      -- ──── 0185: SUPERSEDE-THEN-INSERT (migration 0176's one-live-head index) ────
      --
      -- 0176 put a partial unique index on checklist_completions
      -- (instance_id, template_item_id) WHERE superseded_at IS NULL AND
      -- revoked_at IS NULL, and reworked lib/checklists.ts completeItem to flip
      -- first. This branch was written before that index existed and still
      -- bare-INSERTS a second row for a key whose original is LIVE — so the
      -- moment a caller sets p_is_update = true it raises a raw 23505 that
      -- mapOpeningError does not recognise, i.e. an opaque 500 on every chain
      -- edit. The flip below is the same shape save_phase2_item_atomic (0056)
      -- and lib/cash.ts already use: clear the live head's null superseded_at
      -- BEFORE the insert, then back-point it once the new id exists.
      --
      -- It supersedes THE LIVE HEAD, not v_original_completion_id. Those are the
      -- same row on the first edit and diverge on the second: the §9 provenance
      -- read above deliberately keys on the CHAIN HEAD's completion_ids (so
      -- provenance is preserved from the original submission moment, edit after
      -- edit), while the row that actually holds the index slot is whichever
      -- edit is currently live. Superseding the chain head on edit 2 would be a
      -- no-op and the 23505 would come straight back.
      --
      -- At most one row can match — that is precisely what 0176's index
      -- guarantees — so a single-row RETURNING INTO is safe here. No live head
      -- (a revoked original) leaves it NULL and the insert stands alone.
      --
      -- §9 IS UNTOUCHED BY THIS: count_provenance still flows from
      -- v_original_count_provenance (point a), and an UPDATE of superseded_at on
      -- checklist_completions is not a notifications write (points b, c).
      v_superseded_completion_id := NULL;

      UPDATE checklist_completions
      SET superseded_at = v_submitted_at
      WHERE instance_id = p_opening_instance_id
        AND template_item_id = v_template_item_id
        AND superseded_at IS NULL
        AND revoked_at IS NULL
      RETURNING id INTO v_superseded_completion_id;

      -- ──── §9 PRESERVATION POINT (a): provenance from ORIGINAL, not current ────
      --
      -- count_provenance is set to v_original_count_provenance — the value
      -- READ from the original completion above. Even if the current
      -- (closer_count, opener_recount) state would suggest a different
      -- provenance for an original-path completion, on chain edit the
      -- provenance stays as it was at the original submission moment.
      INSERT INTO checklist_completions (
        instance_id, template_item_id, completed_by, completed_at,
        count_value, photo_id, notes, prep_data, count_provenance,
        original_completion_id, edit_count
      )
      VALUES (
        p_opening_instance_id,
        v_template_item_id,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        CASE
          WHEN v_prep_data_phase1 IS NOT NULL
            THEN jsonb_build_object('phase1', v_prep_data_phase1)
          ELSE NULL
        END,
        v_original_count_provenance,  -- ← §9 PRESERVATION POINT (a)
        v_original_completion_id,
        v_new_edit_count
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);

      -- 0185: close the chain link. superseded_by can only be written once the
      -- successor's id exists, which is why the flip above is two statements
      -- rather than one — the same order lib/cash.ts and completeItem take.
      IF v_superseded_completion_id IS NOT NULL THEN
        UPDATE checklist_completions
        SET superseded_by = v_completion_id
        WHERE id = v_superseded_completion_id;
      END IF;

      -- ──── §9 PRESERVATION POINTS (b), (c): structural absence ────
      --
      -- No INSERT/UPDATE/DELETE against notifications or notification_
      -- recipients fires on this path. The original instance's notification
      -- (if any) is canonical and untouched.
    END LOOP;

    -- New submission row for the chain edit
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids,
      is_final_confirmation, original_submission_id, edit_count
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids,
      FALSE, p_original_submission_id, v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- C.46 update-path audit row — RPC-side per Triad A correction 1.
    -- Mirrors 0053:860-879. ip_address + user_agent live INSIDE metadata per
    -- AGENTS.md "RPC-side audit_log INSERTs must mirror the actual column
    -- shape" lesson (migration 0044 fix). audit_log columns are id,
    -- occurred_at, actor_id, actor_role, action, resource_table, resource_id,
    -- before_state, after_state, metadata, destructive — no top-level
    -- ip_address/user_agent.
    INSERT INTO audit_log (
      actor_id, action, resource_table, resource_id, metadata, destructive
    )
    VALUES (
      p_actor_id,
      'report.update',
      'checklist_submissions',
      v_submission_id,
      jsonb_build_object(
        'report_type', 'opening_report',
        'phase', 'phase1',
        'report_instance_id', p_opening_instance_id,
        'original_submission_id', p_original_submission_id,
        'original_completed_by', v_chain_head_row.submitted_by,
        'original_completed_at', to_jsonb(v_chain_head_row.submitted_at),
        'updated_by', p_actor_id,
        'updated_at', to_jsonb(v_submitted_at),
        'edit_count', v_new_edit_count,
        'changed_fields', COALESCE(p_changed_fields, '[]'::jsonb),
        'ip_address', p_ip_address,
        'user_agent', p_user_agent,
        -- Forensic visibility for C.54 §9 audit queries: count of items in
        -- this chain edit whose preserved provenance is 'reconstructed_
        -- morning' (i.e., chain edits crossing a NULL-source item without
        -- retracting the original notification — exactly the case §9 above
        -- is designed to handle correctly).
        'items_with_preserved_reconstructed_morning_provenance', (
          SELECT count(*)
          FROM checklist_completions cc
          WHERE cc.id = ANY(v_completion_ids)
            AND cc.count_provenance = 'reconstructed_morning'
        )
      ),
      true
    );

    -- NO status update on chain edit (instance stays in current phase status).
    -- NO section verifications re-INSERT (original submission's verify state stands).
    -- NO attestation re-write to checklist_instances.opener_no_prior_data_reason.
  END IF;

  -- ──── Build result jsonb ────
  --
  -- Result shape mirrors the OpeningPhaseSubmitResult contract (lib/opening.ts:
  -- 1485) plus the audit counters per responsibility 10. Camel-case keys
  -- match 0053's return convention and the JS-side SubmitRpcResult marshaler.
  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci
  WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    -- Phase 1 owns no opening→closing auto-complete (Phase 3 does); always NULL.
    'autoCompleteId', NULL,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END,
    -- Phase 1 has no under-par notification (that's a Phase 2 concept); always [].
    'underParNotificationIds', to_jsonb(ARRAY[]::uuid[]),
    -- New: C.54 NULL-source notification ids (zero or one per submit by Pattern A).
    'nullSourceNotificationIds', CASE
      WHEN v_null_source_notif_id IS NOT NULL
        THEN to_jsonb(ARRAY[v_null_source_notif_id])
      ELSE to_jsonb(ARRAY[]::uuid[])
    END,
    -- Responsibility 10 audit counters for JS-side opening.phase1_submit audit metadata.
    'stationsVerified', v_stations_verified,
    'itemsRecounted', v_items_recounted,
    'nullSourceCount', v_null_source_count,
    'provenanceMarkersSet', v_provenance_markers_set,
    'attestationCapture', CASE
      WHEN v_has_null_source THEN p_opener_no_prior_data_reason
      ELSE NULL
    END
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — re-asserted, not changed. CREATE OR REPLACE keeps the existing ACL;
-- this block restates 0055's posture (and 0132's anon revoke) so the file stands
-- alone in a fresh environment. Per AGENTS.md, REVOKE FROM PUBLIC is NOT enough
-- on Supabase — the per-role revokes are the ones that bite.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic(
  uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic(
  uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.submit_phase1_atomic(
  uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.submit_phase1_atomic(
  uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text
) TO service_role;
