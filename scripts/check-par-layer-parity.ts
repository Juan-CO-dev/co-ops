/**
 * Read-only Par Layer parity check (Item/Inventory Spine 2B). Proves the backfill
 * + loader cutover is a NO-OP render: every line shows the same par after 2B as
 * it did under 2A. Two-phase so the baseline is genuinely INDEPENDENT of the
 * backfill (after the backfill re-points + deactivates the old location items,
 * the true pre-cutover value is otherwise unrecoverable):
 *
 *   1. BEFORE the backfill — snapshot the current (2A) resolution per line:
 *        npx tsx --env-file=.env.local scripts/check-par-layer-parity.ts --snapshot
 *      Lines still point at their location items; we record resolveLineDefinition(
 *      line, item, null).par per lineId to a file.
 *   2. AFTER the backfill — verify the 2B resolution matches the snapshot:
 *        npx tsx --env-file=.env.local scripts/check-par-layer-parity.ts --verify
 *      Re-resolves each line via its (now global/local) item + that location's
 *      all-days override and diffs against the snapshot. driftCount must be 0.
 *
 * No-arg run does a single-pass sanity comparison (2A-from-current-item vs 2B-
 * with-override) — only meaningful before any divergence exists; prefer the
 * snapshot/verify pair for the real cutover. ALWAYS exits 0 (reporting tool).
 *
 * Snapshot file: PARITY_SNAPSHOT_PATH, else <tmpdir>/par-layer-parity-snapshot.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { TEMPLATE_ITEM_COLUMNS, rowToTemplateItem, type TemplateItemRow } from "@/lib/template-items";
import {
  loadItemDefns,
  loadItemOverrides,
  operationalDayOfWeek,
  pickOverride,
  resolveLineDefinition,
} from "@/lib/items";
import type { SupabaseClient } from "@supabase/supabase-js";

const SNAPSHOT_PATH = process.env["PARITY_SNAPSHOT_PATH"] ?? join(tmpdir(), "par-layer-parity-snapshot.json");

type Line = ReturnType<typeof rowToTemplateItem>;

/** Load active prep/openingP2 lines + their template (type + location). */
async function loadLines(sb: SupabaseClient): Promise<{ lines: Line[]; locById: Map<string, string> }> {
  const { data: tmpls, error: tErr } = await sb
    .from("checklist_templates")
    .select("id, type, location_id")
    .in("type", ["prep", "opening"])
    .eq("active", true);
  if (tErr) throw new Error(tErr.message);
  const tmplById = new Map(
    ((tmpls ?? []) as Array<{ id: string; type: string; location_id: string }>).map((t) => [t.id, t]),
  );

  const { data: rows, error } = await sb
    .from("checklist_template_items")
    .select(TEMPLATE_ITEM_COLUMNS)
    .in("template_id", [...tmplById.keys()])
    .eq("active", true);
  if (error) throw new Error(error.message);

  const locById = new Map<string, string>();
  const lines = ((rows ?? []) as TemplateItemRow[])
    .map(rowToTemplateItem)
    .filter((ln) => {
      const t = tmplById.get(ln.templateId);
      if (!t) return false;
      const keep = t.type === "prep" || (t.type === "opening" && (ln.prepMeta as { openingPhase2?: boolean } | null)?.openingPhase2 === true);
      if (keep) locById.set(ln.id, t.location_id);
      return keep;
    });
  return { lines, locById };
}

/** 2A resolution: the line's currently-linked item default_par, overrides-unaware. */
async function resolve2A(sb: SupabaseClient, lines: Line[]): Promise<Map<string, number | null>> {
  const itemDefns = await loadItemDefns(sb, lines.map((l) => l.itemId).filter((x): x is string => !!x));
  const out = new Map<string, number | null>();
  for (const ln of lines) {
    const item = ln.itemId ? itemDefns.get(ln.itemId) ?? null : null;
    out.set(ln.id, resolveLineDefinition(ln, item, null).par);
  }
  return out;
}

/** 2B resolution: linked item + the line's location's all-days override. */
async function resolve2B(
  sb: SupabaseClient,
  lines: Line[],
  locById: Map<string, string>,
): Promise<{ par: Map<string, number | null>; linesWithoutItem: number; linesWithoutOverride: number }> {
  const itemDefns = await loadItemDefns(sb, lines.map((l) => l.itemId).filter((x): x is string => !!x));
  const idsByLoc = new Map<string, string[]>();
  for (const ln of lines) {
    if (!ln.itemId) continue;
    const loc = locById.get(ln.id);
    if (!loc) continue;
    const arr = idsByLoc.get(loc) ?? [];
    arr.push(ln.itemId);
    idsByLoc.set(loc, arr);
  }
  const ovrByLoc = new Map<string, Awaited<ReturnType<typeof loadItemOverrides>>>();
  for (const [loc, ids] of idsByLoc) ovrByLoc.set(loc, await loadItemOverrides(sb, ids, loc));

  const dow = operationalDayOfWeek(new Date().toISOString().slice(0, 10));
  const par = new Map<string, number | null>();
  let linesWithoutItem = 0;
  let linesWithoutOverride = 0;
  for (const ln of lines) {
    const item = ln.itemId ? itemDefns.get(ln.itemId) ?? null : null;
    if (!item) linesWithoutItem++;
    const loc = locById.get(ln.id);
    const rows = ln.itemId && loc ? ovrByLoc.get(loc)?.get(ln.itemId) ?? [] : [];
    const override = pickOverride(rows, dow);
    if (item && !override) linesWithoutOverride++;
    par.set(ln.id, resolveLineDefinition(ln, item, override).par);
  }
  return { par, linesWithoutItem, linesWithoutOverride };
}

async function main() {
  const sb = getServiceRoleClient();
  const mode = process.argv.includes("--snapshot") ? "snapshot" : process.argv.includes("--verify") ? "verify" : "single";
  const { lines, locById } = await loadLines(sb);

  if (mode === "snapshot") {
    const before = await resolve2A(sb, lines);
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(Object.fromEntries(before), null, 2));
    console.log(JSON.stringify({ mode, snapshotPath: SNAPSHOT_PATH, lineCount: before.size }, null, 2));
    return;
  }

  const { par: after, linesWithoutItem, linesWithoutOverride } = await resolve2B(sb, lines, locById);

  let baseline: Map<string, number | null>;
  let baselineSource: string;
  if (mode === "verify") {
    const snap = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, number | null>;
    baseline = new Map(Object.entries(snap));
    baselineSource = `snapshot@${SNAPSHOT_PATH}`;
  } else {
    baseline = await resolve2A(sb, lines); // single-pass: current-item-without-override
    baselineSource = "single-pass(current item, no override)";
  }

  const drift: Array<{ lineId: string; before: number | null; after: number | null }> = [];
  const missingFromSnapshot: string[] = [];
  for (const ln of lines) {
    if (!baseline.has(ln.id)) { missingFromSnapshot.push(ln.id); continue; }
    const b = baseline.get(ln.id) ?? null;
    const a = after.get(ln.id) ?? null;
    if (b !== a) drift.push({ lineId: ln.id, before: b, after: a });
  }
  const droppedSinceSnapshot = [...baseline.keys()].filter((id) => !after.has(id));

  console.log(
    JSON.stringify(
      {
        mode,
        baselineSource,
        activeLines: lines.length,
        linesWithoutItem,
        linesWithoutOverride,
        driftCount: drift.length,
        drift,
        missingFromSnapshot,
        droppedSinceSnapshot,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(0); // reporting tool — always exit 0
  });
