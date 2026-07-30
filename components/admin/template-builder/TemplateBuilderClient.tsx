"use client";

/**
 * TemplateBuilderClient — the manager-facing builder for a non-prep list type
 * (Template Builder spec §6/§7; PR-1 proves it on CLOSING, PR-2 reuses it for
 * opening). Born Disclosure-compliant (D1-D10):
 *   - per-location TABS partition the two locations' active templates (D6; tabs
 *     never collapse);
 *   - each item is a SummaryRow — IDENTITY line always visible (D1: en label ·
 *     station · gate-tier · role name · count/photo flags) + never-collapse alert
 *     badges (D2: missing-es, needs-link, mirror);
 *   - a DRAWER per item (lazy, D10) holds description, the VISIBLE Spanish block
 *     with a fill-count header (D5), the strict es-FILL form, and the spine-link
 *     picker (only on count-bearing unlinked lines);
 *   - the Template Doctor is a compact header chip (D2/D3) that expands inline;
 *   - a phone Preview disclosure renders the live active template as staff see it.
 *
 * WRITE SCOPE (spec §1 reconciliation contract): PR-3 adds the DRAFT ENGINE — the
 * manager drafts structural edits (add / relabel / describe / disable / enable /
 * reorder / required-flip / role) in local useState, sees them live in the phone
 * preview, and PUBLISHES: every publish mints a NEW version effective NEXT
 * OPERATIONAL DAY (apply-now = today, gated + Tier-A). No in-place mutation of a
 * served version. The two SAME-DAY FILLS (es translations + spine link, PR-0) still
 * write in place (data-completeness only). MIRROR ROWS ARE NEVER DRAFT-EDITED (the
 * §5 seal). Publish + fills are GM+ (Tier-A step-up); reads are AGM+.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SummaryRow } from "@/components/ui/SummaryRow";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { roleLevelOptions } from "@/lib/roles";
import type { ChecklistTemplateItem } from "@/lib/types";
import {
  isMirrorItem,
  itemNeedsLink,
  applyEditsToItems,
  classifyEdits,
  resolveGateTier,
  buildReconcileAddEdit,
  buildBothLocationAdds,
  makeTempId,
  RECONCILED_REPORT_REF_TYPES,
  type TemplateItemEdit,
  type TemplatePatch,
  type TemplateBuilderTemplate,
  type TemplateBuilderView,
  type TemplateDoctorReport,
  type TemplateDoctorTemplate,
  type TemplateBuilderType,
  type ReferenceTargetsView,
  type ReconciledReportRefType,
  type ReconcileSource,
  type DriftFinding,
} from "@/lib/admin/template-builder-shared";
import type { LinkTarget } from "@/lib/admin/needs-link-shared";
import type { GatePredicate, ChecklistType } from "@/lib/types";

/** A local draft: the pending structural edits for one template (keyed by template
 *  id in the parent). Empty = clean. */
type DraftState = Record<string, TemplateItemEdit[]>;

const tk = (k: string): TranslationKey => k as TranslationKey;

/** Role-level → representative label resolver (ROLE NAMES, never numbers — D-law).
 *  Exact match, else the nearest role AT OR BELOW the level (e.g. min_role 7 → GM;
 *  an impossible 11 → the top role, CGS). Never renders a bare number. */
function useRoleLabelForLevel() {
  const options = useMemo(() => roleLevelOptions(), []); // ascending by level
  return (level: number): string => {
    const exact = options.find((o) => o.level === level);
    if (exact) return exact.label;
    let best: { level: number; label: string } | null = null;
    for (const o of options) {
      if (o.level <= level && (best === null || o.level > best.level)) best = o;
    }
    // Above every defined level (e.g. impossible min_role) → the highest role.
    return best?.label ?? options[options.length - 1]?.label ?? `L${level}`;
  };
}

/** Resolve a drift source item (by normalized English label — the system key the
 *  Doctor diffs on) from the PRESENT location's template into the ReconcileSource
 *  shape buildReconcileAddEdit consumes. Returns null when no active non-mirror row
 *  matches (mirrors are already excluded from drift; this is belt-and-braces). The
 *  FIRST active match wins (a location can't legitimately carry two same-label rows). */
function findReconcileSource(
  present: TemplateBuilderTemplate,
  label: string,
): ReconcileSource | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const target = norm(label);
  const row = present.items.find((it) => it.active && norm(it.label) === target);
  if (!row) return null;
  return {
    label: row.label,
    description: row.description,
    station: row.station,
    minRoleLevel: row.minRoleLevel,
    required: row.required,
    hardGate: row.hardGate,
    expectsCount: row.expectsCount,
    expectsPhoto: row.expectsPhoto,
    inputType: row.inputType,
    itemId: row.itemId,
    vendorItemId: row.vendorItemId,
    isMirror: isMirrorItem(row.prepMeta),
    es: row.translations?.es
      ? { label: row.translations.es.label ?? null, description: row.translations.es.description ?? null }
      : null,
  };
}

