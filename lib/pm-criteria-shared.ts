/**
 * PM v2 CRITERIA — the pure half (client-safe, zero I/O). Scheduling Phase 1, Task 22.
 *
 * Criteria are DATA in `pm_criteria` (R1), never code: seeded once per shop from the list Juan confirmed on
 * 2026-10-15 (docs/seed/pm-criteria-2026-10-15.json, by scripts/seed-pm-criteria.ts, on Juan's word) and then
 * edited by managers in the Tier E editor (R10). This module holds the rules both share: the label rule (the
 * 0271 CHECK's twin), the editor's grouping ("Every position" first, then each usable position in display
 * order), and the seed PLAN — which matches each confirmed position to a `station_positions` row of the shop
 * by its EXACT name, prints every match, and REFUSES on any unmatched, ambiguous or retired name (never a
 * guess). Shops are ids and names, never codes.
 */

export const PM_CRITERION_LABEL_MAX = 80;

/** The 0271 CHECK's twin: en 1..80 after trimming; es empty (none) or 1..80. */
export function pmCriterionLabelProblem(label: unknown, labelEs: unknown): "invalid_label" | null {
  if (typeof label !== "string") return "invalid_label";
  const en = label.trim();
  if (en.length < 1 || en.length > PM_CRITERION_LABEL_MAX) return "invalid_label";
  if (labelEs !== null && labelEs !== undefined) {
    if (typeof labelEs !== "string") return "invalid_label";
    if (labelEs.trim().length > PM_CRITERION_LABEL_MAX) return "invalid_label";
  }
  return null;
}
/** The stored Spanish label: trimmed, or null when blank. */
export function normalizeLabelEs(labelEs: unknown): string | null {
  return typeof labelEs === "string" && labelEs.trim() ? labelEs.trim() : null;
}
export function labelKey(label: string): string {
  return label.trim().toLowerCase();
}

// ─── the editor's view ───────────────────────────────────────────────────────

export interface CriterionRow { id: string; position_id: string | null; label: string; label_es: string | null; sort: number; active: boolean }
export interface EditorPosition { positionId: string; name: string; nameEs: string | null }
export interface EditorGroup {
  /** null = "Every position" (the shared criteria). */
  positionId: string | null; name: string | null; nameEs: string | null;
  criteria: Array<{ id: string; label: string; labelEs: string | null; sort: number; active: boolean }>;
}

/** "Every position" first, then each usable position (display order as given); active criteria by sort, then the deactivated. */
export function criteriaEditorGroups(positions: readonly EditorPosition[], criteria: readonly CriterionRow[]): EditorGroup[] {
  const order = (a: CriterionRow, b: CriterionRow) => Number(b.active) - Number(a.active) || a.sort - b.sort || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  const toView = (c: CriterionRow) => ({ id: c.id, label: c.label, labelEs: c.label_es, sort: c.sort, active: c.active });
  return [
    { positionId: null, name: null, nameEs: null, criteria: criteria.filter((c) => c.position_id === null).sort(order).map(toView) },
    ...positions.map((p) => ({ positionId: p.positionId, name: p.name, nameEs: p.nameEs, criteria: criteria.filter((c) => c.position_id === p.positionId).sort(order).map(toView) })),
  ];
}

/** The next sort value in a scope (steps of 10, so a later insert between two never renumbers). */
export function nextCriterionSort(criteria: ReadonlyArray<{ position_id: string | null; sort: number }>, positionId: string | null): number {
  const inScope = criteria.filter((c) => c.position_id === positionId).map((c) => c.sort);
  return inScope.length ? Math.max(...inScope) + 10 : 10;
}

// ─── the seed plan ───────────────────────────────────────────────────────────

export interface SeedLabel { en: string; es: string }
export interface PmCriteriaSeedFile {
  confirmedBy: string; confirmedOn: string;
  shared: SeedLabel[];
  positions: Array<{ position: string; station: string | null; criteria: SeedLabel[] }>;
}
export interface SeedShop { id: string; name: string; active: boolean }
export interface SeedStation { id: string; location_id: string; name: string; active: boolean }
export interface SeedPosition { id: string; station_id: string; location_id: string; name: string; active: boolean }
export interface SeedExisting { location_id: string; position_id: string | null; label: string; active: boolean }
export interface SeedInsert { location_id: string; position_id: string | null; label: string; label_es: string; sort: number }
export interface SeedMatch { position: string; state: "ok" | "missing" | "ambiguous" | "inactive"; positionId: string | null; station: string | null }
export interface SeedShopPlan { locationId: string; shop: string; ready: boolean; matches: SeedMatch[]; inserts: SeedInsert[]; skipped: number }
export interface SeedPlan { shops: SeedShopPlan[]; ready: boolean }

