import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/supabase-paginate";
import { isPrepData } from "@/lib/prep";
import { REPORTS_HUB_CASH_LEVEL, REPORTS_HUB_NOTES_LEVEL, type ReportListItem } from "@/lib/reports-hub";

const OPERATIONAL_TZ = "America/New_York";
function opDate(tstz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OPERATIONAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(tstz));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/**
 * Reports Hub quick-find (Phase 1). Pure case-insensitive substring match over
 * the fields already on an authorized list row — submitter name + report type.
 * No tier-sensitive fields are touched (deep authorized-content search is a
 * separate Phase-2 cycle), so this never widens disclosure: it only filters a
 * list the viewer can already see in full.
 */
export function matchesReportQuery(
  item: { submitterName: string | null; type: string },
  q: string,
  /** Viewer-localized report-type label (e.g. "Closing" / "Cierre"). */
  typeLabel: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true; // callers skip filtering on blank q; defensive default
  const haystack = `${item.submitterName ?? ""} ${typeLabel} ${item.type}`.toLowerCase();
  return haystack.includes(needle);
}

/** A field of authorized searchable text for one report. `fieldKey` selects
 *  the snippet label (reports.search.snippet_field.<fieldKey>). */
export interface SearchCorpusField {
  fieldKey: "item" | "station" | "completer" | "note" | "cash_note" | "area_to_improve" | "pm_note" | "mvp_note" | "equipment" | "maintenance_note" | "answer";
  text: string;
}

export interface SearchCorpusEntry {
  fields: SearchCorpusField[];
}

export interface SearchSnippet {
  fieldKey: SearchCorpusField["fieldKey"];
  text: string; // ellipsized context window around the match
}

export interface SearchResult {
  matched: boolean;
  snippet?: SearchSnippet;
}

/** Ellipsized ~60-char window centered on the first occurrence of `needle`
 *  (already lowercased) in `text`. */