export function TemplateBuilderClient({
  view,
  doctor,
  linkTargets,
  referenceTargets,
  canFill,
}: {
  view: TemplateBuilderView;
  doctor: TemplateDoctorReport;
  linkTargets: LinkTarget[];
  /** PR-4 (spec §5): the OTHER list's current items, for the ref-track picker. */
  referenceTargets: ReferenceTargetsView;
  /** GM+ may run the two same-day fills (Tier-A) AND publish (Tier-A). */
  canFill: boolean;
}) {
  const { t } = useTranslation();

  // Per-location tabs (D6). Default to the first location. ?tab-style local
  // useState only (D9 — no URL/localStorage).
  const [activeTplId, setActiveTplId] = useState<string>(view.templates[0]?.id ?? "");
  const active = view.templates.find((tpl) => tpl.id === activeTplId) ?? view.templates[0] ?? null;

  // PR-5 (spec §8): the OTHER location's template (the both-locations partner). Two
  // locations is the CO shape; more than two → no single "other" (the both-locations
  // toggle still fans out to ALL, but the publish guidance names only a single peer).
  const otherTemplate = active ? view.templates.find((t) => t.id !== active.id) ?? null : null;
  const otherLocationName = otherTemplate?.name ?? null;

  // Deep-link target: when the Doctor "fix" link fires, expand that item's drawer
  // and scroll to it. Held in a shared piece of state the item list reads.
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // PR-3 DRAFT ENGINE — pending structural edits keyed by template id (D9: useState
  // only). Empty per template = clean. Edits feed the list + the phone preview + the
  // classifyEdits diff for the publish confirm modal. Publishing versions everything.
  const [drafts, setDrafts] = useState<DraftState>({});
  const activeId = active?.id ?? "";
  const editsForActive = useMemo(() => drafts[activeId] ?? [], [drafts, activeId]);

  // PR-4 (spec §5): the template-level submission-gate patch, keyed by template id. A
  // value present here means the manager edited the "Requires" setting; it rides the
  // same publish (templatePatch). `undefined` = untouched (source copies verbatim).
  const [gatePatch, setGatePatch] = useState<Record<string, GatePredicate | null>>({});
  const patchForActive: TemplatePatch | undefined =
    activeId in gatePatch ? { submissionGatePredicate: gatePatch[activeId] ?? null } : undefined;
  const setGateForActive = (templateId: string, predicate: GatePredicate | null) =>
    setGatePatch((prev) => ({ ...prev, [templateId]: predicate }));

  const pushEdit = (templateId: string, edit: TemplateItemEdit) => {
    setDrafts((prev) => ({ ...prev, [templateId]: [...(prev[templateId] ?? []), edit] }));
  };

  // PR-5 (spec §8): the SCOPE of each draft-added row — "both" (fanned to both
  // locations) or "one" (this location only / a reconcile add, which lands on B only).
  // Keyed by the synthetic row id (`draft-<tempId>`) so ItemRow can show the indicator
  // chip. useState only (D9); no persistence (scope is a draft-time affordance).
  const [addScope, setAddScope] = useState<Record<string, "both" | "one">>({});

  // PR-5 (spec §8) — LOCATION SYNC dispatch. All fan-outs/reconciles push {op:"add"}
  // into a DRAFT (never a direct write); publish stays PER TEMPLATE (two taps).
  //
  // The next display order for a template = max over its DRAFTED items (source + this
  // draft applied), so a fan-out/reconcile add lands at the drafted tail (never colliding
  // with a pending draft-add's order). Computed from `prevDrafts` inside the setter so
  // concurrent pushes see each other.
  const nextOrderFor = (
    tpl: TemplateBuilderTemplate,
    prevDrafts: DraftState,
  ): number => {
    const items = applyEditsToItems(tpl.items, prevDrafts[tpl.id] ?? []);
    return items.reduce((m, it) => Math.max(m, it.displayOrder), 0) + 1;
  };

  // BOTH-LOCATIONS ADD (default-ON, spec §8): one authored add → a draft add in EVERY
  // template (distinct tempIds, per-template display orders). "This location only" =
  // the caller passes just the active template. One setDrafts so the fan-out is atomic.
  const dispatchAdd = (
    base: Omit<Extract<TemplateItemEdit, { op: "add" }>, "op" | "tempId" | "displayOrder">,
    bothLocations: boolean,
  ) => {
    if (!active) return;
    const scope: "both" | "one" = bothLocations && view.templates.length > 1 ? "both" : "one";
    setDrafts((prev) => {
      const targets = bothLocations ? view.templates : [active];
      const fanned = buildBothLocationAdds(
        base,
        targets.map((t) => ({ templateId: t.id, nextDisplayOrder: nextOrderFor(t, prev) })),
        () => makeTempId(Date.now(), Math.random().toString(36).slice(2, 8)),
      );
      setAddScope((s) => {
        const nextScope = { ...s };
        for (const f of fanned) nextScope[`draft-${f.edit.tempId}`] = scope;
        return nextScope;
      });
      const next = { ...prev };
      for (const f of fanned) next[f.templateId] = [...(next[f.templateId] ?? []), f.edit];
      return next;
    });
  };

  // RECONCILE "Make <B> match <A>" (spec §8): resolve the drift source row FROM A's
  // items (normalized-label match, mirror-excluded already at the Doctor) and push a
  // reconcile add into B's draft. Returns the block reason when the source can't be
  // reconciled (mirror / unlinked-count) so the panel can surface it, else "ok".
  const reconcileOne = (finding: DriftFinding): "ok" | "mirror" | "unlinked_count" | "no_source" => {
    const present = view.templates.find((t) => t.locationId === finding.presentLocationId);
    const missing = view.templates.find((t) => t.locationId === finding.missingLocationId);
    if (!present || !missing) return "no_source";
    const source = findReconcileSource(present, finding.label);
    if (!source) return "no_source";
    let outcome: "ok" | "mirror" | "unlinked_count" = "ok";
    setDrafts((prev) => {
      const result = buildReconcileAddEdit(source, {
        tempId: makeTempId(Date.now(), Math.random().toString(36).slice(2, 8)),
        displayOrder: nextOrderFor(missing, prev),
      });
      if (!result.ok) {
        outcome = result.reason;
        return prev;
      }
      // A reconcile add lands on the MISSING location only → scope "one".
      setAddScope((s) => ({ ...s, [`draft-${result.edit.tempId}`]: "one" }));
      return { ...prev, [missing.id]: [...(prev[missing.id] ?? []), result.edit] };
    });
    return outcome;
  };
  // Remove a draft-added row entirely (adversarial review M1): a disable edit
  // against a draft-add is a no-op in BOTH the preview (applyEditsToItems keys
  // persisted ids) and the publish copy (adds insert active=true) — so the honest
  // affordance for an unwanted add is REMOVE: drop the add op + any edits that
  // targeted its synthetic draft id.
  const removeDraftAdd = (templateId: string, tempId: string) => {
    setDrafts((prev) => ({
      ...prev,
      [templateId]: (prev[templateId] ?? []).filter(
        (e) =>
          !(e.op === "add" && e.tempId === tempId) &&
          !("itemId" in e && e.itemId === `draft-${tempId}`),
      ),
    }));
    // PR-5: drop the removed row's scope entry (no stale indicator chip on a re-used id).
    setAddScope((s) => {
      const next = { ...s };
      delete next[`draft-${tempId}`];
      return next;
    });
  };
  const clearDraft = (templateId: string) => {
    let clearedTempIds: string[] = [];
    setDrafts((prev) => {
      clearedTempIds = (prev[templateId] ?? [])
        .filter((e): e is Extract<TemplateItemEdit, { op: "add" }> => e.op === "add")
        .map((e) => e.tempId);
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
    setGatePatch((prev) => {
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
    // PR-5: prune the published draft's scope entries (this template's draft-adds are
    // now real rows on the next version — the scope chip belonged only to the draft).
    setAddScope((s) => {
      const next = { ...s };
      for (const id of clearedTempIds) delete next[`draft-${id}`];
      return next;
    });
  };

  // The drafted item array for the active template (source items + edits applied,
  // mirror rows untouched). Drives the list + preview so the manager sees exactly
  // what publishes.
  const draftedItems = useMemo(
    () => (active ? applyEditsToItems(active.items, editsForActive) : []),
    [active, editsForActive],
  );

  // Type-parameterized empty copy (PR-1 review debt: the key was closing-only).
  // `view.type` is the TemplateBuilderType; the per-type keys exist for all three.
  const noTemplatesKey = tk(`admin.templates.builder.no_templates.${view.type}`);

  if (view.templates.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t(noTemplatesKey)}
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      {/* Template Doctor — compact header chip (D2/D3), expands inline. */}
      <TemplateDoctorPanel
        doctor={doctor}
        canReconcile={canFill}
        onFix={(templateId, itemId) => {
          setActiveTplId(templateId);
          setFocusItemId(itemId);
          // Scroll after the drawer mounts.
          requestAnimationFrame(() => {
            document.getElementById(`tb-item-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }}
        onReconcile={reconcileOne}
      />

      {/* PENDING-VERSION banner (D2, never collapses): the loaded version is a pending
          next-day publish — these on-screen items go live tomorrow morning. */}
      {active?.isPending && active.effectiveFrom && (
        <p className="rounded-lg border-2 border-co-gold-deep/60 bg-co-gold/15 px-3 py-2 text-sm font-semibold text-co-text">
          {t("admin.templates.builder.pending_banner", { date: active.effectiveFrom })}
        </p>
      )}

      {/* Per-location tabs (D6 — never collapse). */}
      {view.templates.length > 1 && (
        <div role="tablist" aria-label={t("admin.templates.builder.location_tabs")} className="flex flex-wrap gap-2">
          {view.templates.map((tpl) => {
            const d = doctor.templates.find((x) => x.templateId === tpl.id);
            // ONE issue definition everywhere (adversarial review MED): ACTIONABLE
            // items only — unlinked count lines + impossible role floors. Spanish
            // is PROGRESS (the es_fill line), never an "issue" count.
            const alerts = d
              ? d.needsLink.length + d.roleFloor.filter((f) => f.severity === "impossible").length
              : 0;
            const dirty = (drafts[tpl.id]?.length ?? 0) > 0;
            return (
              <button
                key={tpl.id}
                id={`tb-tab-${tpl.id}`}
                role="tab"
                aria-selected={tpl.id === active?.id}
                aria-controls="tb-item-panel"
                type="button"
                onClick={() => {
                  setActiveTplId(tpl.id);
                  setFocusItemId(null);
                }}
                className={
                  "inline-flex min-h-[40px] items-center gap-2 rounded-full border-2 px-4 text-sm font-bold transition " +
                  (tpl.id === active?.id
                    ? "border-co-gold-deep bg-co-gold/25 text-co-text"
                    : "border-co-border bg-co-surface text-co-text-muted hover:text-co-text")
                }
              >
                {tpl.name}
                {dirty && <span aria-hidden className="text-co-cta">●</span>}
                {alerts > 0 && (
                  <span className="inline-flex items-center rounded-full bg-co-cta/15 px-1.5 text-[11px] font-bold text-co-cta">
                    {alerts}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div
          id="tb-item-panel"
          role={view.templates.length > 1 ? "tabpanel" : undefined}
          aria-labelledby={view.templates.length > 1 ? `tb-tab-${active.id}` : undefined}
        >
          <ItemList
            template={active}
            draftedItems={draftedItems}
            linkTargets={linkTargets}
            referenceTargets={referenceTargets}
            canFill={canFill}
            focusItemId={focusItemId}
            onEdit={(edit) => pushEdit(active.id, edit)}
            onRemoveDraftAdd={(tempId) => removeDraftAdd(active.id, tempId)}
            onAdd={dispatchAdd}
            multiLocation={view.templates.length > 1}
            otherLocationName={otherLocationName}
            addScope={addScope}
          />
        </div>
      )}

      {/* Template-level "Requires" setting (spec §5) — the submission gate predicate.
          Editing it drafts a templatePatch that rides the same publish. GM+ only. */}
      {active && canFill && (
        <SubmissionGateSetting
          type={view.type}
          current={active.submissionGatePredicate ?? null}
          draftPredicate={active.id in gatePatch ? gatePatch[active.id] ?? null : undefined}
          onChange={(predicate) => setGateForActive(active.id, predicate)}
        />
      )}

      {/* Publish bar — dirty banner (D2, never collapses) + Publish button + confirm
          modal. Only GM+ (canFill) sees the publish affordance. */}
      {active && canFill && (
        <PublishBar
          template={active}
          edits={editsForActive}
          templatePatch={patchForActive}
          openInstancesToday={doctor.publish?.openInstancesToday ?? 0}
          onPublished={() => clearDraft(active.id)}
          // PR-5 (spec §8): when the OTHER location's draft is also dirty, the publish
          // bar surfaces "also publish <other>" guidance — publish stays PER TEMPLATE
          // (two taps; no cross-lineage atomic publish — the two lineages version
          // independently). Named only when there's exactly one peer (the CO shape).
          otherLocationDirty={
            otherTemplate ? (drafts[otherTemplate.id]?.length ?? 0) > 0 : false
          }
          otherLocationName={otherLocationName}
        />
      )}

      {/* Phone preview (spec §7, REQUIRED) — renders the DRAFTED active template so the
          manager sees exactly what staff sees tonight/tomorrow before publishing. */}
      {active && <PhonePreview draftedItems={draftedItems} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Doctor panel (spec §6) — compact chip → inline expand.
// ─────────────────────────────────────────────────────────────────────────────

function TemplateDoctorPanel({
  doctor,
  canReconcile,
  onFix,
  onReconcile,
}: {
  doctor: TemplateDoctorReport;
  /** GM+ (canFill) may reconcile drift (it drafts a versioned add). AGM readers can't. */
  canReconcile: boolean;
  onFix: (templateId: string, itemId: string) => void;
  /** PR-5 (spec §8): "Make B match A" — returns the outcome so the panel can flag a
   *  blocked reconcile (a mirror / an unlinked count source) instead of silently no-op. */
  onReconcile: (finding: DriftFinding) => "ok" | "mirror" | "unlinked_count" | "no_source";
}) {
  const { t } = useTranslation();
  // Same ACTIONABLE definition as the tab badges, plus drift (a location-pair
  // fact itemized in the panel). esMissing is intentionally EXCLUDED — Spanish
  // renders as fill-count progress, not an issue (header must never claim an
  // issue the panel can't itemize — the PR-0 header/panel-disagreement class).
  // ACTIONABLE issues drive the count/chip: needs-link, impossible role floors, drift,
  // and PR-4 dangling ref_track references (a broken cross-list reference). Hard-gated
  // items are an INVENTORY (surfaced in the panel, never counted as an "issue").
  const { needsLink, roleFloorImpossible, drift, hardGated, danglingRefs, orphanedMirrors } = doctor.totals;
  const issueCount = needsLink + roleFloorImpossible + drift + danglingRefs;
  const clean = issueCount === 0;

  const badge = clean ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-co-success/15 px-2 py-0.5 text-[11px] font-bold text-co-success">
      ✓ {t("admin.templates.doctor.all_clear")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-co-cta/15 px-2 py-0.5 text-[11px] font-bold text-co-cta">
      {t("admin.templates.doctor.issues_n", { n: String(issueCount) })}
    </span>
  );

  const locName = (id: string): string =>
    doctor.templates.find((tpl) => tpl.locationId === id)?.locationName ?? id;

  // PR-4: the hard-gated inventory shows even when there are no ACTIONABLE issues
  // (the owner's guardrail — always visible if any line can block a submission).
  // Orphaned mirrors are the same shape: ADVISORY (not in issueCount) but still shown.
  const hasAdvisory = hardGated > 0 || orphanedMirrors > 0;

  return (
    <CollapsibleSection
      idBase="tb-doctor"
      title={t("admin.templates.doctor.title")}
      badge={badge}
      defaultOpen={!clean}
    >
      {clean && !hasAdvisory ? (
        <p className="text-sm text-co-text-muted">{t("admin.templates.doctor.all_clear_body")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {clean && hasAdvisory && (
            <p className="text-sm text-co-text-muted">{t("admin.templates.doctor.all_clear_body")}</p>
          )}
          {/* Location drift — NAMED per item (spec §6) + reconcile (spec §8, PR-5). */}
          {doctor.drift.length > 0 && (
            <DriftReconcileGroup
              drift={doctor.drift}
              locName={locName}
              canReconcile={canReconcile}
              onReconcile={onReconcile}
            />
          )}

          {/* Per-template findings: needs-link, es fill, role-floor. */}
          {doctor.templates.map((tpl) => (
            <DoctorTemplateBlock key={tpl.templateId} tpl={tpl} confirmFloorLevel={doctor.confirmFloorLevel} onFix={onFix} />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

function DoctorGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-extrabold uppercase tracking-[0.1em] text-co-text-muted">{title}</h3>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * DriftReconcileGroup (spec §8, PR-5) — location drift NAMED per item, grouped by
 * DIRECTION (A→B vs B→A, so the manager reads "these are in P St, not Cap Hill" as one
 * block), each with a one-tap "Add to <missing>" reconcile + a per-direction "Add all N".
 * ADDITIVE ONLY (append-only law): no removal reconcile — an unwanted extra on B is a
 * manual disable (already possible). Intentional drift is legitimate (schema-free this
 * arc; the copy says so) → reconcile is opt-in per item. A blocked source (a mirror, or
 * a count line with no spine link) surfaces its reason inline; it is NEVER silently added.
 */
function DriftReconcileGroup({
  drift,
  locName,
  canReconcile,
  onReconcile,
}: {
  drift: DriftFinding[];
  locName: (id: string) => string;
  canReconcile: boolean;
  onReconcile: (finding: DriftFinding) => "ok" | "mirror" | "unlinked_count" | "no_source";
}) {
  const { t } = useTranslation();
  // A stable key per finding (direction + label). Tracks the post-action state so a
  // reconciled row shows "added (publish to make live)" and a blocked one shows why.
  const keyOf = (d: DriftFinding) => `${d.presentLocationId}→${d.missingLocationId}::${d.label}`;
  const [state, setState] = useState<Record<string, "added" | "mirror" | "unlinked_count" | "no_source">>({});

  // Group by direction so A→B and B→A read as separate blocks (direction clarity).
  const byDirection = useMemo(() => {
    const groups = new Map<string, DriftFinding[]>();
    for (const d of drift) {
      const k = `${d.presentLocationId}→${d.missingLocationId}`;
      const arr = groups.get(k) ?? [];
      arr.push(d);
      groups.set(k, arr);
    }
    return [...groups.entries()];
  }, [drift]);

  const runReconcile = (d: DriftFinding) => {
    const outcome = onReconcile(d);
    setState((prev) => ({ ...prev, [keyOf(d)]: outcome === "ok" ? "added" : outcome }));
  };

  const blockKey = (r: "mirror" | "unlinked_count" | "no_source"): TranslationKey =>
    r === "unlinked_count"
      ? tk("admin.templates.doctor.reconcile_blocked_unlinked")
      : r === "mirror"
        ? tk("admin.templates.doctor.reconcile_blocked_mirror")
        : tk("admin.templates.doctor.reconcile_blocked_missing");

  return (
    <DoctorGroup title={t("admin.templates.doctor.drift_heading", { n: String(drift.length) })}>
      {/* Intentional-drift acknowledgment (spec §8): differences can be legitimate —
          reconcile only what should match. No persisted "intentional" mark this arc. */}
      <p className="mb-2 text-xs text-co-text-muted">{t("admin.templates.doctor.drift_intentional_note")}</p>

      <div className="flex flex-col gap-3">
        {byDirection.map(([dirKey, findings]) => {
          const first = findings[0]!;
          const presentName = locName(first.presentLocationId);
          const missingName = locName(first.missingLocationId);
          // Findings not yet acted on (available for the bulk action).
          const pending = findings.filter((d) => state[keyOf(d)] === undefined);
          return (
            <div key={dirKey} className="rounded-lg border border-co-border/60 bg-co-surface p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-[0.06em] text-co-text-muted">
                  {t("admin.templates.doctor.drift_direction", { present: presentName, missing: missingName })}
                </p>
                {canReconcile && pending.length > 1 && (
                  <button
                    type="button"
                    onClick={() => pending.forEach(runReconcile)}
                    className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
                  >
                    {t("admin.templates.doctor.reconcile_all", { n: String(pending.length), missing: missingName })}
                  </button>
                )}
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {findings.map((d) => {
                  const s = state[keyOf(d)];
                  return (
                    <li key={keyOf(d)} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-co-text">
                        {t("admin.templates.doctor.drift_line", {
                          present: presentName,
                          label: d.label,
                          missing: missingName,
                        })}
                      </span>
                      {s === "added" ? (
                        <span className="inline-flex items-center rounded-full bg-co-success/15 px-2 py-0.5 text-[11px] font-bold text-co-success">
                          {t("admin.templates.doctor.reconcile_added")}
                        </span>
                      ) : s !== undefined ? (
                        <span className="text-xs font-semibold text-co-cta">{t(blockKey(s))}</span>
                      ) : canReconcile ? (
                        <button
                          type="button"
                          onClick={() => runReconcile(d)}
                          className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
                        >
                          {t("admin.templates.doctor.reconcile_add", { missing: missingName })}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </DoctorGroup>
  );
}

function DoctorTemplateBlock({
  tpl,
  confirmFloorLevel,
  onFix,
}: {
  tpl: TemplateDoctorTemplate;
  confirmFloorLevel: number;
  onFix: (templateId: string, itemId: string) => void;
}) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabelForLevel();
  const esMissing = tpl.esFill.total - tpl.esFill.filled;
  const impossible = tpl.roleFloor.filter((f) => f.severity === "impossible");
  const advisory = tpl.roleFloor.filter((f) => f.severity === "above_confirm_floor");
  const nothing =
    tpl.needsLink.length === 0 &&
    esMissing === 0 &&
    tpl.roleFloor.length === 0 &&
    tpl.hardGated.length === 0 &&
    tpl.danglingRefs.length === 0 &&
    tpl.orphanedMirrors.length === 0;
  if (nothing) return null;

  return (
    <DoctorGroup title={tpl.locationName ?? tpl.templateName}>
      <div className="flex flex-col gap-2">
        {/* Spanish fill-count (D5). */}
        <p className="text-sm text-co-text-muted">
          {t("admin.templates.doctor.es_fill", { filled: String(tpl.esFill.filled), total: String(tpl.esFill.total) })}
        </p>

        {/* Needs-link — each deep-links to the item drawer (spec §6). */}
        {tpl.needsLink.length > 0 && (
          <div>
            <p className="text-sm font-bold text-co-cta">
              {t("admin.templates.doctor.needs_link_n", { n: String(tpl.needsLink.length) })}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {tpl.needsLink.map((nl) => (
                <li key={nl.itemId} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-co-text">{nl.label}</span>
                  <button
                    type="button"
                    onClick={() => onFix(tpl.templateId, nl.itemId)}
                    className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
                  >
                    {t("admin.templates.doctor.fix")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Role-floor — impossible = the never-confirmable trap (spec §6). */}
        {impossible.length > 0 && (
          <div>
            <p className="text-sm font-bold text-co-cta">{t("admin.templates.doctor.role_floor_impossible")}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {impossible.map((f) => (
                <li key={f.itemId} className="text-sm text-co-text">
                  {t("admin.templates.doctor.role_floor_line", { label: f.label, role: roleLabel(f.minRoleLevel) })}
                </li>
              ))}
            </ul>
          </div>
        )}
        {advisory.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-co-text-muted">
              {t("admin.templates.doctor.role_floor_above", {
                n: String(advisory.length),
                role: roleLabel(confirmFloorLevel),
              })}
            </p>
          </div>
        )}

        {/* Dangling ref_track references (spec §6, PR-4) — actionable: the tracked
            target no longer exists on the referenced list, so the auto-tick can't fire. */}
        {tpl.danglingRefs.length > 0 && (
          <div>
            <p className="text-sm font-bold text-co-cta">
              {t("admin.templates.doctor.dangling_refs_n", { n: String(tpl.danglingRefs.length) })}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {tpl.danglingRefs.map((dr) => (
                <li key={dr.itemId} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-co-text">{dr.label}</span>
                  <button
                    type="button"
                    onClick={() => onFix(tpl.templateId, dr.itemId)}
                    className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
                  >
                    {t("admin.templates.doctor.fix")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Hard-gated inventory (spec §6, PR-4) — LISTED so the manager sees every line
            that can BLOCK a submission (the owner's guardrail). Not an issue; advisory. */}
        {tpl.hardGated.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-co-text-muted">
              {t("admin.templates.doctor.hard_gated_n", { n: String(tpl.hardGated.length) })}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {tpl.hardGated.map((hg) => (
                <li key={hg.itemId} className="text-sm text-co-text">{hg.label}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Orphaned mirrors (spec §6) — an active opening Phase-2 mirror whose AM-prep
            source is inactive/missing. ADVISORY: it's fixed in AM Prep (mirrors are
            read-only here), so no Fix button + not counted as an actionable issue. */}
        {tpl.orphanedMirrors.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-co-text-muted">
              {t("admin.templates.doctor.orphaned_mirrors_n", { n: String(tpl.orphanedMirrors.length) })}
            </p>
            <p className="text-xs text-co-text-dim">{t("admin.templates.doctor.orphaned_mirrors_hint")}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {tpl.orphanedMirrors.map((om) => (
                <li key={om.itemId} className="text-sm text-co-text">{om.label}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DoctorGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Item list — SummaryRows with per-item drawers.
// ─────────────────────────────────────────────────────────────────────────────

function ItemList({
  template,
  draftedItems,
  linkTargets,
  referenceTargets,
  canFill,
  focusItemId,
  onEdit,
  onRemoveDraftAdd,
  onAdd,
  multiLocation,
  otherLocationName,
  addScope,
}: {
  template: TemplateBuilderTemplate;
  /** source items + draft edits applied (mirror rows untouched). */
  draftedItems: ChecklistTemplateItem[];
  linkTargets: LinkTarget[];
  referenceTargets: ReferenceTargetsView;
  canFill: boolean;
  focusItemId: string | null;
  onEdit: (edit: TemplateItemEdit) => void;
  onRemoveDraftAdd: (tempId: string) => void;
  /** PR-5 (spec §8): the both-locations add fan-out. `bothLocations` = the toggle. */
  onAdd: (
    base: Omit<Extract<TemplateItemEdit, { op: "add" }>, "op" | "tempId" | "displayOrder">,
    bothLocations: boolean,
  ) => void;
  /** true when >1 location is visible → the "Both locations" toggle shows. */
  multiLocation: boolean;
  /** the peer location's name (for the toggle + the draft-added indicator chip). */
  otherLocationName: string | null;
  /** PR-5 (spec §8): per-draft-add scope ("both" / "one") keyed by `draft-<tempId>`. */
  addScope: Record<string, "both" | "one">;
}) {
  const { t } = useTranslation();
  // Fulledit PR-2 v1 boundary: QUESTION input types are CLOSING-ONLY — opening's
  // Phase-1 answer path (submitPhase1Atomic) has no input_type awareness yet, so
  // authoring a question there would ship an unanswerable line. Server-enforced
  // too (publish rejects input_type edits on non-closing templates).
  const questionTypesAllowed = template.type === "closing";
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    focusItemId ? new Set([focusItemId]) : new Set(),
  );
  // When a Doctor deep-link changes focusItemId, open that drawer (once).
  const [lastFocus, setLastFocus] = useState<string | null>(focusItemId);
  if (focusItemId !== lastFocus) {
    setLastFocus(focusItemId);
    if (focusItemId) setExpanded((prev) => new Set(prev).add(focusItemId));
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Reorder: swap this item's displayOrder with its up/down neighbour among the
  // NON-mirror rows (phone-first up/down buttons, no drag dependency — spec §7).
  // Mirror rows are pinned (never reordered); we compute neighbours over the
  // editable rows only and emit two reorder edits (this + neighbour swap orders).
  const editable = draftedItems.filter((it) => !isMirrorItem(it.prepMeta));
  const move = (item: ChecklistTemplateItem, dir: -1 | 1) => {
    const idx = editable.findIndex((it) => it.id === item.id);
    const swapWith = editable[idx + dir];
    if (!swapWith) return;
    emitReorder(onEdit, item, swapWith);
  };

  return (
    <section>
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t("admin.templates.builder.items_count", { n: String(draftedItems.filter((it) => it.active).length) })}
      </h2>

      {/* Quick-add (spec §7): sticky-ish add bar; label + section + role + required,
          defaults carried; count toggle reveals the required spine-link picker. PR-5:
          a "Both locations" toggle (default ON) fans the add into both drafts. */}
      {canFill && (
        <QuickAdd
          draftedItems={draftedItems}
          linkTargets={linkTargets}
          onAdd={onAdd}
          multiLocation={multiLocation}
          otherLocationName={otherLocationName}
          questionTypesAllowed={questionTypesAllowed}
        />
      )}

      {draftedItems.length === 0 ? (
        <div className="mt-2 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.templates.builder.no_items")}
        </div>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {draftedItems.map((item, i) => (
            <li key={item.id} id={`tb-item-${item.id}`}>
              <ItemRow
                templateId={template.id}
                locationId={template.locationId}
                item={item}
                linkTargets={linkTargets}
                referenceTargets={referenceTargets}
                canFill={canFill}
                expanded={expanded.has(item.id)}
                onToggle={() => toggle(item.id)}
                onEdit={onEdit}
                onRemoveDraftAdd={onRemoveDraftAdd}
                canMoveUp={editable.length > 1 && editable.findIndex((it) => it.id === item.id) > 0}
                canMoveDown={
                  editable.length > 1 &&
                  editable.findIndex((it) => it.id === item.id) >= 0 &&
                  editable.findIndex((it) => it.id === item.id) < editable.length - 1
                }
                onMoveUp={() => move(item, -1)}
                onMoveDown={() => move(item, 1)}
                isFirst={i === 0}
                addScope={addScope[item.id] ?? null}
                otherLocationName={otherLocationName}
                questionTypesAllowed={questionTypesAllowed}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Emit the two reorder edits that swap `a` and `b`'s display orders. */
function emitReorder(
  onEdit: (edit: TemplateItemEdit) => void,
  a: ChecklistTemplateItem,
  b: ChecklistTemplateItem,
) {
  // A draft-added row (id `draft-…`) can't be a reorder TARGET server-side (no
  // source id); the publish applies adds at the tail, so we skip emitting a reorder
  // that targets a draft-added row and only reorder persisted rows. Swapping a
  // persisted row with a draft row is a no-op at publish (adds go to the tail).
  const aPersisted = !a.id.startsWith("draft-");
  const bPersisted = !b.id.startsWith("draft-");
  if (aPersisted) onEdit({ op: "reorder", itemId: a.id, displayOrder: b.displayOrder });
  if (bPersisted) onEdit({ op: "reorder", itemId: b.id, displayOrder: a.displayOrder });
}

/** Gate-tier badge label key (spec §3, PR-4): the 3-way tier — Optional /
 *  "Must complete — or explain" / "Hard gate". Derived from the two boolean columns
 *  via resolveGateTier (hard gate wins). */
function gateTierKey(item: Pick<ChecklistTemplateItem, "required" | "hardGate">): TranslationKey {
  switch (resolveGateTier(item)) {
    case "hard_gate":
      return tk("admin.templates.builder.gate.hard_gate");
    case "must_complete":
      return tk("admin.templates.builder.gate.must_complete");
    case "optional":
      return tk("admin.templates.builder.gate.optional");
  }
}

function ItemRow({
  templateId,
  locationId,
  item,
  linkTargets,
  referenceTargets,
  canFill,
  expanded,
  onToggle,
  onEdit,
  onRemoveDraftAdd,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  addScope,
  otherLocationName,
  questionTypesAllowed,
}: {
  templateId: string;
  locationId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  referenceTargets: ReferenceTargetsView;
  canFill: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (edit: TemplateItemEdit) => void;
  onRemoveDraftAdd: (tempId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  /** PR-5 (spec §8): the scope of THIS row if it's a draft-add ("both" / "one"); null
   *  for persisted rows. Drives the "both locations / this location only" indicator chip. */
  addScope: "both" | "one" | null;
  /** the peer location's name (for the "both locations" chip copy). */
  otherLocationName: string | null;
  /** Fulledit PR-2: question input types are closing-only in v1. */
  questionTypesAllowed: boolean;
}) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabelForLevel();
  const mirror = isMirrorItem(item.prepMeta);
  const needsLink = itemNeedsLink(item);
  const esLabel = item.translations?.es?.label;
  const missingEs = !mirror && !(typeof esLabel === "string" && esLabel.trim() !== "");
  const disabled = !item.active; // a draft-disabled row (renders struck-through)
  // A draft-added row can't take in-place same-day fills (it isn't persisted yet).
  const isDraftAdd = item.id.startsWith("draft-");

  const chip =
    "inline-flex items-center rounded-full border border-co-border px-2 py-0.5 text-[11px] font-semibold text-co-text-muted";
  // PR-4: hard-gated lines get an emphatic chip (they can block a whole submission).
  const chipHardGate =
    "inline-flex items-center rounded-full border-2 border-co-cta/60 bg-co-cta/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em] text-co-cta";
  const moveBtn =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg border-2 border-co-border-2 bg-co-surface text-sm font-bold text-co-text disabled:opacity-30";

  return (
    <SummaryRow
      expanded={expanded}
      onToggle={onToggle}
      toggleLabel={expanded ? t("admin.templates.builder.hide") : t("admin.templates.builder.details")}
      drawerId={`tb-drawer-${item.id}`}
      summary={
        <div className={"text-sm text-co-text" + (disabled ? " opacity-50" : "")}>
          {/* IDENTITY (D1) — en label is the anchor. */}
          <div className={"font-bold" + (disabled ? " line-through" : "")}>{item.label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {item.station && <span className={chip}>{item.station}</span>}
            {/* Gate-tier badge (3-way, PR-4): hard gate gets a distinct emphatic chip. */}
            <span className={item.hardGate ? chipHardGate : chip}>{t(gateTierKey(item))}</span>
            <span className={chip}>{roleLabel(item.minRoleLevel)}</span>
            {item.expectsCount && <span className={chip}>{t("admin.templates.builder.flag.count")}</span>}
            {item.expectsPhoto && <span className={chip}>{t("admin.templates.builder.flag.photo")}</span>}
            {/* Fulledit PR-2: the question input-type on the identity line (D1). */}
            {item.inputType === "yes_no" && <span className={chip}>{t("admin.templates.builder.input_type.yes_no")}</span>}
            {item.inputType === "free_text" && <span className={chip}>{t("admin.templates.builder.input_type.free_text")}</span>}
          </div>
          {/* Reorder (phone-first up/down; spec §7) — non-mirror rows only. */}
          {canFill && !mirror && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <button
                type="button"
                className={moveBtn}
                aria-label={t("admin.templates.builder.move_up")}
                disabled={!canMoveUp}
                onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              >
                ↑
              </button>
              <button
                type="button"
                className={moveBtn}
                aria-label={t("admin.templates.builder.move_down")}
                disabled={!canMoveDown}
                onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
              >
                ↓
              </button>
            </div>
          )}
        </div>
      }
      badges={
        <>
          {/* Never-collapse alerts (D2). */}
          {mirror && (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-co-text-muted">
              {t("admin.templates.builder.badge.mirror")}
            </span>
          )}
          {disabled && (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-co-text-muted">
              {t("admin.templates.builder.disabled_badge")}
            </span>
          )}
          {missingEs && !isDraftAdd && (
            <span className="inline-flex items-center rounded-full bg-co-cta/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-co-cta">
              {t("admin.templates.builder.badge.missing_es")}
            </span>
          )}
          {needsLink && (
            <span className="inline-flex items-center rounded-full bg-co-cta/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-co-cta">
              {t("admin.templates.builder.badge.needs_link")}
            </span>
          )}
          {/* PR-5 (spec §8): the location-scope indicator on draft-added rows — "both
              locations" (fanned) or "this location only". Informational; not an alert. */}
          {isDraftAdd && addScope !== null && (
            <span className="inline-flex items-center rounded-full bg-co-gold/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-co-text">
              {addScope === "both"
                ? t("admin.templates.builder.badge.both_locations")
                : t("admin.templates.builder.badge.this_location_only")}
            </span>
          )}
        </>
      }
    >
      <ItemDrawer
        templateId={templateId}
        locationId={locationId}
        item={item}
        linkTargets={linkTargets}
        referenceTargets={referenceTargets}
        canFill={canFill}
        mirror={mirror}
        isDraftAdd={isDraftAdd}
        onEdit={onEdit}
        onRemoveDraftAdd={onRemoveDraftAdd}
        questionTypesAllowed={questionTypesAllowed}
      />
    </SummaryRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Item drawer — description, Spanish (visible + fill-count), es-fill form,
// spine-link picker.
// ─────────────────────────────────────────────────────────────────────────────

function ItemDrawer({
  templateId,
  locationId,
  item,
  linkTargets,
  referenceTargets,
  canFill,
  mirror,
  isDraftAdd,
  onEdit,
  onRemoveDraftAdd,
  questionTypesAllowed,
}: {
  templateId: string;
  locationId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  referenceTargets: ReferenceTargetsView;
  canFill: boolean;
  mirror: boolean;
  isDraftAdd: boolean;
  onEdit: (edit: TemplateItemEdit) => void;
  onRemoveDraftAdd: (tempId: string) => void;
  /** Fulledit PR-2: question input types are closing-only in v1. */
  questionTypesAllowed: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      {/* Description (read-only this PR). */}
      {item.description && (
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.templates.builder.description")}
          </p>
          <p className="mt-0.5 text-sm text-co-text">{item.description}</p>
        </div>
      )}

      {mirror ? (
        <p className="rounded-lg border border-co-border/60 bg-co-surface px-3 py-2 text-sm text-co-text-muted">
          {t("admin.templates.builder.mirror_managed")}
        </p>
      ) : (
        <>
          {/* Structural edits (PR-3 draft): relabel/describe, gate-flip, role, and
              disable/enable. All version at publish. Draft-added rows edit their own
              draft edit; persisted rows emit an edit against their id. */}
          {canFill && (
            <StructuralEdits
              item={item}
              locationId={locationId}
              isDraftAdd={isDraftAdd}
              referenceTargets={referenceTargets}
              onEdit={onEdit}
              onRemoveDraftAdd={onRemoveDraftAdd}
              questionTypesAllowed={questionTypesAllowed}
            />
          )}

          {/* Same-day fills (PR-0) — persisted rows only (a draft-add isn't linked
              yet; its Spanish + spine link are set at add time / by re-adding). */}
          {!isDraftAdd && (
            <>
              <SpanishBlock templateId={templateId} item={item} canFill={canFill} />
              {item.expectsCount && (
                <SpineLinkBlock templateId={templateId} item={item} linkTargets={linkTargets} canFill={canFill} />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Structural edit affordances (PR-3 draft): relabel, describe, gate-tier (required)
 *  flip, role, disable/enable. Emits TemplateItemEdit into the draft; the parent
 *  applies them in memory + publishes them as a new version. Draft-added rows can't
 *  target a persisted id — their structural fields were set at add time, so we only
 *  expose disable (remove-from-draft would be cleaner but disable keeps the model
 *  simple + honest). */
function StructuralEdits({
  item,
  locationId,
  isDraftAdd,
  referenceTargets,
  onEdit,
  onRemoveDraftAdd,
  questionTypesAllowed,
}: {
  item: ChecklistTemplateItem;
  locationId: string;
  isDraftAdd: boolean;
  referenceTargets: ReferenceTargetsView;
  onEdit: (edit: TemplateItemEdit) => void;
  onRemoveDraftAdd: (tempId: string) => void;
  /** Fulledit PR-2: question input types are closing-only in v1. */
  questionTypesAllowed: boolean;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(item.label);
  const [description, setDescription] = useState(item.description ?? "");
  const disabled = !item.active;

  // Draft-added rows: their id is `draft-…` and can't be a server edit target —
  // and a disable edit against it is a NO-OP in both the preview and the publish
  // copy (adversarial review M1). The honest affordance for an unwanted add is
  // REMOVE (drops the add from the draft entirely). Relabel/role/required on a
  // draft-add are set at add-time.
  const idForEdit = item.id;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-co-border/60 bg-co-surface p-3">
      {!isDraftAdd && (
        <>
          <label className="block text-sm">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.templates.builder.edit_label")}
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => { if (label.trim() && label !== item.label) onEdit({ op: "relabel", itemId: idForEdit, label: label.trim() }); }}
              className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.templates.builder.edit_description")}
            </span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => { const v = description.trim() || null; if (v !== (item.description ?? null)) onEdit({ op: "describe", itemId: idForEdit, description: v }); }}
              className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.templates.builder.role_label")}
            </span>
            <select
              value={item.minRoleLevel}
              onChange={(e) => onEdit({ op: "role", itemId: idForEdit, minRoleLevel: Number(e.target.value) })}
              className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
            >
              {roleLevelOptions().map((o) => (
                <option key={o.level} value={o.level}>{o.label}</option>
              ))}
            </select>
          </label>
          {/* Gate tier (3-way, spec §3, PR-4): Optional / must-complete-or-explain /
              hard gate. Emits a gate_tier op carrying BOTH columns. Hard gate shows a
              plain warning (staff cannot submit at all until it's done — use rarely). */}
          <label className="block text-sm">
            <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.templates.builder.gate.tier_label")}
            </span>
            <select
              value={resolveGateTier(item)}
              onChange={(e) => {
                const tier = e.target.value as "optional" | "must_complete" | "hard_gate";
                onEdit({
                  op: "gate_tier",
                  itemId: idForEdit,
                  required: tier !== "optional",
                  hardGate: tier === "hard_gate",
                });
              }}
              className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
            >
              <option value="optional">{t("admin.templates.builder.gate.optional")}</option>
              <option value="must_complete">{t("admin.templates.builder.gate.must_complete")}</option>
              <option value="hard_gate">{t("admin.templates.builder.gate.hard_gate")}</option>
            </select>
            {item.hardGate && (
              <span className="mt-1 block text-xs font-semibold text-co-cta">
                {t("admin.templates.builder.gate.hard_gate_warning")}
              </span>
            )}
          </label>

          {/* Fulledit PR-2: the input-type control for existing lines — Tick / Yes/No /
              Free text (null = tick). Emits the input_type edit op into the draft;
              versions at publish. CLOSING-ONLY in v1 (opening's answer path has no
              input_type awareness — the control doesn't render there). Count lines
              can't switch here (a count needs a spine link → add-time-only, matching
              how the drawer can't toggle expects_count either) and PHOTO lines can't
              either (the Yes/No save carries no photo, so a question+photo line would
              be unanswerable): both show the control DISABLED with a short hint. */}
          {questionTypesAllowed ? (
            <label className="block text-sm">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                {t("admin.templates.builder.input_type.drawer_label")}
              </span>
              {item.expectsCount || item.expectsPhoto ? (
                <>
                  <select
                    value={item.expectsCount ? "count" : "tick"}
                    disabled
                    className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text-muted disabled:opacity-70"
                  >
                    <option value="count">{t("admin.templates.builder.input_type.count")}</option>
                    <option value="tick">{t("admin.templates.builder.input_type.tick")}</option>
                  </select>
                  <span className="mt-1 block text-xs text-co-text-muted">
                    {item.expectsCount
                      ? t("admin.templates.builder.input_type.count_locked_hint")
                      : t("admin.templates.builder.input_type.photo_locked_hint")}
                  </span>
                </>
              ) : (
                <select
                  value={item.inputType ?? "tick"}
                  onChange={(e) => {
                    const v = e.target.value;
                    onEdit({
                      op: "input_type",
                      itemId: idForEdit,
                      inputType: v === "tick" ? null : (v as "yes_no" | "free_text"),
                    });
                  }}
                  className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
                >
                  <option value="tick">{t("admin.templates.builder.input_type.tick")}</option>
                  <option value="yes_no">{t("admin.templates.builder.input_type.yes_no")}</option>
                  <option value="free_text">{t("admin.templates.builder.input_type.free_text")}</option>
                </select>
              )}
            </label>
          ) : null}

          {/* Connections (spec §5, PR-4): the report-reference picker + the ref-track
              picker. Persisted non-mirror rows only. */}
          <ConnectionsEditor item={item} locationId={locationId} referenceTargets={referenceTargets} onEdit={onEdit} />
        </>
      )}
      {isDraftAdd ? (
        <button
          type="button"
          onClick={() => onRemoveDraftAdd(item.id.slice("draft-".length))}
          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border-2 border-co-cta/50 bg-co-surface px-4 text-sm font-bold text-co-cta"
        >
          {t("admin.templates.builder.remove_draft_add")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onEdit(disabled ? { op: "enable", itemId: idForEdit } : { op: "disable", itemId: idForEdit })}
          className={
            "inline-flex min-h-[40px] items-center justify-center rounded-lg border-2 px-4 text-sm font-bold " +
            (disabled
              ? "border-co-gold-deep bg-co-gold text-co-text"
              : "border-co-cta/50 bg-co-surface text-co-cta")
          }
        >
          {disabled ? t("admin.templates.builder.enable") : t("admin.templates.builder.disable")}
        </button>
      )}
    </div>
  );
}

/** Connections (spec §5, PR-4): the report-reference picker + the ref-track picker.
 *  Both are STRUCTURAL edits (change submit/reconcile behavior) → they version via
 *  publish. Persisted non-mirror rows only (the caller gates on isDraftAdd/mirror). */
function ConnectionsEditor({
  item,
  locationId,
  referenceTargets,
  onEdit,
}: {
  item: ChecklistTemplateItem;
  /** the active template's location — reference targets are location-scoped. */
  locationId: string;
  referenceTargets: ReferenceTargetsView;
  onEdit: (edit: TemplateItemEdit) => void;
}) {
  const { t } = useTranslation();
  const [refQuery, setRefQuery] = useState("");

  // Reference targets are the OTHER list's active items for THIS item's location.
  // Filter by the active template location (the reference partner shares the location).
  const locationTargets = useMemo(
    () => referenceTargets.targets.filter((r) => r.locationId === locationId),
    [referenceTargets, locationId],
  );
  const filteredTargets = useMemo(() => {
    const q = refQuery.trim().toLowerCase();
    return locationTargets.filter((r) => (q ? r.label.toLowerCase().includes(q) : true)).slice(0, 12);
  }, [locationTargets, refQuery]);

  const currentTarget = item.referencesTemplateItemId
    ? locationTargets.find((r) => r.itemId === item.referencesTemplateItemId) ?? null
    : null;
  const referenceableAvailable = referenceTargets.targets.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-co-border/60 bg-co-surface p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
        {t("admin.templates.builder.connections.title")}
      </p>

      {/* Report-reference type (spec §5) — the artifact whose finalize auto-ticks this
          item. Only reconcile-backed values are offered (each is auto-tickable). */}
      <label className="block text-sm">
        <span className="text-co-text-muted">{t("admin.templates.builder.connections.report_ref_label")}</span>
        <select
          value={item.reportReferenceType ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onEdit({
              op: "set_report_ref",
              itemId: item.id,
              refType: v === "" ? null : (v as ReconciledReportRefType),
            });
          }}
          className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
        >
          <option value="">{t("admin.templates.builder.connections.report_ref_none")}</option>
          {RECONCILED_REPORT_REF_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {t(tk(`admin.templates.builder.connections.report_ref.${rt}`))}
            </option>
          ))}
        </select>
      </label>

      {/* ref_track (spec §5, the ONE new mechanism) — auto-tick when a SPECIFIC item on
          the OTHER list completes. Only offered when the other list has targets here. */}
      {referenceableAvailable && (
        <div>
          <span className="block text-sm text-co-text-muted">
            {t("admin.templates.builder.connections.ref_track_label")}
          </span>
          {currentTarget ? (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-sm text-co-success">{currentTarget.label}</span>
              <button
                type="button"
                onClick={() => onEdit({ op: "ref_track", itemId: item.id, targetItemId: null })}
                className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-cta/50 bg-co-surface px-3 text-xs font-bold text-co-cta"
              >
                {t("admin.templates.builder.connections.ref_track_clear")}
              </button>
            </div>
          ) : (
            <>
              <input
                type="search"
                aria-label={t("admin.templates.builder.connections.ref_track_search")}
                placeholder={t("admin.templates.builder.connections.ref_track_search")}
                value={refQuery}
                onChange={(e) => setRefQuery(e.target.value)}
                className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
              />
              <ul className="mt-1 flex flex-col gap-1">
                {filteredTargets.length === 0 ? (
                  <li className="text-xs text-co-text-muted">
                    {t("admin.templates.builder.connections.ref_track_none")}
                  </li>
                ) : (
                  filteredTargets.map((r) => (
                    <li key={r.itemId} className="flex items-center justify-between gap-2">
                      <span className="text-sm text-co-text">{r.label}</span>
                      <button
                        type="button"
                        onClick={() => onEdit({ op: "ref_track", itemId: item.id, targetItemId: r.itemId })}
                        className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
                      >
                        {t("admin.templates.builder.connections.ref_track_pick")}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * SubmissionGateSetting (spec §5, PR-4) — the TEMPLATE-level "Requires" control. Writes
 * the existing submission_gate_predicate JSONB (evaluated by evaluateGatePredicate).
 * The UI exposes ONLY the shapes the evaluator handles: "none" OR "the reference partner
 * (opening/closing) submitted today" — a single clause of the requires_state shape. The
 * change rides the SAME publish flow (a draft templatePatch), not a separate route.
 */
function SubmissionGateSetting({
  type,
  current,
  draftPredicate,
  onChange,
}: {
  type: TemplateBuilderType;
  /** the source template's current predicate (null = no gate). */
  current: GatePredicate | null;
  /** the drafted predicate (undefined = untouched → shows `current`). */
  draftPredicate: GatePredicate | null | undefined;
  onChange: (predicate: GatePredicate | null) => void;
}) {
  const { t } = useTranslation();

  // The reference partner whose submission this list can require (spec §5: closing
  // requires opening, opening requires prior closing). deep_cleaning has no partner.
  const partner: ChecklistType | null = type === "closing" ? "opening" : type === "opening" ? "closing" : null;

  // The effective predicate the control reflects: the draft if touched, else the source.
  const effective = draftPredicate !== undefined ? draftPredicate : current;
  // We recognize exactly ONE builder-authored shape: a single requires_state clause on
  // the partner type. Anything else (a hand-authored multi-clause predicate) shows as
  // "custom" and is left untouched (the control degrades to read-only for it).
  const firstClause = effective?.requires_state?.[0] ?? null;
  const isBuilderShape =
    !effective || (effective.requires_state.length === 1 && firstClause?.template_type === partner);
  const gateOn = effective !== null && effective.requires_state.length > 0;

  if (partner === null) return null; // deep_cleaning: no reference partner

  // The concrete "submitted" clause the builder writes for the partner (any non-open
  // finalized status counts as submitted; offset 0 = same operational day for closing↔
  // opening — the reconcile family's same-day convention, Juan 2026-06-16).
  const submittedPredicate: GatePredicate = {
    requires_state: [
      {
        template_type: partner,
        operational_date_offset: type === "opening" ? -1 : 0,
        status_in: ["confirmed", "incomplete_confirmed", "auto_finalized"],
      },
    ],
  };

  return (
    <CollapsibleSection idBase="tb-submission-gate" title={t("admin.templates.builder.gate_setting.title")}>
      {!isBuilderShape ? (
        <p className="text-sm text-co-text-muted">{t("admin.templates.builder.gate_setting.custom")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2 text-sm text-co-text">
            <input
              type="radio"
              name="tb-submission-gate"
              checked={!gateOn}
              onChange={() => onChange(null)}
              className="mt-0.5 h-5 w-5"
            />
            {t("admin.templates.builder.gate_setting.none")}
          </label>
          <label className="flex items-start gap-2 text-sm text-co-text">
            <input
              type="radio"
              name="tb-submission-gate"
              checked={gateOn}
              onChange={() => onChange(submittedPredicate)}
              className="mt-0.5 h-5 w-5"
            />
            {t(tk(`admin.templates.builder.gate_setting.requires_${partner}`))}
          </label>
          {draftPredicate !== undefined && (
            <p className="text-xs font-semibold text-co-cta">
              {t("admin.templates.builder.gate_setting.pending_publish")}
            </p>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

/** Quick-add (spec §7): the 60-second add flow. Label + section + role + required,
 *  defaults carried from the last item; the count toggle reveals a REQUIRED spine-
 *  link picker (dismiss reverts the toggle). PR-5 (spec §8): a "Both locations" toggle
 *  (default ON) fans the add into BOTH templates' drafts; unchecking = "this location
 *  only". Emits via onAdd(base, bothLocations) — the parent handles the fan-out. */
function QuickAdd({
  draftedItems,
  linkTargets,
  onAdd,
  multiLocation,
  otherLocationName,
  questionTypesAllowed,
}: {
  draftedItems: ChecklistTemplateItem[];
  linkTargets: LinkTarget[];
  onAdd: (
    base: Omit<Extract<TemplateItemEdit, { op: "add" }>, "op" | "tempId" | "displayOrder">,
    bothLocations: boolean,
  ) => void;
  multiLocation: boolean;
  otherLocationName: string | null;
  /** Fulledit PR-2: question input types are closing-only in v1. */
  questionTypesAllowed: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Defaults carried from the last non-mirror item (spec §7).
  const last = [...draftedItems].reverse().find((it) => !isMirrorItem(it.prepMeta));
  const [label, setLabel] = useState("");
  const [station, setStation] = useState<string>(last?.station ?? "");
  const [role, setRole] = useState<number>(last?.minRoleLevel ?? 3);
  const [required, setRequired] = useState(true);
  // Fulledit PR-2: the line's INPUT TYPE — the single source of truth for what
  // kind of step this is. "count" maps to the existing expects_count + spine-link
  // flow (unchanged); "yes_no" / "free_text" set inputType on the add op and hide
  // the count controls (client mirror of the DB CHECK — a line is a count line OR
  // a question line, never both). "tick" is the plain default.
  const [inputType, setInputType] = useState<"tick" | "count" | "yes_no" | "free_text">("tick");
  const expectsCount = inputType === "count";
  const [spine, setSpine] = useState<LinkTarget | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);
  // PR-5 (spec §8): both-locations default ON (explicit, shown). Only meaningful when
  // >1 location is visible; single-location tenants never see the toggle (always "one").
  const [bothLocations, setBothLocations] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return linkTargets.filter((tg) => (q ? tg.name.toLowerCase().includes(q) : true)).slice(0, 12);
  }, [linkTargets, query]);

  const reset = () => {
    setLabel(""); setInputType("tick"); setSpine(null); setQuery(""); setError(null);
    // bothLocations scope PERSISTS across repeat-adds (defaults carry, spec §7).
  };

  const add = () => {
    if (!label.trim()) return;
    if (expectsCount && !spine) { setError("admin.templates.builder.add_count_link_required"); return; }
    onAdd(
      {
        label: label.trim(),
        station: station || null,
        minRoleLevel: role,
        required,
        expectsCount,
        // Map the picked LinkTarget (kind+id+name+…) to the wire SpineLinkTarget (kind+id).
        spineLink: expectsCount && spine ? { kind: spine.kind, id: spine.id } : null,
        // Fulledit PR-2: a question line carries its input type; count/tick lines
        // leave it undefined (the wire guard rejects inputType + expectsCount together).
        ...(inputType === "yes_no" || inputType === "free_text" ? { inputType } : {}),
      },
      multiLocation ? bothLocations : false,
    );
    reset();
    // Keep the panel open for rapid repeat-adds (defaults carry).
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-dashed border-co-gold-deep bg-co-surface px-4 text-sm font-bold text-co-text hover:bg-co-gold/15"
      >
        {t("admin.templates.builder.add_item")}
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border-2 border-co-gold-deep/50 bg-co-surface p-3">
      <label className="block text-sm">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
          {t("admin.templates.builder.add_item_label")}
        </span>
        <input
          type="text"
          value={label}
          autoFocus
          placeholder={t("admin.templates.builder.add_item_placeholder")}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !expectsCount) { e.preventDefault(); add(); } }}
          className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <label className="block flex-1 text-sm">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.templates.builder.add_station_label")}
          </span>
          <input
            type="text"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
          />
        </label>
        <label className="block flex-1 text-sm">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
            {t("admin.templates.builder.add_role_label")}
          </span>
          <select
            value={role}
            onChange={(e) => setRole(Number(e.target.value))}
            className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-bg px-3 text-sm text-co-text"
          >
            {roleLevelOptions().map((o) => (
              <option key={o.level} value={o.level}>{o.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-co-text">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="h-5 w-5" />
        {t("admin.templates.builder.add_required_label")}
      </label>

      {/* Fulledit PR-2: input-type selector — Tick (default) · Count · Yes/No ·
          Free text. "Count" = the existing expects_count + spine-link flow; picking
          Yes/No or Free text hides the count controls (client mirror of the DB CHECK). */}
      <fieldset>
        <legend className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
          {t("admin.templates.builder.input_type.label")}
        </legend>
        <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={t("admin.templates.builder.input_type.label")}>
          {(questionTypesAllowed ? (["tick", "count", "yes_no", "free_text"] as const) : (["tick", "count"] as const)).map((it) => {
            const activeChip = inputType === it;
            return (
              <button
                key={it}
                type="button"
                role="radio"
                aria-checked={activeChip}
                onClick={() => {
                  setInputType(it);
                  // Leaving count resets the spine + any count-link error.
                  if (it !== "count") { setSpine(null); setError(null); }
                }}
                className={
                  "inline-flex min-h-[36px] items-center rounded-full border-2 px-3 text-sm font-bold transition " +
                  (activeChip
                    ? "border-co-gold-deep bg-co-gold/25 text-co-text"
                    : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text")
                }
              >
                {t(tk(`admin.templates.builder.input_type.${it}`))}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Spine-link picker — appears ONLY when the count input type is chosen (required). */}
      {expectsCount && (
        <div className="rounded-lg border border-co-border/60 bg-co-bg p-2">
          {spine ? (
            <p className="text-sm text-co-success">{spine.name}</p>
          ) : (
            <>
              <input
                type="search"
                aria-label={t("admin.templates.needs_link.search_label")}
                placeholder={t("admin.templates.needs_link.search_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text"
              />
              <ul className="mt-1 flex flex-col gap-1">
                {filtered.map((tg) => (
                  <li key={`${tg.kind}:${tg.id}`} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-co-text">{tg.name}</span>
                    <button
                      type="button"
                      onClick={() => { setSpine(tg); setError(null); }}
                      className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
                    >
                      {t("admin.templates.needs_link.link")}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* PR-5 (spec §8): Both-locations toggle (default ON, explicit + shown). Unchecking
          = "this location only" (the per-item intentional-drift choice at add time). Only
          shown when >1 location is visible. */}
      {multiLocation && (
        <label className="flex items-start gap-2 rounded-lg border border-co-gold-deep/40 bg-co-gold/5 p-2 text-sm text-co-text">
          <input
            type="checkbox"
            checked={bothLocations}
            onChange={(e) => setBothLocations(e.target.checked)}
            className="mt-0.5 h-5 w-5"
          />
          <span>
            {t("admin.templates.builder.add_both_locations")}
            <span className="mt-0.5 block text-xs text-co-text-muted">
              {bothLocations
                ? t("admin.templates.builder.add_both_locations_on", { other: otherLocationName ?? "" })
                : t("admin.templates.builder.add_this_location_only")}
            </span>
          </span>
        </label>
      )}

      {error && <p className="text-sm font-semibold text-co-cta">{t(error)}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={add}
          disabled={!label.trim()}
          className="inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold text-co-text disabled:opacity-50"
        >
          {t("admin.templates.builder.add_confirm")}
        </button>
        <button
          type="button"
          onClick={() => { reset(); setOpen(false); }}
          className="inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-4 text-sm font-bold text-co-text-muted"
        >
          {t("admin.templates.builder.add_cancel")}
        </button>
      </div>
    </div>
  );
}

/** Spanish fields — VISIBLE with a fill-count header (D5); the strict FILL form
 *  edits ONLY currently-empty fields (an existing es value is read-only here —
 *  changing it is a content edit → PR-3). */
function SpanishBlock({
  templateId,
  item,
  canFill,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  canFill: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const es = item.translations?.es ?? {};
  const has = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
  // The three fillable fields, with current value + whether they're empty.
  const fields = [
    { key: "labelEs" as const, labelKey: "admin.templates.field.label_es", current: es.label ?? null, en: item.label },
    { key: "descriptionEs" as const, labelKey: "admin.templates.field.description_es", current: es.description ?? null, en: item.description },
    {
      key: "specialInstructionEs" as const,
      labelKey: "admin.templates.field.special_instruction_es",
      current: es.specialInstruction ?? null,
      en: item.prepMeta?.specialInstruction ?? null,
    },
  ].filter((f) => f.en !== null && f.en !== ""); // only fields with an English source

  const filled = fields.filter((f) => has(f.current)).length;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const emptyFields = fields.filter((f) => !has(f.current));
  const hasEdits = emptyFields.some((f) => (draft[f.key] ?? "").trim() !== "");

  const save = async () => {
    if (busy || !hasEdits) return;
    setErrorKey(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const body: Record<string, string> = {};
    for (const f of emptyFields) {
      const v = (draft[f.key] ?? "").trim();
      if (v) body[f.key] = v;
    }
    try {
      const res = await fetch(
        `/api/admin/template-builder/${templateId}/items/${item.id}/translations`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          redirect: "manual",
        },
      );
      if (res.ok) {
        router.refresh();
        return;
      }
      setErrorKey("admin.templates.builder.fill_error");
    } catch {
      setErrorKey("admin.templates.builder.fill_error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
        {/* Fill-count header (D5): "Spanish 2/3". */}
        {t("admin.templates.builder.spanish_count", { filled: String(filled), total: String(fields.length) })}
      </p>
      <div className="mt-1 flex flex-col gap-2">
        {fields.map((f) =>
          has(f.current) ? (
            // Existing es value — read-only (changing it is a PR-3 content edit).
            <div key={f.key} className="text-sm">
              <span className="text-co-text-muted">{t(tk(f.labelKey))}: </span>
              <span className="text-co-text">{f.current}</span>
            </div>
          ) : canFill ? (
            <label key={f.key} className="block text-sm">
              <span className="text-co-text-muted">{t(tk(f.labelKey))}</span>
              <input
                type="text"
                value={draft[f.key] ?? ""}
                disabled={busy}
                placeholder={f.en ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text disabled:opacity-50"
              />
            </label>
          ) : (
            <div key={f.key} className="text-sm text-co-text-muted">
              {t(tk(f.labelKey))}: {t("admin.templates.builder.es_missing")}
            </div>
          ),
        )}
      </div>
      {errorKey && <p className="mt-2 text-sm font-semibold text-co-cta">{t(errorKey)}</p>}
      {canFill && emptyFields.length > 0 && (
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !hasEdits}
          className="mt-2 inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold text-co-text disabled:opacity-50"
        >
          {busy ? t("admin.templates.builder.saving") : t("admin.templates.builder.fill_spanish")}
        </button>
      )}
    </div>
  );
}

/** Spine-link picker — ONLY on count-bearing lines. When already linked, shows
 *  the link read-only; when unlinked, GM+ gets the items+SKUs picker (Tier-A). */
function SpineLinkBlock({
  templateId,
  item,
  linkTargets,
  canFill,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  canFill: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const linked = item.itemId !== null || item.vendorItemId !== null;
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "item" | "sku">("all");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return linkTargets
      .filter((tg) => (kindFilter === "all" ? true : tg.kind === kindFilter))
      .filter((tg) => (q ? tg.name.toLowerCase().includes(q) : true))
      .slice(0, 20);
  }, [linkTargets, query, kindFilter]);

  const link = async (target: LinkTarget) => {
    if (busy) return;
    setErrorKey(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/template-builder/${templateId}/items/${item.id}/spine-link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetKind: target.kind, targetId: target.id }),
          redirect: "manual",
        },
      );
      if (res.ok) {
        router.refresh();
        return;
      }
      setErrorKey("admin.templates.builder.link_error");
    } catch {
      setErrorKey("admin.templates.builder.link_error");
    } finally {
      setBusy(false);
    }
  };

  const kindChip = (activeChip: boolean) =>
    `inline-flex min-h-[32px] items-center rounded-full border-2 px-3 text-xs font-bold transition ${
      activeChip
        ? "border-co-gold-deep bg-co-gold/25 text-co-text"
        : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
        {t("admin.templates.builder.spine_link")}
      </p>
      {linked ? (
        <p className="mt-1 text-sm text-co-success">{t("admin.templates.builder.linked")}</p>
      ) : !canFill ? (
        <p className="mt-1 text-sm text-co-cta">{t("admin.templates.builder.needs_link_body")}</p>
      ) : (
        <div className="mt-1">
          <p className="text-sm text-co-cta">{t("admin.templates.builder.needs_link_body")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={kindChip(kindFilter === "all")} aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")}>
              {t("admin.templates.needs_link.filter_all")}
            </button>
            <button type="button" className={kindChip(kindFilter === "item")} aria-pressed={kindFilter === "item"} onClick={() => setKindFilter("item")}>
              {t("admin.templates.needs_link.filter_items")}
            </button>
            <button type="button" className={kindChip(kindFilter === "sku")} aria-pressed={kindFilter === "sku"} onClick={() => setKindFilter("sku")}>
              {t("admin.templates.needs_link.filter_skus")}
            </button>
          </div>
          <input
            type="search"
            aria-label={t("admin.templates.needs_link.search_label")}
            placeholder={t("admin.templates.needs_link.search_placeholder")}
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2 min-h-[40px] w-full max-w-sm rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text disabled:opacity-50"
          />
          {errorKey && <p className="mt-2 text-sm font-semibold text-co-cta">{t(errorKey)}</p>}
          <ul className="mt-2 flex flex-col gap-1">
            {filtered.length === 0 ? (
              <li className="text-xs text-co-text-muted">{t("admin.templates.needs_link.no_targets")}</li>
            ) : (
              filtered.map((tg) => (
                <li key={`${tg.kind}:${tg.id}`} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-co-text">
                    {tg.name}
                    <span className="rounded bg-co-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">
                      {t(tk(`admin.catalog.type.${tg.typeLabel}`))}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void link(tg)}
                    className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15 disabled:opacity-50"
                  >
                    {busy ? t("admin.templates.needs_link.linking") : t("admin.templates.needs_link.link")}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Publish bar (spec §1/§7) — dirty banner (D2, never collapses) + Publish button
// + confirm modal (diff summary via classifyEdits, effective note, apply-now toggle
// behind its own step-up, open-instances count). Every publish versions.
// ─────────────────────────────────────────────────────────────────────────────

function PublishBar({
  template,
  edits,
  templatePatch,
  openInstancesToday,
  onPublished,
  otherLocationDirty,
  otherLocationName,
}: {
  template: TemplateBuilderTemplate;
  edits: TemplateItemEdit[];
  /** PR-4: the template-level submission-gate change riding this publish (undefined = none). */
  templatePatch: TemplatePatch | undefined;
  openInstancesToday: number;
  onPublished: () => void;
  /** PR-5 (spec §8): the peer location's draft is also dirty → surface "also publish
   *  <other>" guidance. Publish stays PER TEMPLATE (two taps; no cross-lineage atomic). */
  otherLocationDirty: boolean;
  otherLocationName: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyNow, setApplyNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  // Dirty when there are item edits OR a template-level gate change (spec §5).
  const dirty = edits.length > 0 || templatePatch !== undefined;
  const diff = useMemo(() => classifyEdits(template.items, edits), [template.items, edits]);

  if (!dirty) return null;

  const diffChips: string[] = [];
  if (diff.added.length) diffChips.push(t("admin.templates.builder.publish_diff_added", { n: String(diff.added.length) }));
  if (diff.removed.length) diffChips.push(t("admin.templates.builder.publish_diff_removed", { n: String(diff.removed.length) }));
  if (diff.relabeled.length) diffChips.push(t("admin.templates.builder.publish_diff_relabeled", { n: String(diff.relabeled.length) }));
  if (diff.reordered) diffChips.push(t("admin.templates.builder.publish_diff_reordered", { n: String(diff.reordered) }));
  if (diff.roleChanged.length) diffChips.push(t("admin.templates.builder.publish_diff_role", { n: String(diff.roleChanged.length) }));
  if (diff.requiredChanged.length) diffChips.push(t("admin.templates.builder.publish_diff_required", { n: String(diff.requiredChanged.length) }));
  if (diff.gateChanged.length) diffChips.push(t("admin.templates.builder.publish_diff_gate", { n: String(diff.gateChanged.length) }));
  if (diff.inputTypeChanged.length) diffChips.push(t("admin.templates.builder.publish_diff_input_type", { n: String(diff.inputTypeChanged.length) }));
  if (diff.referenceChanged) diffChips.push(t("admin.templates.builder.publish_diff_reference", { n: String(diff.referenceChanged) }));
  if (templatePatch !== undefined) diffChips.push(t("admin.templates.builder.publish_diff_gate_setting"));

  const publish = async () => {
    if (busy) return;
    setErrorKey(null);
    // busy flips BEFORE the async step-up (adversarial review L5): two fast taps
    // could otherwise both pass the guard during the step-up await and publish
    // twice. Reset on a declined step-up.
    setBusy(true);
    // Apply-now requires its OWN step-up (Tier-A) on top of the drawer's; a next-day
    // publish also steps up (GM+ Tier-A at the route). Request once here.
    if ((await requestStepUp("A")) !== "ok") {
      setBusy(false);
      return;
    }
    try {
      const res = await fetch(`/api/admin/template-builder/${template.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          edits,
          effectiveMode: applyNow ? "apply_now" : "next_day",
          ...(templatePatch !== undefined ? { templatePatch } : {}),
        }),
        redirect: "manual",
      });
      if (res.ok) {
        setConfirmOpen(false);
        onPublished();
        router.refresh();
        return;
      }
      // Distinguish the apply-now-blocked case for a precise message.
      let code = "";
      try { code = ((await res.json()) as { error?: string }).error ?? ""; } catch { /* ignore */ }
      setErrorKey(code === "apply_now_blocked_open_instance"
        ? "admin.templates.builder.apply_now_blocked"
        : "admin.templates.builder.publish_error");
    } catch {
      setErrorKey("admin.templates.builder.publish_error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Dirty banner (D2 — never collapses). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-co-cta/40 bg-co-cta/5 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-co-text">{t("admin.templates.builder.dirty_banner")}</span>
          {/* PR-5 (spec §8): the peer location's draft is also dirty. Publish is PER
              TEMPLATE (two taps) — remind the manager to publish the other location too. */}
          {otherLocationDirty && (
            <span className="text-xs font-semibold text-co-cta">
              {t("admin.templates.builder.also_publish_other", { other: otherLocationName ?? "" })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => { setConfirmOpen(true); setApplyNow(false); setErrorKey(null); }}
          className="inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-5 text-sm font-extrabold text-co-text"
        >
          {t("admin.templates.builder.publish")}
        </button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="tb-publish-title">
          <div className="w-full max-w-md rounded-2xl border-2 border-co-border bg-co-bg p-4 shadow-xl">
            <h3 id="tb-publish-title" className="text-lg font-extrabold text-co-text">
              {t("admin.templates.builder.publish_confirm_title")}
            </h3>

            {/* Diff summary. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {diffChips.length === 0 ? (
                <span className="text-sm text-co-text-muted">{t("admin.templates.builder.publish_diff_none")}</span>
              ) : (
                diffChips.map((c, i) => (
                  <span key={i} className="inline-flex items-center rounded-full bg-co-gold/15 px-2 py-0.5 text-xs font-bold text-co-text">
                    {c}
                  </span>
                ))
              )}
            </div>

            {/* Effective note. */}
            <p className="mt-3 text-sm font-semibold text-co-text">
              {applyNow ? t("admin.templates.builder.publish_effective_now") : t("admin.templates.builder.publish_effective_next_day")}
            </p>

            {/* Open-instances-today signal (powers the apply-now gate). */}
            {openInstancesToday > 0 && (
              <p className="mt-1 text-xs text-co-text-muted">
                {t("admin.templates.builder.open_instances_today", { n: String(openInstancesToday) })}
              </p>
            )}

            {/* Apply-now toggle behind its own explicit control + warning. */}
            <label className="mt-3 flex items-start gap-2 text-sm text-co-text">
              <input type="checkbox" checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} className="mt-0.5 h-5 w-5" />
              <span>
                {t("admin.templates.builder.apply_now_toggle")}
                <span className="mt-0.5 block text-xs text-co-cta">{t("admin.templates.builder.apply_now_warning")}</span>
              </span>
            </label>

            {errorKey && <p className="mt-2 text-sm font-semibold text-co-cta">{t(errorKey)}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-border-2 bg-co-surface px-4 text-sm font-bold text-co-text-muted disabled:opacity-50"
              >
                {t("admin.templates.builder.publish_cancel")}
              </button>
              <button
                type="button"
                onClick={() => void publish()}
                disabled={busy}
                className="inline-flex min-h-[40px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-5 text-sm font-extrabold text-co-text disabled:opacity-50"
              >
                {busy ? t("admin.templates.builder.publishing") : t("admin.templates.builder.publish_go")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone preview (spec §7) — a faithful, read-only re-render of the LIVE active
// template as staff see it: items grouped by station, labels via the translations
// resolver, en/es toggle. Presentational only (no instance, no submissions).
// ─────────────────────────────────────────────────────────────────────────────

const STATION_FALLBACK = "General";

/** Group items by station (English system key, C.38), preserving first-seen order. */
function groupByStation(items: ChecklistTemplateItem[]): Array<[string, ChecklistTemplateItem[]]> {
  const map = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    const key = it.station ?? STATION_FALLBACK;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  return [...map.entries()];
}

/** One station-grouped block of preview rows (the shared render used by both the
 *  flat closing preview and each opening phase). `mirror` flags Phase-2 rows. */
function PreviewStationGroups({
  items,
  lang,
  mirror,
}: {
  items: ChecklistTemplateItem[];
  lang: Language;
  mirror: boolean;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupByStation(items), [items]);
  return (
    <div className="flex flex-col gap-3">
      {groups.map(([station, groupItems]) => (
        <section key={station}>
          <h5 className="text-sm font-extrabold text-co-text">
            {/* Station header: resolve via the first item (all share the station). */}
            {resolveTemplateItemContent(groupItems[0]!, lang).station ??
              t("admin.templates.builder.preview.general")}
          </h5>
          <ul className="mt-1 flex flex-col gap-1.5">
            {groupItems.map((it) => {
              const c = resolveTemplateItemContent(it, lang);
              return (
                <li key={it.id} className="flex items-start gap-2 rounded-lg border border-co-border/60 bg-co-surface px-3 py-2">
                  <span aria-hidden className="mt-0.5 text-co-text-dim">☐</span>
                  <span className="flex-1 text-sm text-co-text">
                    <span className="font-semibold">{c.label}</span>
                    {c.description && <span className="block text-xs text-co-text-muted">{c.description}</span>}
                    <span className="mt-0.5 flex flex-wrap gap-1.5">
                      {/* Phase-2 rows are the AM-Prep counts (spec §7) — badge them
                          so the manager sees which lines mirror from AM Prep. */}
                      {mirror && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-text-muted">
                          {t("admin.templates.builder.preview.mirror_flag")}
                        </span>
                      )}
                      {/* PR-4: a hard-gated line gets a distinct preview marker (staff
                          cannot submit until it's done) — shown INSTEAD of "required". */}
                      {it.hardGate ? (
                        <span className="rounded bg-co-cta/15 px-1 text-[10px] font-bold uppercase tracking-wide text-co-cta">
                          {t("admin.templates.builder.preview.hard_gate")}
                        </span>
                      ) : it.required ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-cta">
                          {t("admin.templates.builder.preview.required")}
                        </span>
                      ) : null}
                      {it.expectsCount && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-text-dim">
                          {t("admin.templates.builder.flag.count")}
                        </span>
                      )}
                      {it.expectsPhoto && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-text-dim">
                          {t("admin.templates.builder.flag.photo")}
                        </span>
                      )}
                      {/* Fulledit PR-2: a question line's input type — shown so the
                          manager sees the preview asks Yes/No or a text answer, not a tick. */}
                      {it.inputType === "yes_no" && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-text-dim">
                          {t("admin.templates.builder.input_type.yes_no")}
                        </span>
                      )}
                      {it.inputType === "free_text" && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-text-dim">
                          {t("admin.templates.builder.input_type.free_text")}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PhonePreview({
  draftedItems,
}: {
  /** the DRAFTED items (source + edits applied) — the preview shows exactly what
   *  publishes. Disabled (draft-removed) rows are filtered out (they render nowhere
   *  for staff). */
  draftedItems: ChecklistTemplateItem[];
}) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<Language>("en");

  // Opening staff see PHASES (operator surface = a Phase-1 verification tab +
  // a Phase-2 prep-entry tab, opening-client.tsx). Match that fidelity: split
  // the preview into Phase 1 (non-mirror, station-grouped) and Phase 2 (the
  // AM-Prep mirror counts). A list with NO mirror rows (closing) renders the
  // flat station-grouped list exactly as PR-1 did — no phase headers leak in.
  // Only ACTIVE items render (a draft-disabled row shows nowhere for staff).
  const { phase1, phase2, hasPhases } = useMemo(() => {
    const p1: ChecklistTemplateItem[] = [];
    const p2: ChecklistTemplateItem[] = [];
    for (const it of draftedItems) {
      if (!it.active) continue;
      if (isMirrorItem(it.prepMeta)) p2.push(it);
      else p1.push(it);
    }
    return { phase1: p1, phase2: p2, hasPhases: p2.length > 0 };
  }, [draftedItems]);

  const langChip = (activeChip: boolean) =>
    `inline-flex min-h-[32px] items-center rounded-full border-2 px-3 text-xs font-bold transition ${
      activeChip ? "border-co-gold-deep bg-co-gold/25 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;

  return (
    <CollapsibleSection idBase="tb-preview" title={t("admin.templates.builder.preview.title")}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
          {t("admin.templates.builder.preview.language")}
        </span>
        <button type="button" className={langChip(lang === "en")} aria-pressed={lang === "en"} onClick={() => setLang("en")}>
          EN
        </button>
        <button type="button" className={langChip(lang === "es")} aria-pressed={lang === "es"} onClick={() => setLang("es")}>
          ES
        </button>
      </div>

      {/* Phone frame (~390px). Read-only render — this is what staff see tonight. */}
      <div className="mt-3 flex justify-center">
        <div className="w-full max-w-[390px] rounded-[2rem] border-4 border-co-border bg-co-bg p-3 shadow-inner">
          <p className="px-1 pb-2 pt-1 text-center text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("admin.templates.builder.preview.frame_note")}
          </p>
          {hasPhases ? (
            <div className="flex flex-col gap-4">
              <section>
                <h4 className="text-xs font-extrabold uppercase tracking-[0.08em] text-co-cta">
                  {t("admin.templates.builder.preview.phase1")}
                </h4>
                <div className="mt-1">
                  <PreviewStationGroups items={phase1} lang={lang} mirror={false} />
                </div>
              </section>
              <section>
                <h4 className="text-xs font-extrabold uppercase tracking-[0.08em] text-co-cta">
                  {t("admin.templates.builder.preview.phase2")}
                </h4>
                <p className="mt-0.5 text-xs text-co-text-muted">
                  {t("admin.templates.builder.preview.phase2_note")}
                </p>
                <div className="mt-1">
                  <PreviewStationGroups items={phase2} lang={lang} mirror={true} />
                </div>
              </section>
            </div>
          ) : (
            <PreviewStationGroups items={phase1} lang={lang} mirror={false} />
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
