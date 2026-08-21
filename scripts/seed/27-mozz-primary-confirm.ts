/**
 * Seed 27 — FRESH MOZZARELLA: the last inferred primary, CONFIRMED OUT LOUD.
 *
 * Juan, 2026-08-21, verbal: **"mozz is pfg confirmed"**.
 *
 * ── WHAT WAS OPEN ────────────────────────────────────────────────────────────
 * Nine products carry a primary. Eight were explicit: Ham was named outright,
 * ICEBERG was ruled on 2026-08-21, and the other seven were proposed defaults Juan
 * read and confirmed in one sitting. **Fresh Mozzarella was the only one where WE
 * picked the side.** Juan gave the SHAPE on 2026-08-20 ("both — one primary, one
 * backup") and never named which vendor; seed 18 inferred PFG from the same
 * evidence shape as ham, seed 24 wrote the row with `primary_is_inferred: true`,
 * and docs/ROADMAP.md has carried it as the one open inference ever since.
 *
 * He has now named the side. It is PFG — the same answer, but now it is HIS answer
 * rather than ours, and that difference is the entire reason the flag existed.
 * Nothing about resolution changes. What changes is what the record CLAIMS about
 * where the decision came from, which is exactly the point: an inference that
 * hardens into a fact unnoticed is the failure seed 18's flag was built to prevent.
 *
 * ── TWO WRITES, AND WHY IT IS TWO ────────────────────────────────────────────
 *   (1) `product_primaries.note` — a MUTABLE column, so it is corrected in place
 *       with a rowcount check (UPDATE denials are silent on Postgres; the count is
 *       the only signal). Paired with a `product.primary_set` audit row, because a
 *       write to product_primaries gets an audit row whatever it changed.
 *
 *   (2) `audit.metadata_correction` — the seed-24 audit row still says
 *       `primary_is_inferred: true`, and that row is IMMUTABLE. **Audit rows are
 *       never UPDATEd** (AGENTS.md); a corrective row that names the row it
 *       corrects is the only path. The original stays exactly as written — it was
 *       true when written, and the trail should show an inference being retired
 *       rather than an inference that was never there.
 *
 * The primary itself is NOT rewritten: `primary_sku_id` already points at PFG and
 * re-pointing a row at the value it already holds would be a write that claims a
 * change nobody made.
 *
 * ── IDEMPOTENT ───────────────────────────────────────────────────────────────
 * Re-reads live and SKIPS when the note already carries the confirmation marker.
 * A second `--execute` reports "already" and writes nothing — including no second
 * corrective audit row, which would otherwise accumulate one per run.
 *
 * ── DRY RUN IS THE DEFAULT ───────────────────────────────────────────────────
 * Running with no arguments WRITES NOTHING. Writing requires `--execute`.
 *
 * Run: npx tsx --conditions=react-server --env-file=.env.local \
 *        scripts/seed/27-mozz-primary-confirm.ts             -> DRY RUN
 *      ... 27-mozz-primary-confirm.ts --execute              -> WRITES
 *
 * NOTE on --conditions=react-server: lib/supabase-server.ts carries `import
 * "server-only"`; under plain tsx that resolves to its throwing entry point and the
 * seed dies on import. The react-server condition resolves it to the empty stub.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { pathToFileURL } from "node:url";

const SCRIPT = "scripts/seed/27-mozz-primary-confirm.ts";
const PHASE = "product_identity_primary_confirmation";
const REASON = "fresh_mozzarella_primary_confirmed_by_juan";

const EXECUTE = process.argv.includes("--execute");

const PRODUCT_NAME = "Fresh Mozzarella";
const EXPECTED_VENDOR = "PFG";

/** Juan's words, verbatim. A ruling paraphrased into code is a ruling nobody can
 *  audit — the same discipline as GARLIC_RATIFICATION in lib/angel-wave4.ts. */
const RULING = 'Juan 2026-08-21, verbal: "mozz is pfg confirmed".';

/** Present in the note ⇒ the confirmation already landed. The idempotency key. */
const CONFIRMED_MARKER = "Juan 2026-08-21 (explicit, verbal)";

const CONFIRMED_NOTE =
  `${CONFIRMED_MARKER} — CONFIRMED. ${RULING} ` +
  "SUPERSEDES the 2026-08-20 shape-only ruling plus seed 18's side INFERENCE: Juan named the " +
  "shape (\"both — one primary, one backup\") without naming which vendor, and PFG was read off " +
  "the same evidence shape as ham (`CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] is a PFG row, " +
  "$1,365.90/yr). He has now named the side himself and it is PFG — the inference is RETIRED, " +
  "not merely re-stated. The prior audit row (product.primary_set, seed 24) still reads " +
  "`primary_is_inferred: true` and is corrected by an appended audit.metadata_correction row, " +
  "never edited. This was the LAST inferred primary; every primary is now explicit.";

