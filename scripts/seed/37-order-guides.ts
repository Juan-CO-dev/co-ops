/**
 * Seed 37: the vendor order guides, from the 2026-09-13 laminate transcription
 * (Vendor Ordering V3-A, spec docs/superpowers/specs/2026-09-16-vendor-ordering-v3a-order-guides-design.md §5).
 *
 * The laminated sheets ARE the order every manager reads while keying or reading out a PO.
 * This seed turns them into rows: one `vendor_order_guides` per vendor, its sections in sheet
 * order, its lines in sheet order, each line pointing at the vendor's SKU when we can match it
 * and at NOTHING when we cannot (a null `sku_id` is an honest "needs a SKU", never a guess).
 *
 * THE LAMINATE IS NOT A VENDOR LIST. `pfg_leonard` carries four vendors' rows (PFG, Leonard
 * Paper, Trimark — plus one Baldor row and one TRANSFER row that are neither an order nor a
 * vendor) and `boars_head` is really two sheets: Boar's Head's own order, and the shop's
 * second sheet of other vendors' items. So rows ROUTE (routeRow) before they place, each
 * vendor's guide names its own sections in its own words (SECTION_NAMES — never a header
 * naming another vendor), and a row we cannot route is REPORTED, never lined.
 *
 * RERUNS NEVER TOUCH A HAND EDIT (spec §5 rule 4). An existing guide this seed created is only
 * ever (a) re-matched on lines whose `sku_id` is still null and (b) appended with sheet rows
 * that have no line yet; nothing is moved, relabelled or removed. A guide whose `source_note`
 * does not start with `[order-guides-2026-09-13` was made by hand and is REFUSED in full.
 *
 * Dry-run default. CC runs sim, then prod; this module never loads an env file.
 * npx tsx --conditions=react-server --env-file=.env.sim scripts/seed/37-order-guides.ts --target sim --dry-run
 * --target sim|prod [--dry-run | --execute --plan-digest <dry-run digest>]
 * (--conditions=react-server is required, as for seed 26: the audit helper's module graph
 *  reaches `server-only`, whose default entry throws outside the react-server condition.)
 * Seed 26 guards unchanged; direct writes follow seeds 31–36 (not a transaction; an interrupted
 * guide refuses on retry for CC to reconcile). Audit action `vendor.order_guide.seeded` is
 * registered in lib/audit-actions.ts.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, type RawRow } from "@/lib/angel-wave7";
import type { AuditAction } from "@/lib/audit-actions";
import { norm } from "@/lib/po-match-shared";
import { createWave7Client, loadAll, validateTarget } from "./26-angel-wave7";

export const SOURCE = "order-guides-2026-09-13";
const TRANSCRIPTION = "../../docs/seed/source/order-guide-2026-09-13.json";
const REPORT_DIR = ".claude/council/2026-09-09-launch-readiness/outputs";

export type SheetName = "pfg_leonard" | "boars_head";
export interface SheetRow { section: string; item: string; item_number?: string; par?: string; vendor?: string; pack_note?: string; note?: string }
export type Sheets = Record<SheetName, SheetRow[]>;
export type Tables = Record<"vendors" | "vendor_items" | "vendor_order_guides" | "order_guide_sections" | "order_guide_lines", RawRow[]>;

/** Sheet order is the guide order; `boars_head`'s second-sheet rows land after the laminate's. */
const SHEET_ORDER: readonly SheetName[] = ["pfg_leonard", "boars_head"];
/** Whose report a row that routes nowhere belongs to when its vendor key names no plan. */
const SHEET_OWNER: Record<SheetName, string> = { pfg_leonard: "PFG", boars_head: "Boar's Head" };

/**
 * Per-vendor section naming (spec §5 rule 1). The laminate's mixed "Leonard Paper / Trimark"
 * block is split by vendor, and each guide names the block in ITS OWN words — a Trimark guide
 * never carries a header naming Leonard Paper. `satisfies` keeps the literal keys so a caller
 * (and the test) can read a known entry without an undefined check.
 */
