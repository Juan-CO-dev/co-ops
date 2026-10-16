"use client";
/**
 * The prep evidence position card (Scheduling Phase 1 backlog, built in Phase 2 Task 24): which of the shop's positions
 * a prep batch counts toward in the skills (people shop settings `prepPositionId`). GM own shop / MoO+; Tier E; POST
 * /api/people/settings {action: shop} carrying the shop's PM v2 switch UNCHANGED (only MoO+ may flip it — the PM v2
 * card owns that). A cancelled prompt changes nothing.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { prepBody } from "@/lib/scheduling/settings-view-shared";
import { runGuarded } from "@/components/schedule/horizon-flow-shared";
import { BUTTON, SelectField } from "@/components/schedule/settings-fields";

export function PrepPositionCard({ locationId, prep, positions }: {
  locationId: string;
  prep: { pmV2: boolean; prepPositionId: string | null };
  positions: Record<string, { name: string; nameEs: string | null }>;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const post = useStepUpPost();
  const [value, setValue] = useState(prep.prepPositionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const label = (id: string) => { const p = positions[id]; return p ? (language === "es" && p.nameEs ? p.nameEs : p.name) : id; };
  async function save() {
    setError(null); setSaved(false); setBusy(true);
    const out = await runGuarded({
      tier: "E", requestStepUp: () => requestStepUp("E"),
      post: async () => { const r = await post("/api/people/settings", prepBody(locationId, { pmV2: prep.pmV2, prepPositionId: value || null })); return r.ok ? { ok: true, data: r.data } : { ok: false, code: r.code }; },
    });
    setBusy(false);
    if (out.kind === "cancelled") return;
    if (out.kind === "refused") { setError(out.code); return; }
    setSaved(true);
    router.refresh();
  }
  const known = ["forbidden", "invalid_payload", "location_access_denied", "position_not_at_shop", "position_retired", "pm_v2_moo_only", "pm_v2_not_ready"];
  return (
    <div className="grid gap-3" data-section="prep-position">
      <p className="text-sm text-co-text-muted">{t("schedule.settings.prep.intro")}</p>
      <SelectField name="prepPositionId" label={t("schedule.settings.prep.position")} value={value} onChange={setValue}
        options={[{ value: "", label: t("schedule.settings.prep.none") }, ...Object.keys(positions).map((id) => ({ value: id, label: label(id) }))]} />
      {error ? <p role="alert" className="text-sm font-bold text-co-cta-text">{t((error.startsWith("step_up") ? `schedule.board.error.${error}` : known.includes(error) ? `people.skills.error.${error}` : "people.skills.error.generic") as TranslationKey)}</p> : null}
      {saved ? <p role="status" className="text-sm font-bold text-co-confirm-text">{t("schedule.settings.saved")}</p> : null}
      <button type="button" className={BUTTON} disabled={busy} onClick={save}>{t("schedule.settings.save")}</button>
    </div>
  );
}