/** A malformed seed file is refused before anything is matched. */
export function seedFileProblem(seed: unknown): string | null {
  const s = seed as PmCriteriaSeedFile;
  const okLabel = (l: SeedLabel) => l && pmCriterionLabelProblem(l.en, l.es) === null && typeof l.es === "string" && l.es.trim().length > 0;
  if (!s || !Array.isArray(s.shared) || !Array.isArray(s.positions)) return "the seed file needs `shared` and `positions`";
  if (!s.shared.every(okLabel)) return "a shared criterion has an invalid label";
  const names = new Set<string>();
  for (const p of s.positions) {
    if (!p || typeof p.position !== "string" || !p.position.trim() || !Array.isArray(p.criteria) || !p.criteria.length) return "a position entry is malformed";
    if (names.has(p.position)) return `the position "${p.position}" appears twice`;
    names.add(p.position);
    if (!p.criteria.every(okLabel)) return `a criterion of "${p.position}" has an invalid label`;
    if (new Set(p.criteria.map((c) => labelKey(c.en))).size !== p.criteria.length) return `"${p.position}" repeats a criterion`;
  }
  return null;
}

/**
 * The plan per ACTIVE shop (by name): each confirmed position matched by its EXACT name to a USABLE position
 * of the shop (active, on an active station); none = `missing`, only retired ones = `inactive`, more than one
 * = `ambiguous` — every one of them a refusal (the shop is not ready and nothing is inserted). A ready shop
 * gets the shared criteria then each position's, in the confirmed order (sort 10, 20, …), skipping any label
 * already ACTIVE in that scope (re-running the seed inserts nothing new).
 */
export function planPmCriteriaSeed(
  seed: PmCriteriaSeedFile, shops: readonly SeedShop[], stations: readonly SeedStation[], positions: readonly SeedPosition[],
  existing: readonly SeedExisting[],
): SeedPlan {
  const station = new Map(stations.map((s) => [s.id, s] as const));
  const out: SeedShopPlan[] = [];
  for (const shop of [...shops].filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))) {
    const matches: SeedMatch[] = seed.positions.map((entry) => {
      const candidates = positions.filter((p) => p.location_id === shop.id && p.name === entry.position
        && (entry.station === null || station.get(p.station_id)?.name === entry.station));
      const usable = candidates.filter((p) => p.active && station.get(p.station_id)?.active === true);
      if (usable.length === 1) return { position: entry.position, state: "ok", positionId: usable[0]!.id, station: station.get(usable[0]!.station_id)?.name ?? null };
      if (usable.length > 1) return { position: entry.position, state: "ambiguous", positionId: null, station: null };
      return { position: entry.position, state: candidates.length ? "inactive" : "missing", positionId: null, station: null };
    });
    const ready = matches.every((m) => m.state === "ok");
    const inserts: SeedInsert[] = [];
    let skipped = 0;
    if (ready) {
      const have = new Set(existing.filter((e) => e.location_id === shop.id && e.active).map((e) => `${e.position_id ?? ""}|${labelKey(e.label)}`));
      const add = (positionId: string | null, labels: readonly SeedLabel[]) => labels.forEach((l, i) => {
        if (have.has(`${positionId ?? ""}|${labelKey(l.en)}`)) { skipped++; return; }
        inserts.push({ location_id: shop.id, position_id: positionId, label: l.en.trim(), label_es: l.es.trim(), sort: (i + 1) * 10 });
      });
      add(null, seed.shared);
      seed.positions.forEach((entry, i) => add(matches[i]!.positionId, entry.criteria));
    }
    out.push({ locationId: shop.id, shop: shop.name, ready, matches, inserts, skipped });
  }
  return { shops: out, ready: out.length > 0 && out.every((s) => s.ready) };
}

/** The printed plan (a runbook artefact pasted into the PR — plain English, not a UI surface). */
export function formatSeedPlan(plan: SeedPlan, opts: { apply: boolean }): string {
  const lines: string[] = [];
  for (const s of plan.shops) {
    lines.push(`${s.shop} (${s.locationId}): ${s.ready ? "READY" : "NOT READY — nothing will be written for this shop"}`);
    for (const m of s.matches) lines.push(`  ${m.position}: ${m.state}${m.positionId ? ` — station "${m.station}", position ${m.positionId}` : ""}`);
    if (s.ready) lines.push(`  criteria to ${opts.apply ? "insert" : "insert on --apply"}: ${s.inserts.length} · already there: ${s.skipped}`);
  }
  if (!plan.shops.length) lines.push("No active shop found.");
  return lines.join("\n");
}

// ─── the editor's write outcome (Astra chunk F review #4) ────────────────────

/** A criteria write ends one of three ways; a canceled password prompt is its OWN outcome, never a success. */
export type CriteriaWriteOutcome = { kind: "saved" } | { kind: "canceled" } | { kind: "error"; code: unknown };

export function criteriaWriteOutcome(stepUp: "ok" | "cancelled", post?: { ok: boolean; code?: unknown }): CriteriaWriteOutcome {
  if (stepUp !== "ok") return { kind: "canceled" };
  if (post?.ok) return { kind: "saved" };
  return { kind: "error", code: post?.code };
}

/** The Add form after a write: cleared ONLY when the criterion was saved; a cancel or a refusal keeps both languages. */
export function addFormAfter<T extends { label: string; labelEs: string }>(outcome: CriteriaWriteOutcome, draft: T): T | { label: ""; labelEs: "" } {
  return outcome.kind === "saved" ? { label: "", labelEs: "" } : draft;
}
