-- 0176 · Checklist completions: one live head per (instance, item), DB-enforced.
--
-- PROVENANCE: concurrency sim pilot (2026-08-11). completeItem's read-prior →
-- insert → supersede is a NON-ATOMIC two-phase write; under two simultaneous
-- completers on one item the harness reproduced TWO live completion heads 18/20
-- times (the function's own docstring predicted the state; its supersede guard
-- fires only ~10% under a true race). A duplicate live head breaks the next
-- completion/edit of that item: the prior-load uses `.maybeSingle()`, which
-- errors on >1 row.
--
-- PROD STATE (read-only probe, 2026-08-11): 532 dup-live groups, all human (0
-- auto-ref), 499 single-completer + 33 multi-completer, dated 2026-05-05 →
-- 2026-07-10 (the single-completer class stopped when the guarded-supersede
-- rowcount check landed; the concurrency race is the remainder). This migration
-- (1) collapses the historical dups append-only-safely — keeps the newest
-- completed_at per group LIVE, supersedes the rest — then (2) enforces a single
-- live head with a partial unique index. lib/checklists.ts completeItem is
-- reworked to supersede-then-insert with a bounded retry on the index conflict.
--
-- Applied via MCP + landed here in the same PR (house law). Pre-flighted against
-- the live schema: checklist_completions has superseded_at, superseded_by,
-- revoked_at, completed_at, id.
--
-- ⚠ DEPLOY ORDERING (real hazard, handled 2026-08-11): the OLD completeItem
-- inserts BEFORE it supersedes, so a live index would 23505 any re-completion of
-- an item that already has a live head. Sequence on prod: (1) the dup-COLLAPSE
-- was applied immediately (safe with old code — it just sees clean single heads);
-- (2) the INDEX is applied AFTER this PR merges and the flip-first completeItem
-- deploys. This file is the durable record of both halves; a fresh environment
-- runs them together (code + schema arrive atomically there).

begin;

-- (1) Collapse existing duplicate live heads. Append-only: we SUPERSEDE the
-- losers (never delete). Winner = the newest completed_at in the group (ties
-- broken by id) — matches completeItem's last-writer-wins intent. superseded_by
-- points at the surviving live head so the chain stays coherent.
with ranked as (
  select
    id, instance_id, template_item_id, completed_at,
    first_value(id) over (
      partition by instance_id, template_item_id
      order by completed_at desc, id desc
    ) as winner_id,
    row_number() over (
      partition by instance_id, template_item_id
      order by completed_at desc, id desc
    ) as rn
  from public.checklist_completions
  where superseded_at is null and revoked_at is null
)
update public.checklist_completions c
set superseded_at = now(),
    superseded_by = r.winner_id
from ranked r
where c.id = r.id
  and r.rn > 1;               -- everything but the winner in each dup group

-- (2) Enforce one live head per (instance, item) going forward. Partial: only
-- LIVE rows (not superseded, not revoked) participate, so the append-only
-- history of superseded/revoked completions is unconstrained.
create unique index if not exists checklist_completions_one_live_head
  on public.checklist_completions (instance_id, template_item_id)
  where superseded_at is null and revoked_at is null;

commit;
