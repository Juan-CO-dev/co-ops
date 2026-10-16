"use client";
/**
 * The PM v2 CRITERIA editor (Scheduling Phase 1, Task 22): a shop's positions, each with its criteria, plus
 * "Every position" for the shared ones. Add, rename (English and Spanish side by side, C.44), reorder,
 * deactivate / reactivate — never delete. Every write asks for the Tier E edit window first (R10) and goes
 * through useStepUpPost (a refused window is forgotten so the next tap prompts).
 *
 * Disclosure doctrine: one collapsed section per position with its count; a row or "Add" form with unsaved
 * text holds its section OPEN (D10, `toggleDisclosure`) so a collapse never throws a draft away. 44 px
 * controls with items-center; useState only.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { disclosureIsOpen, toggleDisclosure } from "@/lib/disclosure-lock-shared";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PmCriteriaEditorView } from "@/lib/pm-criteria";
import type { EditorGroup } from "@/lib/pm-criteria-shared";

const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const quiet = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-3 font-bold text-co-text disabled:opacity-60";
const control = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text disabled:opacity-60";
const fieldLabel = "grid min-w-0 gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const ERRORS = ["forbidden", "not_found", "invalid_payload", "invalid_label", "position_not_at_shop", "position_retired", "duplicate_label", "pm_v2_unavailable", "step_up_required", "step_up_stale"];
function errorKey(code: unknown): TranslationKey {
  return typeof code === "string" && ERRORS.includes(code) ? (`pmCriteria.error.${code}` as TranslationKey) : "pmCriteria.error.generic";
}

function useWrite() {
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const router = useRouter();
  return useCallback(async (body: Record<string, unknown>): Promise<TranslationKey | null> => {
    if ((await requestStepUp("E")) !== "ok") return null;
    const r = await post("/api/pm-criteria", body);
    if (!r.ok) return errorKey(r.code);
    router.refresh();
    return null;
  }, [requestStepUp, post, router]);
}

export function PmCriteriaEditor({ view, initiallyOpen = false, initiallyDirty = [] }: { view: PmCriteriaEditorView; initiallyOpen?: boolean; initiallyDirty?: readonly string[] }) {
  return (
    <div className="grid gap-3">
      {view.groups.map((g) => <Group key={g.positionId ?? "shared"} group={g} locationId={view.locationId} initiallyOpen={initiallyOpen} initiallyDirty={initiallyDirty.includes(g.positionId ?? "shared")} />)}
    </div>
  );
}

function Group({ group, locationId, initiallyOpen, initiallyDirty }: { group: EditorGroup; locationId: string; initiallyOpen: boolean; initiallyDirty: boolean }) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const [dirtyRows, setDirtyRows] = useState<ReadonlySet<string>>(() => new Set(initiallyDirty ? ["seed"] : []));
  const onDirty = useCallback((key: string, dirty: boolean) => setDirtyRows((prev) => {
    if (prev.has(key) === dirty) return prev;
    const next = new Set(prev);
    if (dirty) next.add(key); else next.delete(key);
    return next;
  }), []);
  const dirty = dirtyRows.size > 0;
  const title = group.positionId === null ? t("pmCriteria.everyPosition") : (language === "es" && group.nameEs ? group.nameEs : group.name ?? "");
  const active = group.criteria.filter((c) => c.active);
  return (
    <CollapsibleSection
      idBase={`pm-criteria-${group.positionId ?? "shared"}`} title={title}
      count={t("pmCriteria.count", { n: active.length })}
      badge={dirty ? <span className="rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text">{t("pmCriteria.unsaved")}</span> : null}
      open={disclosureIsOpen(open, dirty)} onToggle={() => setOpen((o) => toggleDisclosure(disclosureIsOpen(o, dirty), dirty))}
    >
      <ul className="grid gap-3">
        {group.criteria.map((c, i) => (
          <CriterionRowEditor key={c.id} criterion={c} locationId={locationId} first={i === 0} last={i === active.length - 1 || !c.active} onDirty={onDirty} />
        ))}
      </ul>
      <AddCriterion positionId={group.positionId} locationId={locationId} onDirty={onDirty} />
    </CollapsibleSection>
  );
}

function CriterionRowEditor({ criterion, locationId, first, last, onDirty }: {
  criterion: EditorGroup["criteria"][number]; locationId: string; first: boolean; last: boolean; onDirty: (key: string, dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const write = useWrite();
  const [label, setLabel] = useState(criterion.label);
  const [labelEs, setLabelEs] = useState(criterion.labelEs ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const dirty = busy || label !== criterion.label || labelEs !== (criterion.labelEs ?? "");
  useEffect(() => { onDirty(criterion.id, dirty); }, [onDirty, criterion.id, dirty]);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    setError(await write({ locationId, criterionId: criterion.id, ...body }));
    setBusy(false);
  };
  return (
    <li className={`grid gap-2 rounded-lg border-2 border-co-border p-3 ${criterion.active ? "bg-co-surface" : "bg-co-surface-inset"}`}>
      {!criterion.active && <p className="text-xs font-bold tracking-wide text-co-text-muted">{t("pmCriteria.inactive")}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={fieldLabel}>{t("pmCriteria.labelEn")}
          <input className={control} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
        </label>
        <label className={fieldLabel}>{t("pmCriteria.labelEs")}
          <input className={control} value={labelEs} maxLength={80} onChange={(e) => setLabelEs(e.target.value)} disabled={busy} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || !label.trim() || (label === criterion.label && labelEs === (criterion.labelEs ?? ""))}
          onClick={() => run({ action: "update", label, labelEs })}>{t("pmCriteria.save")}</button>
        {criterion.active && <button type="button" className={quiet} aria-label={t("pmCriteria.moveUp")} disabled={busy || first} onClick={() => run({ action: "move", direction: "up" })}>↑</button>}
        {criterion.active && <button type="button" className={quiet} aria-label={t("pmCriteria.moveDown")} disabled={busy || last} onClick={() => run({ action: "move", direction: "down" })}>↓</button>}
        <button type="button" className={quiet} disabled={busy} onClick={() => run({ action: "update", active: !criterion.active })}>
          {t(criterion.active ? "pmCriteria.deactivate" : "pmCriteria.reactivate")}
        </button>
      </div>
    </li>
  );
}

function AddCriterion({ positionId, locationId, onDirty }: { positionId: string | null; locationId: string; onDirty: (key: string, dirty: boolean) => void }) {
  const { t } = useTranslation();
  const write = useWrite();
  const [label, setLabel] = useState("");
  const [labelEs, setLabelEs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const key = `add-${positionId ?? "shared"}`;
  const dirty = busy || label !== "" || labelEs !== "";
  useEffect(() => { onDirty(key, dirty); }, [onDirty, key, dirty]);
  return (
    <div className="mt-3 grid gap-2 rounded-lg border-2 border-dashed border-co-border p-3">
      <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("pmCriteria.addTitle")}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={fieldLabel}>{t("pmCriteria.labelEn")}
          <input className={control} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
        </label>
        <label className={fieldLabel}>{t("pmCriteria.labelEs")}
          <input className={control} value={labelEs} maxLength={80} onChange={(e) => setLabelEs(e.target.value)} disabled={busy} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || !label.trim()} onClick={async () => {
          setBusy(true); setError(null);
          const e = await write({ action: "create", locationId, positionId, label, labelEs: labelEs || null });
          setBusy(false);
          if (e) { setError(e); return; }
          setLabel(""); setLabelEs("");
        }}>{t("pmCriteria.add")}</button>
      </div>
    </div>
  );
}