export const SECTION_NAMES = {
  "Leonard Paper": { "Packaging (Leonard Paper)": "Packaging", "Leonard Paper / Trimark": "Leonard Paper" },
  Trimark: { "Leonard Paper / Trimark": "Trimark" },
} satisfies Record<string, Record<string, string>>;
/** Laminate vendor keys → the live `vendors.name`. The transcription writes "Leonard"; the catalog says "Leonard Paper". */
const VENDOR_KEY: Record<string, string> = { PFG: "PFG", Leonard: "Leonard Paper", "Leonard Paper": "Leonard Paper", TRIMARK: "Trimark", Trimark: "Trimark" };
/** The only `boars_head` sections that are actually Boar's Head's own order. */
const BH_SECTIONS = new Set(["Boar's Head", "Peppers"]);

const sectionMap = (vendor: string): Record<string, string> => (SECTION_NAMES as Record<string, Record<string, string>>)[vendor] ?? {};

/**
 * Where one sheet row belongs, before any SKU is matched. `vendor` is a live vendor NAME, or
 * "by_sku" (the matched SKU's vendor decides), or "report" (Baldor / TRANSFER / an unknown key:
 * reported, never lined).
 */
export function routeRow(sheet: SheetName, row: SheetRow): { vendor: string; section: string } {
  if (sheet === "pfg_leonard") {
    const v = VENDOR_KEY[row.vendor ?? ""];
    if (!v) return { vendor: "report", section: row.section };
    return { vendor: v, section: sectionMap(v)[row.section] ?? row.section };
  }
  return BH_SECTIONS.has(row.section) ? { vendor: "Boar's Head", section: "Boar's Head" } : { vendor: "by_sku", section: row.section };
}

export interface PlanLine { label: string; itemNumber: string | null; skuId: string | null; candidates: string[] }
export interface PlanSection { name: string; lines: PlanLine[] }
export interface Plan {
  vendor: string; vendorId: string;
  kind: "sheet" | "starter";
  status: "ready" | "already" | "refused";
  name: string; sourceNote: string;
  sections: PlanSection[];
  rematch: { lineId: string; skuId: string }[];
  append: { sectionName: string; line: PlanLine }[];
  report: string[];
  reason?: string;
  before: unknown;
  expected: RawRow;
}

const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const active = (rows: readonly RawRow[]) => rows.filter(r => r.active === true);
const str = (v: unknown): string => String(v ?? "");
const byName = (a: RawRow, b: RawRow) => str(a.name).localeCompare(str(b.name));
const pos = (r: RawRow) => Number(r.position ?? 0);
/** "N/A" and "" are the laminate's way of writing "no item number"; both mean null. */
const cleanItemNumber = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return t === "" || t.toUpperCase() === "N/A" ? null : t;
};

interface SkuMatch { sku: RawRow | null; rule: "item_number" | "exact_name" | "contains" | null; candidates: RawRow[] }
/**
 * The three match rules, in order (spec §5 rule 2): exact item number, exact normalized name,
 * unambiguous name-contains. More than one candidate at any rung is AMBIGUOUS and matches
 * nothing — the report is the resolution path, never a coin flip.
 */
function matchSku(label: string, itemNumber: string | null, candidates: readonly RawRow[]): SkuMatch {
  if (itemNumber) {
    const hits = candidates.filter(c => cleanItemNumber(c.item_number) != null && norm(str(c.item_number)) === norm(itemNumber));
    if (hits.length === 1) return { sku: hits[0]!, rule: "item_number", candidates: hits };
    if (hits.length > 1) return { sku: null, rule: null, candidates: hits };
  }
  const l = norm(label);
  if (l == null) return { sku: null, rule: null, candidates: [] };
  const exact = candidates.filter(c => norm(str(c.name)) === l);
  if (exact.length === 1) return { sku: exact[0]!, rule: "exact_name", candidates: exact };
  if (exact.length > 1) return { sku: null, rule: null, candidates: exact };
  const contains = candidates.filter(c => (norm(str(c.name)) ?? "").includes(l));
  if (contains.length === 1) return { sku: contains[0]!, rule: "contains", candidates: contains };
  return { sku: null, rule: null, candidates: contains };
}

