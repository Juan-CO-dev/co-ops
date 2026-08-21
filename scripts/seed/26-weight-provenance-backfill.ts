/**
 * Seed 26 — WEIGHT PROVENANCE BACKFILL. Evidence-based, dry-run by default.
 *
 * Phase 6 of docs/superpowers/plans/2026-08-20-product-identity.md (Task 6.6),
 * folded into GATE M3's checklist rather than getting a gate of its own.
 *
 * ── THE GAP THIS CLOSES ───────────────────────────────────────────────────────
 * Migration 0179 added `weight_class` / `weight_source_note` / `weight_established_at`
 * / `weight_established_by` to `vendor_items` (deviation D10) so the weight board is
 * a READ rather than a per-SKU scan of a fail-open forensic table. It deliberately
 * carried NO backfill: the evidence pass belongs in a script somebody can dry-run
 * and read, not inside a DDL transaction nobody sees the output of.
 *
 * This is that pass. Live today: 40 active SKUs carry an `avg_oz_per_each`, 42
 * `sku.weight_fill` audit rows cover 40 of them, and ZERO rows carry a class in the
 * column. The class has existed all along — inside `audit_log.metadata.weight_class`,
 * written by the Angel wave seeds. This copies it onto the column it now has.
 *
 * ── WHAT IT WRITES, AND WHAT IT REFUSES TO INVENT ─────────────────────────────
 *   weight_class          <- metadata.weight_class from the NEWEST sku.weight_fill
 *                            row for that SKU. Copied, never inferred.
 *   weight_established_at <- that same audit row's own occurred_at. The audit row IS
 *                            when it was established; there is no better timestamp
 *                            and no need to guess one.
 *   weight_source_note    <- metadata.note, when there is one. It is the reasoning
 *                            somebody already wrote down; re-deriving it would be
 *                            strictly worse than copying it.
 *   weight_established_by <- **STAYS NULL. ALWAYS.** Every one of those audit rows
 *                            was written by a seed with `actorId: null`, so there is
 *                            genuinely nobody to name. NULL is the honest value and
 *                            a placeholder actor would be a silent-wrong-answer trap
 *                            (the 0161 LOCK-1 doctrine). The board renders
 *                            "seed · <script>" from the trail instead.
 *
 * A SKU with no audit history keeps NULL columns. **The class is never inferred from
 * the value** — a number cannot tell you whether somebody weighed it or read it off
 * a label, and that distinction is the entire point of the column.
 *
 * ── THE 34, AND WHY THEY STAY NULL (the dry run's real finding) ───────────────
 * Only the Angel WAVE seeds ever wrote `metadata.weight_class`. Seed 10, which filled
 * most of the catalog's weights, wrote `{ estimate: true, phase: "sku_weight_fill" }`
 * and no class — its own header says every value is "my best food-knowledge inference
 * pending Juan's scale". So for 34 of the 40 audited SKUs the newest evidence carries
 * NO class, and this script writes nothing for them.
 *
 * That is the correct outcome, not a shortfall. An educated guess is not OPERATIONAL
 * (nobody weighed it), not SPEC (no label or pack arithmetic produced it) and not
 * INVOICE_DERIVED (no delivery average behind it). Minting a fourth vocabulary term
 * to describe it is a decision for Juan, not for a backfill script — and NOTHING IS
 * LOST by waiting: the board reads the establishing date and the writing script off
 * the audit trail regardless, and renders the empty class as UNVERIFIED, which is
 * precisely what those rows are. The suggestion ranking then puts them in play on
 * their own merits. NULL is the honest value (0161 LOCK-1).
 *
 * A SKU whose newest audit row was written by a HUMAN is REFUSED and named — that
 * one wants a person on it, and this script deliberately names nobody.
 *
 * ── IDEMPOTENT, AND IT NEVER OVERWRITES A HUMAN ───────────────────────────────
 * Re-reads the live row at write time and SKIPS any SKU that already carries a
 * `weight_class`. A weigh session (which writes OPERATIONAL + a real actor) always
 * outranks this backfill, whichever order they run in — so a second `--execute`
 * after a session reports "already" and writes nothing.
 *
 * ── DRY RUN IS THE DEFAULT ────────────────────────────────────────────────────
 * Running with no arguments WRITES NOTHING. Writing requires an explicit
 * `--execute`, and only the LEAD runs that (SEED LAW, plan header).
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/26-weight-provenance-backfill.ts            -> DRY RUN
 *      ... 26-weight-provenance-backfill.ts --markdown            -> dry run as md
 *      ... 26-weight-provenance-backfill.ts --execute             -> WRITES
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and the
 * seed dies on import. The react-server condition resolves it to the empty stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { selectAllRows } from "@/lib/supabase-paginate";
import { pathToFileURL } from "node:url";

const SCRIPT = "scripts/seed/26-weight-provenance-backfill.ts";
const PHASE = "product_identity_phase6";
const REASON = "weight_provenance_backfill_from_audit_evidence";

const EXECUTE = process.argv.includes("--execute");
const MD = process.argv.includes("--markdown");

function h(level: number, text: string): void {
  console.log(
    MD
      ? `\n${"#".repeat(level)} ${text}\n`
      : `\n${"─".repeat(3)} ${text.toUpperCase()} ${"─".repeat(Math.max(3, 66 - text.length))}\n`,
  );
}
function p(text = ""): void {
  console.log(text);
}

function table(head: string[], rows: string[][]): void {
  if (rows.length === 0) {
    p(MD ? "_(none)_" : "  (none)");
    return;
  }
  if (MD) {
    // A bare `|` inside a cell silently shears the row into the wrong columns
    // (seed 21's lesson). Escape here rather than at every call site.
    const cell = (s: string) => (s ?? "").replace(/\|/g, "\\|");
    p(`| ${head.map(cell).join(" | ")} |`);
    p(`|${head.map(() => "---").join("|")}|`);
    for (const r of rows) p(`| ${r.map(cell).join(" | ")} |`);
    return;
  }
  const w = head.map((hd, i) => Math.max(hd.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (c: string[]) => c.map((x, i) => (x ?? "").padEnd(w[i]!)).join("  ");
  p(line(head));
  p(w.map((x) => "-".repeat(x)).join("  "));
  for (const r of rows) p(line(r));
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Truncate for a table cell without hiding that it was truncated. */
function clip(s: string | null, n = 58): string {
  if (!s) return "—";
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

interface SkuRow {
  id: string;
  name: string;
  vendor_id: string | null;
  active: boolean | null;
  avg_oz_per_each: number | string | null;
  weight_class: string | null;
  weight_source_note: string | null;
  weight_established_at: string | null;
  weight_established_by: string | null;
}

interface AuditRow {
  id: string;
  resource_id: string | null;
  occurred_at: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface Plan {
  skuId: string;
  name: string;
  label: string;
  avgOz: number | null;
  weightClass: string;
  establishedAt: string;
  sourceNote: string | null;
  script: string | null;
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  h(1, `Seed 26 — weight provenance backfill (${EXECUTE ? "EXECUTE" : "DRY RUN"})`);
  p(
    "Copies the class and the timestamp the Angel waves already recorded in " +
      "audit_log.metadata onto the columns migration 0179 created for them. " +
      "weight_established_by stays NULL — the seeds wrote actorId null, so there is " +
      "nobody to name, and naming one anyway would be worse than the absence.",
  );

  // ── Evidence ────────────────────────────────────────────────────────────────
  const skus = await selectAllRows<SkuRow>((from, to) =>
    sb
      .from("vendor_items")
      .select(
        "id, name, vendor_id, active, avg_oz_per_each, weight_class, weight_source_note, weight_established_at, weight_established_by",
      )
      .order("id", { ascending: true })
      .range(from, to)
      .returns<SkuRow[]>(),
  );

  // Newest-first, with a TOTAL order (occurred_at then id) so a same-instant pair
  // can never resolve differently between two runs of this script.
  const auditRows = await selectAllRows<AuditRow>((from, to) =>
    sb
      .from("audit_log")
      .select("id, resource_id, occurred_at, actor_id, metadata")
      .eq("action", "sku.weight_fill")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to)
      .returns<AuditRow[]>(),
  );

  // Vendor labels — the catalog holds TWIN SKUs sharing a name (two Hams, two Fresh
  // Mozzarellas), and a decision document that cannot tell them apart is not one.
  const { data: vendorRows } = await sb
    .from("vendors")
    .select("id, name")
    .returns<Array<{ id: string; name: string }>>();
  const vendorNames = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));
  const label = (s: SkuRow) => (s.vendor_id ? `${s.name} · ${vendorNames.get(s.vendor_id) ?? "?"}` : s.name);

  const newest = new Map<string, AuditRow>();
  for (const a of auditRows) {
    if (!a.resource_id) continue;
    if (!newest.has(a.resource_id)) newest.set(a.resource_id, a);
  }

  h(2, "Evidence");
  table(
    ["fact", "count"],
    [
      ["vendor_items rows", String(skus.length)],
      ["… active", String(skus.filter((s) => s.active !== false).length)],
      ["… carrying avg_oz_per_each", String(skus.filter((s) => num(s.avg_oz_per_each) != null).length)],
      ["… already carrying weight_class", String(skus.filter((s) => s.weight_class != null).length)],
      ["sku.weight_fill audit rows", String(auditRows.length)],
      ["… distinct SKUs covered", String(newest.size)],
    ],
  );

  // ── Plan ────────────────────────────────────────────────────────────────────
  const plans: Plan[] = [];
  const skipAlready: string[] = [];
  const skipNoEvidence: string[] = [];
  const skipNoClass: string[] = [];
  const refusals: string[] = [];

  for (const s of skus) {
    const avgOz = num(s.avg_oz_per_each);
    if (s.weight_class != null) {
      // Never overwrite. A weigh session's OPERATIONAL + real actor outranks this
      // backfill whichever order the two ran in.
      skipAlready.push(`${label(s)} (${s.weight_class})`);
      continue;
    }
    const a = newest.get(s.id);
    if (!a) {
      // NO EVIDENCE. The columns stay NULL. The class is NEVER inferred from the
      // value — a number cannot say whether somebody weighed it or read a label,
      // and that distinction is the whole reason the column exists.
      if (avgOz != null) skipNoEvidence.push(`${label(s)} (${avgOz} oz, no audit row)`);
      continue;
    }
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    const cls = typeof meta.weight_class === "string" ? meta.weight_class : null;
    if (!cls) {
      // NOT a refusal — an honest absence. Seed 10 wrote these with `estimate: true`
      // and no class, and no member of the live vocabulary describes an educated
      // guess. The column stays NULL and the board renders UNVERIFIED, which is
      // exactly what the row is. See the header stanza on "the 34".
      // Seed 10 recorded only `phase`, never `script`, so attribution falls back to
      // it rather than reading "unknown" about a row that does say where it came from.
      const from =
        typeof meta.script === "string" ? meta.script : typeof meta.phase === "string" ? meta.phase : "unattributed";
      skipNoClass.push(`${label(s)} (${avgOz ?? "—"} oz, ${from})`);
      continue;
    }
    if (a.actor_id != null) {
      // Defensive: if a HUMAN ever wrote one of these rows, this backfill is not
      // the right writer for it — the person should be named, and this script
      // deliberately refuses to name anybody.
      refusals.push(`${label(s)} — newest sku.weight_fill row has a human actor; leaving it to the board`);
      continue;
    }
    plans.push({
      skuId: s.id,
      name: s.name,
      label: label(s),
      avgOz,
      weightClass: cls,
      establishedAt: a.occurred_at,
      sourceNote: typeof meta.note === "string" ? meta.note : null,
      script: typeof meta.script === "string" ? meta.script : null,
    });
  }

  h(2, "Planned writes");
  table(
    ["sku", "oz", "class", "established_at", "from", "note"],
    plans.map((pl) => [
      pl.label,
      pl.avgOz == null ? "—" : String(pl.avgOz),
      pl.weightClass,
      pl.establishedAt.slice(0, 10),
      pl.script ?? "—",
      clip(pl.sourceNote),
    ]),
  );

  const byClass = new Map<string, number>();
  for (const pl of plans) byClass.set(pl.weightClass, (byClass.get(pl.weightClass) ?? 0) + 1);
  p();
  p(`Class distribution: ${[...byClass].map(([k, v]) => `${k}=${v}`).join(" · ") || "(none)"}`);

  h(2, "Skipped");
  table(
    ["reason", "count", "detail"],
    [
      ["already classed (never overwritten)", String(skipAlready.length), clip(skipAlready.join(", "), 80)],
      ["weighed but NO audit evidence — stays NULL", String(skipNoEvidence.length), clip(skipNoEvidence.join(", "), 80)],
      ["audited but NO class in the evidence — stays NULL", String(skipNoClass.length), clip(skipNoClass.join(", "), 80)],
    ],
  );
  if (skipNoClass.length > 0) {
    p();
    p(
      `NOTE: ${skipNoClass.length} SKU(s) have a weight and an audit row, but the row carries no ` +
        "weight_class — seed 10 wrote them as `estimate: true` with no class. No member of the " +
        "live vocabulary (OPERATIONAL / SPEC / INVOICE_DERIVED) describes an educated guess, so " +
        "the column stays NULL and the board shows them as UNVERIFIED. Minting a fourth class is " +
        "Juan's call, not this script's; nothing is lost by waiting, because the board reads the " +
        "date and the writing script off the audit trail either way.",
    );
    for (const line of skipNoClass) p(`  · ${line}`);
  }

  if (refusals.length > 0) {
    h(2, "Refusals");
    for (const r of refusals) p(`  ✗ ${r}`);
  }

  // ── Write ───────────────────────────────────────────────────────────────────
  if (!EXECUTE) {
    p();
    p(`Seed 26 done (dry run). Would write ${plans.length} row(s).`);
    p("**NOTHING WAS WRITTEN.**");
    return;
  }

  h(2, "Writing");
  let wrote = 0;
  for (const pl of plans) {
    // Re-read live at write time (the seed 18/20/24 invariant): the world may have
    // moved between the plan and the write, and a session that landed in between
    // must win.
    const { data: live, error: lErr } = await sb
      .from("vendor_items")
      .select("id, name, weight_class")
      .eq("id", pl.skuId)
      .maybeSingle<{ id: string; name: string; weight_class: string | null }>();
    if (lErr) throw new Error(`re-read ${pl.name}: ${lErr.message}`);
    if (!live) {
      p(`  ✗ ${pl.label} — row vanished between plan and write; skipped`);
      continue;
    }
    if (live.name !== pl.name) {
      throw new Error(`FATAL: ${pl.skuId} renamed ${pl.name} -> ${live.name} mid-run. Stopping.`);
    }
    if (live.weight_class != null) {
      p(`  = ${pl.label} — classed since the plan (${live.weight_class}); left alone`);
      continue;
    }

    const { error, count } = await sb
      .from("vendor_items")
      .update(
        {
          weight_class: pl.weightClass,
          weight_source_note: pl.sourceNote,
          weight_established_at: pl.establishedAt,
          // weight_established_by is DELIBERATELY not in this object. See header.
        },
        { count: "exact" },
      )
      .eq("id", pl.skuId)
      .is("weight_class", null);
    if (error) throw new Error(`update ${pl.name}: ${error.message}`);
    // UPDATE denials are silent on Postgres — the rowcount is the only signal.
    if (count === 0) {
      p(`  = ${pl.label} — raced by another writer; left alone`);
      continue;
    }

    await audit({
      actorId: null,
      actorRole: null,
      action: "sku.weight_fill",
      resourceTable: "vendor_items",
      resourceId: pl.skuId,
      metadata: {
        name: pl.name,
        phase: PHASE,
        reason: REASON,
        script: SCRIPT,
        actor_context: "seed",
        // This row records a PROVENANCE copy, not a new measurement. The weight
        // itself did not move, and saying so keeps the trail readable.
        weight_class: pl.weightClass,
        weight_established_at: pl.establishedAt,
        avg_oz_per_each: pl.avgOz,
        before_avg_oz_per_each: pl.avgOz,
        value_unchanged: true,
        copied_from_audit_metadata: true,
        established_by_left_null_because:
          "the source rows were written by seeds with actorId null — there is nobody to name",
      },
      ipAddress: null,
      userAgent: null,
    });
    wrote += 1;
    p(`  ✓ ${pl.label} -> ${pl.weightClass} @ ${pl.establishedAt.slice(0, 10)}`);
  }

  p();
  p(`Seed 26 done (execute). Wrote ${wrote} of ${plans.length} planned row(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
