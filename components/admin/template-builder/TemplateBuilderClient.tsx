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
 * WRITE SCOPE (spec §1 reconciliation contract): the ONLY writes here are the two
 * SAME-DAY FILLS (es translations + spine link). Structural edits (add / disable /
 * reorder / relabel / gate changes) DO NOT EXIST until PR-3's versioning engine —
 * so this component renders NO structural affordances (a plain "Editing arrives
 * with Publish" note instead of dead buttons). Nothing it does can violate §1.
 *
 * Fills are GM+ (Tier-A step-up via the admin StepUpProvider). Reads are AGM+.
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
  type TemplateBuilderTemplate,
  type TemplateBuilderView,
  type TemplateDoctorReport,
  type TemplateDoctorTemplate,
} from "@/lib/admin/template-builder-shared";
import type { LinkTarget } from "@/lib/admin/needs-link-shared";

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
  /** GM+ may run the two same-day fills (Tier-A at the route). */
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

  if (view.templates.length === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.templates.builder.no_templates")}
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

      {/* Write-scope note (spec §1): editing arrives with Publish (PR-3). */}
      <p className="rounded-lg border border-co-border/60 bg-co-surface px-3 py-2 text-xs text-co-text-muted">
        {t("admin.templates.builder.editing_pending")}
      </p>

      {/* Per-location tabs (D6 — never collapse). */}
      {view.templates.length > 1 && (
        <div role="tablist" aria-label={t("admin.templates.builder.location_tabs")} className="flex flex-wrap gap-2">
          {view.templates.map((tpl) => {
            const d = doctor.templates.find((x) => x.templateId === tpl.id);
            const alerts = d ? d.needsLink.length + (d.esFill.total - d.esFill.filled) : 0;
            return (
              <button
                key={tpl.id}
                role="tab"
                aria-selected={tpl.id === active?.id}
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
        <ItemList
          template={active}
          linkTargets={linkTargets}
          canFill={canFill}
          focusItemId={focusItemId}
        />
      )}

      {/* Phone preview (spec §7, REQUIRED) — renders the live active template. */}
      {active && <PhonePreview template={active} />}
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
  const { needsLink, esMissing, roleFloorImpossible, drift } = doctor.totals;
  const issueCount = needsLink + esMissing + roleFloorImpossible + drift;
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
  linkTargets,
  canFill,
  focusItemId,
}: {
  template: TemplateBuilderTemplate;
  linkTargets: LinkTarget[];
  canFill: boolean;
  focusItemId: string | null;
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

  if (template.items.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.templates.builder.no_items")}
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t("admin.templates.builder.items_count", { n: String(template.items.length) })}
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {template.items.map((item) => (
          <li key={item.id} id={`tb-item-${item.id}`}>
            <ItemRow
              templateId={template.id}
              item={item}
              linkTargets={linkTargets}
              canFill={canFill}
              expanded={expanded.has(item.id)}
              onToggle={() => toggle(item.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
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
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  canFill: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabelForLevel();
  const mirror = isMirrorItem(item.prepMeta);
  const needsLink = itemNeedsLink(item);
  const esLabel = item.translations?.es?.label;
  const missingEs = !mirror && !(typeof esLabel === "string" && esLabel.trim() !== "");

  const chip =
    "inline-flex items-center rounded-full border border-co-border px-2 py-0.5 text-[11px] font-semibold text-co-text-muted";

  return (
    <SummaryRow
      expanded={expanded}
      onToggle={onToggle}
      toggleLabel={expanded ? t("admin.templates.builder.hide") : t("admin.templates.builder.details")}
      drawerId={`tb-drawer-${item.id}`}
      summary={
        <div className="text-sm text-co-text">
          {/* IDENTITY (D1) — en label is the anchor. */}
          <div className="font-bold">{item.label}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {item.station && <span className={chip}>{item.station}</span>}
            <span className={chip}>{t(gateTierKey(item.required))}</span>
            <span className={chip}>{roleLabel(item.minRoleLevel)}</span>
            {item.expectsCount && <span className={chip}>{t("admin.templates.builder.flag.count")}</span>}
            {item.expectsPhoto && <span className={chip}>{t("admin.templates.builder.flag.photo")}</span>}
          </div>
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
          {missingEs && (
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
      <ItemDrawer templateId={templateId} item={item} linkTargets={linkTargets} canFill={canFill} mirror={mirror} />
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
}: {
  templateId: string;
  item: ChecklistTemplateItem;
  linkTargets: LinkTarget[];
  canFill: boolean;
  mirror: boolean;
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
          <SpanishBlock templateId={templateId} item={item} canFill={canFill} />
          {item.expectsCount && (
            <SpineLinkBlock templateId={templateId} item={item} linkTargets={linkTargets} canFill={canFill} />
          )}
        </>
      )}
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
        `/api/admin/checklist-templates/builder/${templateId}/items/${item.id}/translations`,
        {
          method: "POST",
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
        `/api/admin/checklist-templates/builder/${templateId}/items/${item.id}/spine-link`,
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
// Phone preview (spec §7) — a faithful, read-only re-render of the LIVE active
// template as staff see it: items grouped by station, labels via the translations
// resolver, en/es toggle. Presentational only (no instance, no submissions).
// ─────────────────────────────────────────────────────────────────────────────

function PhonePreview({ template }: { template: TemplateBuilderTemplate }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<Language>("en");

  const STATION_FALLBACK = "General";
  const groups = useMemo(() => {
    const map = new Map<string, ChecklistTemplateItem[]>();
    for (const it of template.items) {
      const key = it.station ?? STATION_FALLBACK; // English system key (C.38)
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return [...map.entries()];
  }, [template.items]);

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
          <div className="flex flex-col gap-3">
            {groups.map(([station, items]) => (
              <section key={station}>
                <h4 className="text-sm font-extrabold text-co-text">
                  {/* Station header: resolve via the first item (all share the station). */}
                  {resolveTemplateItemContent(items[0]!, lang).station ??
                    t("admin.templates.builder.preview.general")}
                </h4>
                <ul className="mt-1 flex flex-col gap-1.5">
                  {items.map((it) => {
                    const c = resolveTemplateItemContent(it, lang);
                    return (
                      <li key={it.id} className="flex items-start gap-2 rounded-lg border border-co-border/60 bg-co-surface px-3 py-2">
                        <span aria-hidden className="mt-0.5 text-co-text-dim">☐</span>
                        <span className="flex-1 text-sm text-co-text">
                          <span className="font-semibold">{c.label}</span>
                          {c.description && <span className="block text-xs text-co-text-muted">{c.description}</span>}
                          <span className="mt-0.5 flex flex-wrap gap-1.5">
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
        </div>
      </div>
    </CollapsibleSection>
  );
}