interface Draft { vendor: string; vendorId: string; sections: Map<string, PlanLine[]>; report: string[]; placed: Map<string, string> }

/**
 * PURE planner: the pinned transcription against the live catalog. Never reads a file — main()
 * hands it the sheets — and never writes. One plan per vendor that either has sheet rows
 * ("sheet") or has active SKUs and no guide of its own ("starter", spec §5 rule 5).
 */
export function planOrderGuides(t: Tables, sheets: Sheets): Plan[] {
  const activeVendors = active(t.vendors);
  const vendorByName = new Map(activeVendors.map(v => [str(v.name), v]));
  const vendorById = new Map(activeVendors.map(v => [str(v.id), v]));
  const activeSkus = active(t.vendor_items);
  const skusByVendor = new Map<string, RawRow[]>();
  for (const s of activeSkus) {
    const key = str(s.vendor_id);
    const list = skusByVendor.get(key);
    if (list) list.push(s); else skusByVendor.set(key, [s]);
  }

  const drafts = new Map<string, Draft>();
  /** Rows that belong to no plan yet; distributed onto plan reports once every plan exists. */
  const loose: { hint: string | null; sheet: SheetName; text: string }[] = [];
  const draftFor = (vendorName: string): Draft | null => {
    const v = vendorByName.get(vendorName);
    if (!v) return null;
    let d = drafts.get(vendorName);
    if (!d) { d = { vendor: vendorName, vendorId: str(v.id), sections: new Map(), report: [], placed: new Map() }; drafts.set(vendorName, d); }
    return d;
  };

  for (const sheet of SHEET_ORDER) {
    const rows = sheets[sheet] ?? [];
    rows.forEach((row, i) => {
      const where = `${sheet} row ${i + 1}`;
      const route = routeRow(sheet, row);
      const itemNumber = cleanItemNumber(row.item_number);
      if (route.vendor === "report") {
        loose.push({ hint: row.vendor ?? null, sheet, text: `reported, not lined: ${row.item} (${where}, section ${route.section}, vendor key ${row.vendor ?? "-"})` });
        return;
      }
      const bySku = route.vendor === "by_sku";
      const vendorRow = bySku ? null : vendorByName.get(route.vendor) ?? null;
      if (!bySku && !vendorRow) {
        loose.push({ hint: route.vendor, sheet, text: `no such active vendor: ${route.vendor} - ${row.item} (${where})` });
        return;
      }
      const candidates = bySku ? activeSkus : skusByVendor.get(str(vendorRow!.id)) ?? [];
      const m = matchSku(row.item, itemNumber, candidates);
      let owner = vendorRow;
      if (bySku) {
        if (!m.sku) {
          loose.push({ hint: null, sheet, text: m.candidates.length
            ? `second sheet, ambiguous, no line: ${row.item} (${where}, ${route.section}) -> ${m.candidates.map(c => str(c.name)).join(", ")}`
            : `second sheet, no match, no line: ${row.item} (${where}, ${route.section})` });
          return;
        }
        owner = vendorById.get(str(m.sku.vendor_id)) ?? null;
        if (!owner) {
          loose.push({ hint: null, sheet, text: `second sheet, matched SKU's vendor is not active, no line: ${row.item} (${where})` });
          return;
        }
      }
      const d = draftFor(str(owner!.name));
      if (!d) { loose.push({ hint: null, sheet, text: `unroutable: ${row.item} (${where})` }); return; }
      const skuId = m.sku ? str(m.sku.id) : null;
      if (skuId && d.placed.has(skuId)) {
        d.report.push(`repeat: ${row.item} (${where}, first at ${d.placed.get(skuId)})`);
        return;
      }
      if (!m.sku) {
        d.report.push(m.candidates.length
          ? `ambiguous: ${row.item} (${where}) -> ${m.candidates.map(c => str(c.name)).join(", ")}`
          : `no match: ${row.item} (${where})`);
      }
      if (skuId) d.placed.set(skuId, where);
      const line: PlanLine = { label: row.item, itemNumber, skuId, candidates: m.sku ? [] : m.candidates.map(c => str(c.name)) };
      const lines = d.sections.get(route.section);
      if (lines) lines.push(line); else d.sections.set(route.section, [line]);
    });
  }

  const plans: Plan[] = [];
  for (const d of drafts.values()) plans.push(buildPlan(t, d, "sheet", skusByVendor.get(d.vendorId) ?? []));
  for (const v of [...activeVendors].sort(byName)) {
    const name = str(v.name);
    if (drafts.has(name)) continue;
    const skus = skusByVendor.get(str(v.id)) ?? [];
    if (skus.length === 0) continue;
    const lines = [...skus].sort(byName).map((s): PlanLine => ({ label: str(s.name), itemNumber: cleanItemNumber(s.item_number), skuId: str(s.id), candidates: [] }));
    const draft: Draft = { vendor: name, vendorId: str(v.id), sections: new Map([[name, lines]]), report: [], placed: new Map(lines.map(l => [l.skuId!, "starter"])) };
    plans.push(buildPlan(t, draft, "starter", skus));
  }

  for (const entry of loose) {
    const hinted = entry.hint ? VENDOR_KEY[entry.hint] ?? entry.hint : null;
    const target = (hinted ? plans.find(p => p.vendor === hinted) : null) ?? plans.find(p => p.vendor === SHEET_OWNER[entry.sheet]) ?? plans[0];
    if (target) target.report.push(entry.text);
  }
  return plans;
}

