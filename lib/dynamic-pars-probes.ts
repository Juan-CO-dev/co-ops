/**
 * DYNAMIC PARS — the migration probes (Task 3.9), and nothing else.
 *
 * ── WHY THIS IS ITS OWN LEAF MODULE ────────────────────────────────────────────
 * The plan puts these probes in `lib/dynamic-pars.ts` and every consumer named there
 * still reaches them at that path — the server module re-exports all four, exactly the
 * `*-shared.ts` re-export idiom (AGENTS.md § Module boundaries). They are DEFINED here
 * because two of their consumers sit UPSTREAM of `lib/dynamic-pars.ts` in the import
 * graph: `lib/ordering.ts` (loadOverlayBySku's auto-lane select, Task 3.3) and
 * `lib/catering/toast-sales.ts` (the sales-signal write, Task 3.4). `lib/dynamic-pars.ts`
 * imports BOTH of those modules, so hosting the probes there would make three pairs of
 * modules mutually recursive for the sake of one boolean. A leaf with no imports of its
 * own cannot participate in a cycle.
 *
 * ── THE PATTERN (0180 precedent: lib/counts.ts countProductAllocationReady) ────
 * One `select(<the exact object the writer touches>).limit(1)`. Cache ONLY the TRUE
 * answer; re-probe while false, so the surface lights itself the moment the migration
 * lands — no redeploy, no flag, and no stale `false` stranded in a warm serverless
 * process. Log the pending state exactly once per process.
 *
 * Probing the EXACT COLUMN/TABLE each writer touches, rather than one probe per
 * migration, is deliberate: a probe that answers for its neighbour is a probe that lies
 * the day a migration is applied in two pieces.
 */
import type { getServiceRoleClient } from "@/lib/supabase-server";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Build a cache-TRUE-only probe over one table+column. Zero I/O until called. */
function makeProbe(table: string, column: string, migration: string, gate: string) {
  let ready = false;
  let logged = false;
  return async function probe(sb: ServiceClient): Promise<boolean> {
    if (ready) return true;
    const { error } = await sb.from(table).select(column).limit(1);
    if (error) {
      if (!logged) {
        logged = true;
        console.warn(
          `[dynamic-pars] ${table}.${column} is DORMANT — migration ${migration} (${gate}) is not applied yet: ${error.message}`,
        );
      }
      return false;
    }
    ready = true;
    return true;
  };
}

/** 0182: the nightly ledger exists (the engine's write target). */
export const parAutoMovesReady = makeProbe("par_auto_moves", "id", "0182", "GATE M1");

/** 0182: the one-verdict-per-generation table (the accept/dismiss/revert arbiter). */
export const parSuggestionActionsReady = makeProbe(
  "par_suggestion_actions", "id", "0182", "GATE M1",
);

/** 0182: the day-grain catering marker materializeDailyDepletion stamps (plan D4). */
export const salesSignalsReady = makeProbe(
  "toast_daily_sales_signals", "id", "0182", "GATE M1",
);

/**
 * 0183: the MACHINE'S par lane on the per-location overlay.
 *
 * This is the probe that keeps the walker byte-identical pre-apply: while it is false
 * `loadOverlayBySku` selects exactly the columns it selects on `main` today, the auto
 * fields are ABSENT from the overlay object, and `resolveLane` falls through to the
 * global par — which is the two-layer answer, unchanged.
 */
export const parAutoLaneReady = makeProbe(
  "location_sku_settings", "auto_weekday_par", "0183", "GATE M2",
);