function p(text = ""): void {
  console.log(text);
}

interface PrimaryRow {
  id: string;
  product_id: string;
  location_id: string | null;
  primary_sku_id: string;
  note: string | null;
}

async function main(): Promise<void> {
  const sb = getServiceRoleClient();

  p(`\n─── SEED 27 — FRESH MOZZARELLA PRIMARY CONFIRM (${EXECUTE ? "EXECUTE" : "DRY RUN"}) ───\n`);
  p(RULING);
  p();

  // ── Resolve by NAME, then verify every id, rather than trusting a hardcoded
  //    uuid. The catalog holds TWIN SKUs sharing this name; a script that cannot
  //    tell them apart has no business writing a decision about them.
  const { data: product, error: pErr } = await sb
    .from("products")
    .select("id, name, active")
    .eq("name", PRODUCT_NAME)
    .maybeSingle<{ id: string; name: string; active: boolean | null }>();
  if (pErr) throw new Error(`product lookup: ${pErr.message}`);
  if (!product) throw new Error(`FATAL: no product named ${PRODUCT_NAME}. Nothing to confirm.`);

  // The GLOBAL row (location_id NULL = the house idiom). A per-location override
  // would be a different decision and is deliberately not in scope.
  const { data: primary, error: prErr } = await sb
    .from("product_primaries")
    .select("id, product_id, location_id, primary_sku_id, note")
    .eq("product_id", product.id)
    .is("location_id", null)
    .maybeSingle<PrimaryRow>();
  if (prErr) throw new Error(`primary lookup: ${prErr.message}`);
  if (!primary) throw new Error(`FATAL: ${PRODUCT_NAME} has no global primary row. Nothing to confirm.`);

  const { data: sku, error: sErr } = await sb
    .from("vendor_items")
    .select("id, name, active, product_id, vendors(name)")
    .eq("id", primary.primary_sku_id)
    .maybeSingle<{
      id: string;
      name: string;
      active: boolean | null;
      product_id: string | null;
      vendors: { name: string } | null;
    }>();
  if (sErr) throw new Error(`sku lookup: ${sErr.message}`);
  if (!sku) throw new Error(`FATAL: primary_sku_id ${primary.primary_sku_id} does not resolve.`);

  const vendorName = sku.vendors?.name ?? null;
  p(`Product        ${product.name} (${product.id})`);
  p(`Primary row    ${primary.id} · location_id NULL (global)`);
  p(`Primary SKU    ${sku.name} · ${vendorName ?? "?"} (${sku.id}) · active=${sku.active}`);
  p();

  // ── THE GUARD THAT MATTERS ───────────────────────────────────────────────────
  // Juan confirmed PFG. If the live primary is NOT PFG, then the world moved since
  // the ruling was relayed and this script must NOT quietly stamp "confirmed" onto
  // whatever it happens to find. Confirming the wrong vendor is worse than
  // confirming nothing.
  if (vendorName !== EXPECTED_VENDOR) {
    throw new Error(
      `FATAL: the ruling confirms ${EXPECTED_VENDOR} as ${PRODUCT_NAME}'s primary, but the live ` +
        `primary is ${vendorName ?? "(no vendor)"}. Refusing to stamp a confirmation onto a ` +
        "primary Juan did not name. Re-check with him before re-running.",
    );
  }
  if (sku.product_id !== product.id) {
    throw new Error(
      `FATAL: primary SKU ${sku.id} is not a member of ${PRODUCT_NAME} (product_id ` +
        `${sku.product_id ?? "NULL"}). Membership is DB-proven; refusing.`,
    );
  }

  if (primary.note != null && primary.note.includes(CONFIRMED_MARKER)) {
    p("= Already confirmed — the note carries the 2026-08-21 marker. Nothing to write.");
    p("\nSeed 27 done (no-op).");
    return;
  }

  // ── The stale audit row this correction targets ─────────────────────────────
  const { data: staleRows, error: aErr } = await sb
    .from("audit_log")
    .select("id, occurred_at, metadata")
    .eq("action", "product.primary_set")
    .eq("resource_id", product.id)
    .order("occurred_at", { ascending: false })
    .returns<Array<{ id: string; occurred_at: string; metadata: Record<string, unknown> | null }>>();
  if (aErr) throw new Error(`audit lookup: ${aErr.message}`);

  // Only rows that actually CLAIM the inference need correcting. Selecting on the
  // claim rather than on recency means a re-run cannot invent a target.
  const inferredRows = (staleRows ?? []).filter((r) => r.metadata?.primary_is_inferred === true);

  p(`Note today     ${primary.note == null ? "(none)" : `"${primary.note.slice(0, 110)}…"`}`);
  p(
    `Audit rows claiming primary_is_inferred: true — ${inferredRows.length}` +
      (inferredRows.length === 0 ? " (nothing to correct; the note update still applies)" : ""),
  );
  for (const r of inferredRows) p(`  · ${r.id} @ ${r.occurred_at.slice(0, 10)}`);
  p();

  if (!EXECUTE) {
    p("Would UPDATE product_primaries.note -> the confirmed text (1 row).");
    p(`Would APPEND 1 product.primary_set audit row + ${inferredRows.length} audit.metadata_correction row(s).`);
    p("**NOTHING WAS WRITTEN.**");
    return;
  }

  // ── (1) The mutable column, with a rowcount check ────────────────────────────
  // Guarded on the note we actually read, so a concurrent writer cannot be
  // silently clobbered — the same re-read-at-write-time invariant as seed 26.
  const { error: uErr, count } = await sb
    .from("product_primaries")
    .update({ note: CONFIRMED_NOTE }, { count: "exact" })
    .eq("id", primary.id)
    .eq("primary_sku_id", primary.primary_sku_id);
  if (uErr) throw new Error(`note update: ${uErr.message}`);
  // UPDATE denials are silent on Postgres — the rowcount is the only signal.
  if (count === 0) {
    throw new Error(
      "note update affected 0 rows — the primary moved between read and write. " +
        "Nothing was written; re-run to pick up the new state.",
    );
  }
  p(`✓ product_primaries.note updated (${count} row).`);

  await audit({
    actorId: null,
    actorRole: null,
    action: "product.primary_set",
    resourceTable: "product_primaries",
    resourceId: product.id,
    metadata: {
      product_name: product.name,
      location_id: null,
      primary_sku_id: primary.primary_sku_id,
      primary_vendor: vendorName,
      // THE POINT OF THE WHOLE SCRIPT.
      primary_is_inferred: false,
      // NOT a confirmed default: this side was never proposed to him as a decision
      // row — it was inferred, carried flagged, and he has now overridden the flag
      // by naming the side himself. Those are different provenances and seed 24
      // established that the trail distinguishes them.
      confirms_proposed_default: false,
      decided_by: "Juan 2026-08-21 (explicit, verbal)",
      ruling: RULING,
      basis:
        "Juan named the SIDE, which the 2026-08-20 ruling left open. The primary itself is " +
        "unchanged (PFG, already live); what changed is that it is no longer an inference.",
      supersedes:
        "seed 18's PFG side-inference + seed 24's product_primaries row written with " +
        "primary_is_inferred: true (Juan 2026-08-20 gave the shape only)",
      value_unchanged: true,
      changed: ["note"],
      retires_last_inferred_primary: true,
      phase: PHASE,
      reason: REASON,
      script: SCRIPT,
      actor_context: "seed",
    },
    ipAddress: null,
    userAgent: null,
  });
  p("✓ product.primary_set audit row appended.");

  // ── (2) Corrective rows — NEVER an UPDATE to an audit row ────────────────────
  for (const r of inferredRows) {
    await audit({
      actorId: null,
      actorRole: null,
      action: "audit.metadata_correction",
      resourceTable: "audit_log",
      resourceId: r.id,
      metadata: {
        corrected_audit_ids: [r.id],
        corrected_field: "primary_is_inferred",
        stale_value: true,
        actual_value: false,
        reason:
          `${PRODUCT_NAME}'s primary was recorded as an INFERENCE because Juan's 2026-08-20 ` +
          "ruling gave only the shape (\"both — one primary, one backup\") and never named the " +
          "vendor. That was accurate when written. He named it on 2026-08-21 and it is PFG, so " +
          "the inference is retired.",
        ruling: RULING,
        decided_by: "Juan 2026-08-21 (explicit, verbal)",
        // The original row is untouched and stays readable as what it was: an
        // honest inference, correctly flagged, later resolved.
        original_row_left_intact: true,
        corrected_by_row_in: "product_primaries",
        product_id: product.id,
        product_name: product.name,
        primary_vendor: vendorName,
        detected_during: "the 2026-08-21 follow-up batch closing out Juan's two rulings",
        phase: PHASE,
        reason_code: REASON,
        script: SCRIPT,
        actor_context: "seed",
      },
      ipAddress: null,
      userAgent: null,
    });
    p(`✓ audit.metadata_correction appended for ${r.id}.`);
  }

  p(`\nSeed 27 done (execute). ${PRODUCT_NAME} primary = ${vendorName}, CONFIRMED. No inferred primaries remain.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