/** One vendor's plan: the desired sections/lines, plus what a rerun may do to an existing guide. */
function buildPlan(t: Tables, d: Draft, kind: "sheet" | "starter", vendorSkus: readonly RawRow[]): Plan {
  const sections: PlanSection[] = [...d.sections].map(([name, lines]) => ({ name, lines }));
  const name = kind === "starter" ? `${d.vendor} — starter` : `${d.vendor} — laminated guide`;
  const sourceNote = kind === "starter" ? `[${SOURCE} starter]` : `[${SOURCE}]`;
  const p: Plan = { vendor: d.vendor, vendorId: d.vendorId, kind, status: "ready", name, sourceNote, sections, rematch: [], append: [], report: [...d.report], before: null, expected: {} };
  const guide = t.vendor_order_guides.find(g => str(g.vendor_id) === d.vendorId) ?? null;
  const onLine = new Set(sections.flatMap(s => s.lines).filter(l => l.skuId).map(l => l.skuId!));

  if (!guide) {
    p.expected = { vendorId: d.vendorId, guideId: null, guideName: name, sourceNote, guideSections: [], guideLines: [], rematchRows: [] };
    reportUnlinedSkus(p, vendorSkus, onLine);
    return p;
  }

  const guideId = str(guide.id);
  const gSections = t.order_guide_sections.filter(s => str(s.guide_id) === guideId).sort((a, b) => pos(a) - pos(b));
  const sectionIds = new Set(gSections.map(s => str(s.id)));
  const sectionPosById = new Map(gSections.map(s => [str(s.id), pos(s)]));
  const sectionNameById = new Map(gSections.map(s => [str(s.id), str(s.name)]));
  const gLines = t.order_guide_lines.filter(l => sectionIds.has(str(l.section_id)))
    .sort((a, b) => (sectionPosById.get(str(a.section_id)) ?? 0) - (sectionPosById.get(str(b.section_id)) ?? 0) || pos(a) - pos(b));
  p.before = {
    guideId, sourceNote: guide.source_note ?? null,
    sections: gSections.map(s => ({ name: str(s.name), position: pos(s) })),
    lines: gLines.map(l => ({ section: sectionNameById.get(str(l.section_id)) ?? "", label: str(l.label), itemNumber: cleanItemNumber(l.item_number), skuId: l.sku_id == null ? null : str(l.sku_id) })),
  };
  p.expected = {
    vendorId: d.vendorId, guideId, guideName: str(guide.name), sourceNote: guide.source_note ?? null,
    // The editor's concurrency token, carried so a rerun can advance it with the same guarded
    // UPDATE the admin save uses (Astra finding 3) — and so a guide edited between the reviewed
    // dry-run and the execute changes the plan digest instead of being written over.
    guideUpdatedAt: guide.updated_at == null ? null : str(guide.updated_at),
    guideSections: gSections.map(s => ({ id: str(s.id), name: str(s.name), position: pos(s) })),
    guideLines: gLines.map(l => ({ id: str(l.id), sectionId: str(l.section_id), position: pos(l) })),
    rematchRows: [] as RawRow[],
  };
  if (!str(guide.source_note).startsWith(`[${SOURCE}`)) {
    p.status = "refused";
    p.reason = "a guide made by hand (source_note is not this seed's); the seed never touches it";
    p.report.push(`refused: an existing guide for ${d.vendor} was not created by this seed`);
    return p;
  }

  const placedSkus = new Set(gLines.filter(l => l.sku_id != null).map(l => str(l.sku_id)));
  const claimed = new Set<string>();
  const rematchRows: RawRow[] = [];
  for (const l of gLines) {
    if (l.sku_id != null) continue;
    const m = matchSku(str(l.label), cleanItemNumber(l.item_number), vendorSkus);
    if (!m.sku) continue;
    const skuId = str(m.sku.id);
    if (placedSkus.has(skuId) || claimed.has(skuId)) continue;
    claimed.add(skuId);
    rematchRows.push(l);
    p.rematch.push({ lineId: str(l.id), skuId });
  }
  p.expected.rematchRows = rematchRows;

  // A starter guide is created once and never touched again (spec §5 rule 5); only sheet
  // guides gain the rows a later laminate reading adds.
  if (kind === "sheet") {
    const consumed = new Set<string>();
    for (const sec of sections) {
      for (const line of sec.lines) {
        const hit = findExistingLine(gLines, sectionNameById, sec.name, line, consumed);
        if (hit) { consumed.add(str(hit.id)); continue; }
        if (line.skuId && (placedSkus.has(line.skuId) || claimed.has(line.skuId))) {
          p.report.push(`already on the guide under another line, not appended: ${line.label}`);
          continue;
        }
        if (line.skuId) claimed.add(line.skuId);
        p.append.push({ sectionName: sec.name, line });
      }
    }
  }
  for (const l of gLines) if (l.sku_id != null) onLine.add(str(l.sku_id));
  for (const r of p.rematch) onLine.add(r.skuId);
  reportUnlinedSkus(p, vendorSkus, onLine);
  if (p.rematch.length === 0 && p.append.length === 0) p.status = "already";
  return p;
}

