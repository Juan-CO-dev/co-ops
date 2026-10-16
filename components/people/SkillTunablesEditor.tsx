"use client";
/**
 * The skill tunables editor (Scheduling Phase 1 backlog, built in Phase 2 Task 24): how EVERY shop's people are read —
 * the prior and its strength, the evidence weights, the PM grade values, the yield tolerance, the close grace, the band
 * cut-offs, the minimum quality days and the evidence window. MoO+ only (`canEditSkillTunables`); the SAME validator as
 * SQL (`tunablesProblem`) names the failing key BEFORE any post; Tier E; POST /api/people/settings {action: tunables}
 * for all shops (locationId null) or this shop. A cancelled prompt keeps the draft.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { tunablesProblem, type SkillTunables } from "@/lib/people/tunables-shared";
import { tunablesBody } from "@/lib/scheduling/settings-view-shared";
import { runGuarded } from "@/components/schedule/horizon-flow-shared";
import { BUTTON, Fields, NumField, SelectField } from "@/components/schedule/settings-fields";

type Path = [keyof SkillTunables] | [keyof SkillTunables, string];
const FIELDS: Array<{ path: Path; step: number }> = [
  { path: ["priorWhenNoRating"], step: 0.05 }, { path: ["priorStrength"], step: 1 },
  { path: ["weights", "pm"], step: 0.05 }, { path: ["weights", "closeOnTime"], step: 0.05 }, { path: ["weights", "prepYield"], step: 0.05 },
  { path: ["gradeValue", "great"], step: 0.05 }, { path: ["gradeValue", "good"], step: 0.05 }, { path: ["gradeValue", "needs_work"], step: 0.05 },
  { path: ["yieldTolerance"], step: 0.01 }, { path: ["closeGraceMinutes"], step: 1 },
  { path: ["bands", "building"], step: 0.05 }, { path: ["bands", "strong"], step: 0.05 },
  { path: ["minQualityDaysForLearned"], step: 1 }, { path: ["windowDays"], step: 1 },
];
const get = (t: SkillTunables, p: Path): number => (p.length === 1 ? t[p[0]] as unknown as number : (t[p[0]] as unknown as Record<string, number>)[p[1]]!);

export function SkillTunablesEditor({ locationId, tunables }: { locationId: string; tunables: SkillTunables }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [draft, setDraft] = useState<SkillTunables>(() => structuredClone(tunables));
  const [scope, setScope] = useState<"company" | "shop">("company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (p: Path, v: number | null) => setDraft((d) => {
    const n = structuredClone(d) as unknown as Record<string, unknown>;
    if (p.length === 1) n[p[0]] = v ?? Number.NaN; else (n[p[0]] as Record<string, unknown>)[p[1]] = v ?? Number.NaN;
    return n as unknown as SkillTunables;
  });
  async function save() {
    setError(null); setSaved(false);
    const key = tunablesProblem(draft);
    if (key) { setError(`key:${key}`); return; }
    setBusy(true);
    const out = await runGuarded({
      tier: "E", requestStepUp: () => requestStepUp("E"),
      post: async () => { const r = await post("/api/people/settings", tunablesBody(scope === "company" ? null : locationId, draft)); return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code }; },
    });
    setBusy(false);
    if (out.kind === "cancelled") return;
    if (out.kind === "refused") { setError(out.code); return; }
    setSaved(true);
    router.refresh();
  }
  const errorText = error === null ? null : error.startsWith("key:") ? t("schedule.settings.tunables.invalid_key", { key: error.slice(4) })
    : t((["forbidden", "invalid_payload", "invalid_tunables", "step_up_required", "step_up_stale"].includes(error)
      ? (error.startsWith("step_up") ? `schedule.board.error.${error}` : `people.skills.error.${error}`) : "people.skills.error.generic") as TranslationKey);
  return (
    <div className="grid gap-3" data-section="tunables">
      <p className="text-sm text-co-text-muted">{t("schedule.settings.tunables.intro")}</p>
      <SelectField name="tunablesScope" label={t("schedule.settings.tunables.scope")} value={scope} onChange={(v) => setScope(v === "shop" ? "shop" : "company")}
        options={[{ value: "company", label: t("schedule.settings.tunables.scope_company") }, { value: "shop", label: t("schedule.settings.tunables.scope_shop") }]} />
      <Fields>
        {FIELDS.map((f) => {
          const name = f.path.join(".");
          return <NumField key={name} name={`tunables.${name}`} label={t(`schedule.settings.tunables.${name.replace(".", "_")}` as TranslationKey)} value={get(draft, f.path)} step={f.step} onChange={(v) => set(f.path, v)} />;
        })}
      </Fields>
      {errorText ? <p role="alert" className="text-sm font-bold text-co-cta-text">{errorText}</p> : null}
      {saved ? <p role="status" className="text-sm font-bold text-co-confirm-text">{t("schedule.settings.saved")}</p> : null}
      <button type="button" className={BUTTON} disabled={busy} onClick={save}>{t("schedule.settings.save")}</button>
    </div>
  );
}