export function makeSnippet(text: string, needle: string, radius = 28): string {
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Match `q` for one report. Prefers a DEEP field match (returns a snippet);
 * otherwise falls back to the Phase-1 name/type match (matched, no snippet).
 * `entry` is the viewer-authorized corpus (already redacted), so any snippet is safe.
 */
export function searchReport(
  base: { submitterName: string | null; type: string },
  typeLabel: string,
  entry: SearchCorpusEntry | undefined,
  q: string,
): SearchResult {
  const needle = q.trim().toLowerCase();
  if (!needle) return { matched: true };
  // 1. Deep fields first → informative snippet.
  for (const f of entry?.fields ?? []) {
    if (f.text.toLowerCase().includes(needle)) {
      return { matched: true, snippet: { fieldKey: f.fieldKey, text: makeSnippet(f.text, needle) } };
    }
  }
  // 2. Fall back to Phase-1 name/type (no snippet — those fields are already on the row).
  if (matchesReportQuery(base, q, typeLabel)) return { matched: true };
  return { matched: false };
}

/**
 * Build the viewer-authorized searchable corpus for a set of already-authorized
 * report list items. Applies the EXACT detail-loader gates BEFORE returning any
 * text, so a later match/snippet can never disclose a field the viewer can't see:
 *   - item labels / stations / completer names → all viewers
 *   - completion notes + cash over/short note   → L5+ (REPORTS_HUB_NOTES_LEVEL)
 *   - PM area_to_improve → managers (L4+) all evals; employees own only
 *   - PM note / mvp_note → L4+ (note further L5+)
 * Bulk-loaded + paginated (selectAllRows) over the in-window report ids, bound to
 * locationId. Keyed `${type}:${id}`. Build ONLY when q is non-empty (caller gates).
 */
export async function buildSearchCorpus(
  service: SupabaseClient,
  args: { viewer: { userId: string; level: number }; locationId: string; items: ReportListItem[] },
): Promise<Map<string, SearchCorpusEntry>> {
  const corpus = new Map<string, SearchCorpusEntry>();
  const push = (key: string, fieldKey: SearchCorpusField["fieldKey"], text: string | null | undefined) => {
    if (!text || !text.trim()) return;
    let e = corpus.get(key);
    if (!e) { e = { fields: [] }; corpus.set(key, e); }
    e.fields.push({ fieldKey, text });
  };
  const showNotes = args.viewer.level >= REPORTS_HUB_NOTES_LEVEL;
  const isManager = args.viewer.level >= REPORTS_HUB_CASH_LEVEL;

  // ── Checklist reports (opening/closing/am_prep/mid_day) ──
  const checklistItems = args.items.filter((it) => it.type !== "cash" && it.type !== "pm");
  const instanceIds = checklistItems.map((it) => it.id);
  const keyByInstance = new Map(checklistItems.map((it) => [it.id, `${it.type}:${it.id}`] as const));
  if (instanceIds.length) {
    const insts = await selectAllRows<{ id: string; template_id: string }>(
      (from, to) => service.from("checklist_instances").select("id, template_id")
        .eq("location_id", args.locationId).in("id", instanceIds)
        .order("id", { ascending: true }).range(from, to),
    );
    // SECURITY: only the instances that actually belong to the authorized
    // location survive the query above. Bind every downstream read (completions
    // → completer names + notes) to THIS set, not the caller-supplied
    // instanceIds — otherwise a cross-location id smuggled into `items` would
    // still leak its completer names + notes (the location filter lives on the
    // instance row, not on checklist_completions).
    const authorizedInstanceIds = insts.map((r) => r.id);
    const templateIds = [...new Set(insts.map((r) => r.template_id))];

    const titemsByTemplate = new Map<string, { label: string; station: string }[]>();
    // id → label map for the answer corpus field (Slice 3): a check answer
    // is indexed as "<label> <answer>", so we need each completion's template
    // item label keyed by template_item_id.
    const labelByTemplateItem = new Map<string, string>();
    if (templateIds.length) {
      const titems = await selectAllRows<{ id: string; template_id: string; label: string; station: string }>(
        (from, to) => service.from("checklist_template_items").select("id, template_id, label, station")
          .in("template_id", templateIds).eq("active", true)
          .order("template_id", { ascending: true }).range(from, to),
      );
      for (const ti of titems) {
        const arr = titemsByTemplate.get(ti.template_id) ?? [];
        arr.push({ label: ti.label, station: ti.station });
        titemsByTemplate.set(ti.template_id, arr);
        labelByTemplateItem.set(ti.id, ti.label);
      }
    }
    for (const inst of insts) {
      const key = keyByInstance.get(inst.id);
      if (!key) continue;
      for (const ti of titemsByTemplate.get(inst.template_id) ?? []) {
        push(key, "item", ti.label);
        push(key, "station", ti.station);
      }
    }

    const comps = authorizedInstanceIds.length
      ? await selectAllRows<{ instance_id: string; completed_by: string | null; notes: string | null; template_item_id: string; prep_data: unknown }>(
          (from, to) => service.from("checklist_completions").select("instance_id, completed_by, notes, template_item_id, prep_data")
            .in("instance_id", authorizedInstanceIds).is("superseded_at", null).is("revoked_at", null)
            .order("instance_id", { ascending: true }).range(from, to),
        )
      : [];
    const completerIds = [...new Set(comps.map((c) => c.completed_by).filter((v): v is string => !!v))];
    const nameById = new Map<string, string>();
    if (completerIds.length) {
      const { data: users } = await service.from("users").select("id, name").in("id", completerIds);
      for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
    }
    for (const c of comps) {
      const key = keyByInstance.get(c.instance_id);
      if (!key) continue;
      if (c.completed_by) push(key, "completer", nameById.get(c.completed_by));
      if (showNotes) push(key, "note", c.notes);
      // Answer field (Slice 3): yes/no + free-text question answers + Misc items.
      // Indexed for ALL viewers (NOT gated behind showNotes) — matches the
      // drill-in Checks visibility decision. Combined "<label> <answer>" so a
      // label-only search still hits AND the answer carries question context.
      if (isPrepData(c.prep_data)) {
        const inputs = c.prep_data.inputs;
        if (inputs.yesNo !== undefined || inputs.freeText !== undefined) {
          const label = labelByTemplateItem.get(c.template_item_id) ?? "";
          const answerText =
            (inputs.yesNo === true ? "Yes" : inputs.yesNo === false ? "No" : "") +
            (inputs.freeText ? ` ${inputs.freeText}` : "");
          push(key, "answer", `${label} ${answerText}`.trim());
        }
      }
    }
  }

  // ── Cash reports (over/short note, L5+ only) ──
  if (showNotes) {
    const cashIds = args.items.filter((it) => it.type === "cash").map((it) => it.id);
    if (cashIds.length) {
      const { data: cash } = await service.from("cash_reports").select("id, over_short_note")
        .eq("location_id", args.locationId).in("id", cashIds).is("superseded_at", null);
      for (const r of (cash ?? []) as Array<{ id: string; over_short_note: string | null }>) {
        push(`cash:${r.id}`, "cash_note", r.over_short_note);
      }
    }
  }

  // ── PM reports (area_to_improve / note / mvp_note, gated) ──
  const pmIds = args.items.filter((it) => it.type === "pm").map((it) => it.id);
  if (pmIds.length) {
    // SECURITY: resolve the location-authorized pm report ids FIRST, then key
    // every downstream read (mvp_note + evals' area_to_improve/note) off this
    // set — pm_employee_evals carries no location column, so binding the evals
    // query to caller-supplied pmIds alone would leak another store's eval text.
    const { data: reps } = await service.from("pm_reports").select("id, mvp_note")
      .eq("location_id", args.locationId).in("id", pmIds).is("superseded_at", null);
    const repRows = (reps ?? []) as Array<{ id: string; mvp_note: string | null }>;
    const authorizedPmIds = repRows.map((r) => r.id);
    if (isManager) {
      for (const r of repRows) {
        push(`pm:${r.id}`, "mvp_note", r.mvp_note);
      }
    }
    if (authorizedPmIds.length) {
      let evalQuery = service.from("pm_employee_evals").select("pm_report_id, area_to_improve, note")
        .in("pm_report_id", authorizedPmIds).is("superseded_at", null);
      if (!isManager) evalQuery = evalQuery.eq("employee_id", args.viewer.userId); // own only
      const { data: evals } = await evalQuery;
      for (const e of (evals ?? []) as Array<{ pm_report_id: string; area_to_improve: string | null; note: string | null }>) {
        push(`pm:${e.pm_report_id}`, "area_to_improve", e.area_to_improve);
        if (isManager && showNotes) push(`pm:${e.pm_report_id}`, "pm_note", e.note);
      }
    }
  }

  // ── Maintenance (ad-hoc equipment notes; L3+, location-bound) ──
  // Fridge temp-item notes are already searchable under opening/closing, so
  // only maintenance_notes are indexed here. Corpus keyed `${type}:${id}` to
  // match the page's lookup; note dates use the operational TZ.
  const maintItems = args.items.filter((it) => it.type === "maintenance");
  if (maintItems.length) {
    const idByDate = new Map(maintItems.map((it) => [it.date, it.id] as const));
    const equip = await selectAllRows<{ id: string; name: string }>((from, to) =>
      service.from("maintenance_equipment").select("id, name")
        .eq("location_id", args.locationId).eq("active", true)
        .order("id", { ascending: true }).range(from, to),
    );
    const labelById = new Map(equip.map((e) => [e.id, e.name] as const));
    const notes = await selectAllRows<{ note: string; created_at: string; equipment_id: string | null; other_label: string | null }>((from, to) =>
      service.from("maintenance_notes").select("note, created_at, equipment_id, other_label")
        .eq("location_id", args.locationId)
        .order("created_at", { ascending: true }).range(from, to),
    );
    for (const n of notes) {
      const date = opDate(n.created_at);
      const itemId = idByDate.get(date);
      if (!itemId) continue;
      const key = `maintenance:${itemId}`; // == `${it.type}:${it.id}`
      const label = n.equipment_id ? (labelById.get(n.equipment_id) ?? null) : n.other_label;
      push(key, "equipment", label);
      push(key, "maintenance_note", n.note);
    }
  }

  return corpus;
}