/** The existing line a desired row already has: same section first, then anywhere (a manager may have moved it). */
function findExistingLine(gLines: readonly RawRow[], sectionNameById: Map<string, string>, sectionName: string, line: PlanLine, consumed: Set<string>): RawRow | null {
  const same = (l: RawRow) => !consumed.has(str(l.id)) && norm(str(l.label)) === norm(line.label) && cleanItemNumber(l.item_number) === line.itemNumber;
  return gLines.find(l => same(l) && sectionNameById.get(str(l.section_id)) === sectionName) ?? gLines.find(same) ?? null;
}

function reportUnlinedSkus(p: Plan, vendorSkus: readonly RawRow[], onLine: ReadonlySet<string>): void {
  for (const s of [...vendorSkus].sort(byName)) if (!onLine.has(str(s.id))) p.report.push(`active SKU on no line: ${str(s.name)}`);
}

export function validateArgs(args: string[], env: Record<string, string | undefined> = process.env) {
  if (args.filter(a => a === "--dry-run").length > 1 || (args.includes("--dry-run") && args.includes("--execute"))) throw new Error("Conflicting/duplicate dry-run option");
  if (args.some(a => ["--wave7", "--readiness", "--as-of"].includes(a))) throw new Error("Unsupported seed-37 option");
  return validateTarget(args.filter(a => a !== "--dry-run"), env);
}

