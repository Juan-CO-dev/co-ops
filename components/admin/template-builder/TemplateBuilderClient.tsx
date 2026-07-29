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
  type TemplateItemEdit,
  type TemplateBuilderTemplate,
  type TemplateBuilderView,
  type TemplateDoctorReport,
  type TemplateDoctorTemplate,
} from "@/lib/admin/template-builder-shared";
import type { LinkTarget } from "@/lib/admin/needs-link-shared";

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

export function TemplateBuilderClient({
  view,
  doctor,
  linkTargets,
  canFill,
}: {
  view: TemplateBuilderView;
  doctor: TemplateDoctorReport;
  linkTargets: LinkTarget[];
  /** GM+ may run the two same-day fills (Tier-A) AND publish (Tier-A). */
  canFill: boolean;
}) {
  const { t } = useTranslation();

  // Per-location tabs (D6). Default to the first location. ?tab-style local
  // useState only (D9 — no URL/localStorage).
  const [activeTplId, setActiveTplId] = useState<string>(view.templates[0]?.id ?? "");
  const active = view.templates.find((tpl) => tpl.id === activeTplId) ?? view.templates[0] ?? null;

  // Deep-link target: when the Doctor "fix" link fires, expand that item's drawer
  // and scroll to it. Held in a shared piece of state the item list reads.
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  // PR-3 DRAFT ENGINE — pending structural edits keyed by template id (D9: useState
  // only). Empty per template = clean. Edits feed the list + the phone preview + the
  // classifyEdits diff for the publish confirm modal. Publishing versions everything.
  const [drafts, setDrafts] = useState<DraftState>({});
  const editsForActive = (active && drafts[active.id]) || [];

  const pushEdit = (templateId: string, edit: TemplateItemEdit) => {
    setDrafts((prev) => ({ ...prev, [templateId]: [...(prev[templateId] ?? []), edit] }));
  };
  const clearDraft = (templateId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[templateId];
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
        onFix={(templateId, itemId) => {
          setActiveTplId(templateId);
          setFocusItemId(itemId);
          // Scroll after the drawer mounts.
          requestAnimationFrame(() => {
            document.getElementById(`tb-item-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        }}
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
            canFill={canFill}
            focusItemId={focusItemId}
            onEdit={(edit) => pushEdit(active.id, edit)}
          />
        </div>
      )}

      {/* Publish bar — dirty banner (D2, never collapses) + Publish button + confirm
          modal. Only GM+ (canFill) sees the publish affordance. */}
      {active && canFill && (
        <PublishBar
          template={active}
          edits={editsForActive}
          openInstancesToday={doctor.publish?.openInstancesToday ?? 0}
          onPublished={() => clearDraft(active.id)}
        />
      )}

      {/* Phone preview (spec §7, REQUIRED) — renders the DRAFTED active template so the
          manager sees exactly what staff sees tonight/tomorrow before publishing. */}
      {active && <PhonePreview template={active} draftedItems={draftedItems} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Doctor panel (spec §6) — compact chip → inline expand.
// ─────────────────────────────────────────────────────────────────────────────

function TemplateDoctorPanel({
  doctor,
  onFix,
}: {
  doctor: TemplateDoctorReport;
  onFix: (templateId: string, itemId: string) => void;
}) {
  const { t } = useTranslation();
  // Same ACTIONABLE definition as the tab badges, plus drift (a location-pair
  // fact itemized in the panel). esMissing is intentionally EXCLUDED — Spanish
  // renders as fill-count progress, not an issue (header must never claim an
  // issue the panel can't itemize — the PR-0 header/panel-disagreement class).
  const { needsLink, roleFloorImpossible, drift } = doctor.totals;
  const issueCount = needsLink + roleFloorImpossible + drift;
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

  return (
    <CollapsibleSection
      idBase="tb-doctor"
      title={t("admin.templates.doctor.title")}
      badge={badge}
      defaultOpen={!clean}
    >
      {clean ? (
        <p className="text-sm text-co-text-muted">{t("admin.templates.doctor.all_clear_body")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Location drift — NAMED per item (spec §6). */}
          {doctor.drift.length > 0 && (
            <DoctorGroup title={t("admin.templates.doctor.drift_heading", { n: String(doctor.drift.length) })}>
              <ul className="flex flex-col gap-1">
                {doctor.drift.map((d, i) => (
                  <li key={`${d.label}-${i}`} className="text-sm text-co-text">
                    {t("admin.templates.doctor.drift_line", {
                      present: locName(d.presentLocationId),
                      label: d.label,
                      missing: locName(d.missingLocationId),
                    })}
                  </li>
                ))}
              </ul>
            </DoctorGroup>
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
  const nothing = tpl.needsLink.length === 0 && esMissing === 0 && tpl.roleFloor.length === 0;
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
  canFill,
  focusItemId,
  onEdit,
}: {
  template: TemplateBuilderTemplate;
  /** source items + draft edits applied (mirror rows untouched). */
  draftedItems: ChecklistTemplateItem[];
  linkTargets: LinkTarget[];
  canFill: boolean;
  focusItemId: string | null;
  onEdit: (edit: TemplateItemEdit) => void;
}) {
  const { t } = useTranslation();
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
          defaults carried; count toggle reveals the required spine-link picker. */}
      {canFill && <QuickAdd template={template} draftedItems={draftedItems} linkTargets={linkTargets} onEdit={onEdit} />}

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
                item={item}
                linkTargets={linkTargets}
                canFill={canFill}
                expanded={expanded.has(item.id)}
                onToggle={() => toggle(item.id)}
                onEdit={onEdit}
                canMoveUp={editable.length > 1 && editable.findIndex((it) => it.id === item.id) > 0}
                canMoveDown={
                  editable.length > 1 &&
                  editable.findIndex((it) => it.id === item.id) >= 0 &&
                  editable.findIndex((it) => it.id === item.id) < editable.length - 1
                }
                onMoveUp={() => move(item, -1)}
                onMoveDown={() => move(item, 1)}
                isFirst={i === 0}
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

/** Gate-tier badge (spec §3): Optional vs "Must complete — or explain". hard_gate
 *  does not exist yet (PR-4), so only two tiers derive from `required`. */
function gateTierKey(required: boolean): TranslationKey {
  return required ? tk("admin.templates.builder.gate.must_complete") : tk("admin.templates.builder.gate.optional");
}

function ItemRow({
  templateId,
  item,
  linkTargets,
  canFill,
  expanded,
  onToggle,
  onEdit,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  canFill: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (edit: TemplateItemEdit) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
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
            <span className={chip}>{t(gateTierKey(item.required))}</span>
            <span className={chip}>{roleLabel(item.minRoleLevel)}</span>
            {item.expectsCount && <span className={chip}>{t("admin.templates.builder.flag.count")}</span>}
            {item.expectsPhoto && <span className={chip}>{t("admin.templates.builder.flag.photo")}</span>}
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
        </>
      }
    >
      <ItemDrawer
        templateId={templateId}
        item={item}
        linkTargets={linkTargets}
        canFill={canFill}
        mirror={mirror}
        isDraftAdd={isDraftAdd}
        onEdit={onEdit}
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
  item,
  linkTargets,
  canFill,
  mirror,
  isDraftAdd,
  onEdit,
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  canFill: boolean;
  mirror: boolean;
  isDraftAdd: boolean;
  onEdit: (edit: TemplateItemEdit) => void;
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
          {canFill && <StructuralEdits item={item} isDraftAdd={isDraftAdd} onEdit={onEdit} />}

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
  isDraftAdd,
  onEdit,
}: {
  item: ChecklistTemplateItem;
  isDraftAdd: boolean;
  onEdit: (edit: TemplateItemEdit) => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(item.label);
  const [description, setDescription] = useState(item.description ?? "");
  const disabled = !item.active;

  // Draft-added rows: their id is `draft-…` and can't be a server edit target. Only
  // the disable/enable toggle is meaningful (it flips the draft item's active), and
  // we key it via a synthetic enable/disable on the same id which applyEditsToItems
  // honours in memory. Relabel/role/required on a draft-add are set at add-time.
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
          <label className="flex items-center gap-2 text-sm text-co-text">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(e) => onEdit({ op: "required", itemId: idForEdit, required: e.target.checked })}
              className="h-5 w-5"
            />
            {t("admin.templates.builder.required_toggle")}
          </label>
        </>
      )}
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
    </div>
  );
}

/** Quick-add (spec §7): the 60-second add flow. Label + section + role + required,
 *  defaults carried from the last item; the count toggle reveals a REQUIRED spine-
 *  link picker (dismiss reverts the toggle). Emits an `add` TemplateItemEdit. */
function QuickAdd({
  template,
  draftedItems,
  linkTargets,
  onEdit,
}: {
  template: TemplateBuilderTemplate;
  draftedItems: ChecklistTemplateItem[];
  linkTargets: LinkTarget[];
  onEdit: (edit: TemplateItemEdit) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // Defaults carried from the last non-mirror item (spec §7).
  const last = [...draftedItems].reverse().find((it) => !isMirrorItem(it.prepMeta));
  const [label, setLabel] = useState("");
  const [station, setStation] = useState<string>(last?.station ?? "");
  const [role, setRole] = useState<number>(last?.minRoleLevel ?? 3);
  const [required, setRequired] = useState(true);
  const [expectsCount, setExpectsCount] = useState(false);
  const [spine, setSpine] = useState<LinkTarget | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<TranslationKey | null>(null);
  const maxOrder = draftedItems.reduce((m, it) => Math.max(m, it.displayOrder), 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return linkTargets.filter((tg) => (q ? tg.name.toLowerCase().includes(q) : true)).slice(0, 12);
  }, [linkTargets, query]);

  const reset = () => {
    setLabel(""); setExpectsCount(false); setSpine(null); setQuery(""); setError(null);
  };

  const add = () => {
    if (!label.trim()) return;
    if (expectsCount && !spine) { setError("admin.templates.builder.add_count_link_required"); return; }
    onEdit({
      op: "add",
      tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim(),
      station: station || null,
      displayOrder: maxOrder + 1,
      minRoleLevel: role,
      required,
      expectsCount,
      spineLink: expectsCount ? spine : null,
    });
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
      <label className="flex items-center gap-2 text-sm text-co-text">
        <input
          type="checkbox"
          checked={expectsCount}
          onChange={(e) => { setExpectsCount(e.target.checked); if (!e.target.checked) { setSpine(null); setError(null); } }}
          className="h-5 w-5"
        />
        {t("admin.templates.builder.add_count_label")}
      </label>

      {/* Spine-link picker — appears ONLY when the count toggle is on (required). */}
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
  openInstancesToday,
  onPublished,
}: {
  template: TemplateBuilderTemplate;
  edits: TemplateItemEdit[];
  openInstancesToday: number;
  onPublished: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyNow, setApplyNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const dirty = edits.length > 0;
  const diff = useMemo(() => classifyEdits(template.items, edits), [template.items, edits]);

  if (!dirty) return null;

  const diffChips: string[] = [];
  if (diff.added.length) diffChips.push(t("admin.templates.builder.publish_diff_added", { n: String(diff.added.length) }));
  if (diff.removed.length) diffChips.push(t("admin.templates.builder.publish_diff_removed", { n: String(diff.removed.length) }));
  if (diff.relabeled.length) diffChips.push(t("admin.templates.builder.publish_diff_relabeled", { n: String(diff.relabeled.length) }));
  if (diff.reordered) diffChips.push(t("admin.templates.builder.publish_diff_reordered", { n: String(diff.reordered) }));
  if (diff.roleChanged.length) diffChips.push(t("admin.templates.builder.publish_diff_role", { n: String(diff.roleChanged.length) }));
  if (diff.requiredChanged.length) diffChips.push(t("admin.templates.builder.publish_diff_required", { n: String(diff.requiredChanged.length) }));

  const publish = async () => {
    if (busy) return;
    setErrorKey(null);
    // Apply-now requires its OWN step-up (Tier-A) on top of the drawer's; a next-day
    // publish also steps up (GM+ Tier-A at the route). Request once here.
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/template-builder/${template.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits, effectiveMode: applyNow ? "apply_now" : "next_day" }),
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
        <span className="text-sm font-semibold text-co-text">{t("admin.templates.builder.dirty_banner")}</span>
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
                      {it.required && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-co-cta">
                          {t("admin.templates.builder.preview.required")}
                        </span>
                      )}
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
  template,
  draftedItems,
}: {
  template: TemplateBuilderTemplate;
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