/** The pinned transcription, resolved from THIS file (never the cwd). */
export function readSheets(): Sheets {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL(TRANSCRIPTION, import.meta.url)), "utf8")) as { sheets?: Partial<Sheets> };
  const sheets = raw.sheets ?? {};
  if (!Array.isArray(sheets.pfg_leonard) || !Array.isArray(sheets.boars_head)) throw new Error("Transcription is missing sheets.pfg_leonard / sheets.boars_head");
  return { pfg_leonard: sheets.pfg_leonard, boars_head: sheets.boars_head };
}

async function readTables(sb: SupabaseClient): Promise<Tables> {
  const names: (keyof Tables)[] = ["vendors", "vendor_items", "vendor_order_guides", "order_guide_sections", "order_guide_lines"];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await loadAll(sb, name)]))) as Tables;
}
async function insert(sb: SupabaseClient, table: string, row: RawRow): Promise<void> {
  const { error } = await sb.from(table).insert(row);
  if (error) throw new Error(`${table}: INSERT failed (${error.code ?? "unknown"} ${error.message}); stop and reconcile`);
}
async function record(sb: SupabaseClient, action: AuditAction, table: string, id: string, p: Plan, extra: RawRow = {}): Promise<void> {
  const { audit } = await import("@/lib/audit");
  const operation = randomUUID();
  await audit({ actorId: null, actorRole: null, action, resourceTable: table, resourceId: id, metadata: { source: SOURCE, operation, source_note: p.sourceNote, vendor: p.vendor, before: p.before, after: { kind: p.kind, sections: p.sections, rematch: p.rematch, append: p.append }, ...extra }, ipAddress: null, userAgent: null });
  const { data, error } = await sb.from("audit_log").select("id").eq("action", action).eq("resource_id", id).contains("metadata", { source: SOURCE, operation });
  if (error || data?.length !== 1) throw new Error(`${table}: audit readback failed; stop and reconcile (audit helper is fail-open)`);
}

/** Writes the plan: a whole new guide, or a rerun's re-matches and appends. One audit row, on the guide. */
async function apply(sb: SupabaseClient, p: Plan): Promise<void> {
  const existingId = p.expected.guideId == null ? null : String(p.expected.guideId);
  if (!existingId) {
    const guideId = randomUUID();
    await insert(sb, "vendor_order_guides", { id: guideId, vendor_id: p.vendorId, name: p.name, source_note: p.sourceNote });
    for (const [i, section] of p.sections.entries()) {
      const sectionId = randomUUID();
      await insert(sb, "order_guide_sections", { id: sectionId, guide_id: guideId, name: section.name, position: i + 1 });
      for (const [j, line] of section.lines.entries()) {
        await insert(sb, "order_guide_lines", { id: randomUUID(), section_id: sectionId, position: j + 1, sku_id: line.skuId, label: line.label, item_number: line.itemNumber, note: null });
      }
    }
    await record(sb, "vendor.order_guide.seeded", "vendor_order_guides", guideId, p, { vendor_id: p.vendorId, guide_id: guideId, creation_method: "seed_script" });
    return;
  }
  // A RERUN IS ONE TRANSACTION, BEHIND THE GUIDE'S OWN LOCK (Astra r2-1, BC-007; migration
  // 0208). Every rematch and every append used to commit on its own, and the guarded token
  // bump ran only afterwards — so a manager saving MID-RERUN won: the re-match was cleared or
  // the appended line deleted, the manager was told "Saved", and the seed learned the token
  // was stale AFTER the loss, with nothing rolled back. A failure halfway through left
  // committed rows behind an unadvanced token. `rerun_order_guide` takes the same
  // `for update` lock the admin editor takes, refuses a stale token BEFORE writing anything,
  // and advances the token in the same transaction as the writes. Nothing here writes rows.
  //
  // The RPC's own rule is the idempotency rule (spec §5 rule 4): it fills a line only while
  // `sku_id is null`, so a line a manager resolved by hand is `rematch_conflict`, never
  // overwritten. Appends land dense at the end of their section, and a section the laminate
  // grew since the last run is created LAST, never among the manager's own.
  const { error: rerunErr } = await sb.rpc("rerun_order_guide", {
    p_guide_id: existingId,
    p_expected_updated_at: p.expected.guideUpdatedAt == null ? null : String(p.expected.guideUpdatedAt),
    p_rematches: p.rematch.map(r => ({ lineId: r.lineId, skuId: r.skuId })),
    p_appends: p.append.map(a => ({ sectionName: a.sectionName, label: a.line.label, itemNumber: a.line.itemNumber, skuId: a.line.skuId })),
  });
  if (rerunErr) throw new Error(`${p.vendor}: rerun_order_guide refused (${rerunErr.message}); nothing was written, stop and reconcile`);
  await record(sb, "vendor.order_guide.seeded", "vendor_order_guides", existingId, p, { vendor_id: p.vendorId, guide_id: existingId, creation_method: "seed_script_rerun" });
}

async function verifyAudits(sb: SupabaseClient, p: Plan): Promise<void> {
  const guideId = p.expected.guideId == null ? null : String(p.expected.guideId);
  if (!guideId) throw new Error(`${p.vendor}: no guide to verify`);
  const { data, error } = await sb.from("audit_log").select("id").eq("action", "vendor.order_guide.seeded").eq("resource_id", guideId).contains("metadata", { source: SOURCE }).limit(1);
  if (error || !data?.length) throw new Error(`${p.vendor}: missing provenance audit on the guide; reconcile before retry`);
}

/**
 * Nothing changed but this plan's own guide. Allowed: new rows in the three guide tables that
 * belong to this vendor's guide, and `sku_id` on the lines this plan re-matched. Nothing else —
 * not a vendor, not a SKU, not another vendor's guide.
 */
export function verifyWriteScope(before: Tables, after: Tables, p: Plan): void {
  const guideIds = new Set(after.vendor_order_guides.filter(g => str(g.vendor_id) === p.vendorId).map(g => str(g.id)));
  const sectionIds = new Set(after.order_guide_sections.filter(s => guideIds.has(str(s.guide_id))).map(s => str(s.id)));
  const rematchIds = new Set(p.rematch.map(r => r.lineId));
  // A rerun advances this guide's own `updated_at` (Astra finding 3) — the one column outside
  // the added-rows allowance that a rerun is permitted to move, and only on its own guide.
  const rerunGuideId = p.expected.guideId == null ? null : String(p.expected.guideId);
  for (const table of Object.keys(before) as (keyof Tables)[]) {
    const allowed = (r: RawRow): string[] =>
      table === "order_guide_lines" && rematchIds.has(str(r.id)) ? ["sku_id"]
      : table === "vendor_order_guides" && rerunGuideId !== null && str(r.id) === rerunGuideId ? ["updated_at"]
      : [];
    const addedAllowed = (r: RawRow) =>
      (table === "vendor_order_guides" && str(r.vendor_id) === p.vendorId)
      || (table === "order_guide_sections" && guideIds.has(str(r.guide_id)))
      || (table === "order_guide_lines" && sectionIds.has(str(r.section_id)));
    const oldIds = new Set(before[table].map(r => str(r.id)));
    const normalize = (rows: RawRow[]) => rows.map(r => Object.fromEntries(Object.entries(r).filter(([key]) => !allowed(r).includes(key)))).sort((a, b) => str(a.id).localeCompare(str(b.id)));
    const existingAfter = after[table].filter(r => oldIds.has(str(r.id)) || !addedAllowed(r));
    if (!equal(normalize(before[table]), normalize(existingAfter))) throw new Error(`${p.vendor}: unrelated/concurrent ${table} change; stop for a fresh reviewed dry-run`);
  }
}

const counts = (p: Plan) => {
  const lines = p.sections.flatMap(s => s.lines);
  return {
    lines: lines.length,
    matched: lines.filter(l => l.skuId).length,
    unmatchedWithCandidates: lines.filter(l => !l.skuId && l.candidates.length > 0).length,
    unmatchedNone: lines.filter(l => !l.skuId && l.candidates.length === 0).length,
  };
};

/** The report is the resolution path for everything the rules could not decide (spec §5 rule 6). */
export function renderReport(target: string, digest: string, plans: readonly Plan[]): string {
  const out: string[] = [`seed 37 — order guides — ${SOURCE} — target ${target}`, `plan digest: ${digest}`, ""];
  for (const p of plans) {
    const c = counts(p);
    out.push(`${p.vendor} — ${p.kind} — ${p.status}${p.reason ? ` (${p.reason})` : ""}`);
    out.push(`  ${p.sections.length} sections, ${c.lines} lines: ${c.matched} matched, ${c.unmatchedWithCandidates} unmatched with candidates, ${c.unmatchedNone} unmatched with none; rerun: ${p.rematch.length} re-matched, ${p.append.length} appended`);
    for (const line of p.report) out.push(`  - ${line}`);
    out.push("");
  }
  return out.join("\n");
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const config = validateArgs(args), sb = createWave7Client(config);
  const sheets = readSheets();
  let expectedTables = await readTables(sb);
  const plans = planOrderGuides(expectedTables, sheets);
  const digest = createHash("sha256").update(canonical({ project: config.projectRef, source: SOURCE, plans })).digest("hex");
  console.log(`${SOURCE}: ${config.execute ? "EXECUTE" : "DRY RUN"}, target ${config.target}`);
  console.table(plans.map(p => {
    const c = counts(p);
    return { vendor: p.vendor, kind: p.kind, status: p.status, sections: p.sections.length, lines: c.lines, matched: c.matched, unmatched: c.unmatchedWithCandidates + c.unmatchedNone, rematch: p.rematch.length, append: p.append.length, reports: p.report.length, refusal: p.reason ?? "" };
  }));
  console.log(`Plan digest: ${digest}`);
  const report = renderReport(config.target, digest, plans);
  const reportPath = `${REPORT_DIR}/seed37-report-${config.target}.txt`;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, { encoding: "utf8" });
  console.log(report);
  console.log(`Report: ${reportPath}`);
  if (!config.execute) { console.log("No writes. Execute with the same --target and --execute --plan-digest shown above."); return; }
  if (plans.every(p => p.status === "already")) { for (const p of plans) { await verifyAudits(sb, p); console.log(`already: ${p.vendor}`); } return; }
  if (config.planDigest !== digest) throw new Error("Plan changed; review a fresh dry-run");
  if (plans.some(p => p.status === "refused")) throw new Error("Refused before-state(s); no writes. Resolve ledger before execute.");
  for (const p of plans) {
    const tables = await readTables(sb);
    if (!equal(tables, expectedTables)) throw new Error("Database changed after reviewed snapshot; no further writes");
    const current = planOrderGuides(tables, sheets).find(r => r.vendor === p.vendor);
    if (!current) throw new Error(`${p.vendor}: plan disappeared between the reviewed snapshot and execution`);
    if (current.status === "already") { await verifyAudits(sb, current); console.log(`already: ${p.vendor}`); continue; }
    if (current.status !== "ready") throw new Error(`${p.vendor}: before-state changed during execution`);
    await apply(sb, current);
    const afterTables = await readTables(sb);
    verifyWriteScope(tables, afterTables, current);
    const verified = planOrderGuides(afterTables, sheets).find(r => r.vendor === p.vendor);
    if (!verified || verified.status !== "already") throw new Error(`${p.vendor}: destination verification failed (${verified?.status ?? "missing"}: ${verified?.reason ?? ""}); reconcile partial operation`);
    await verifyAudits(sb, verified);
    expectedTables = afterTables;
    console.log(`verified: ${p.vendor}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e instanceof Error ? e.message : "Seed 37 failed"); process.exitCode = 1; });
}
