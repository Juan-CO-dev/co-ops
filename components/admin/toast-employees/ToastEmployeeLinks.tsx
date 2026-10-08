"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { LinkReview } from "@/lib/toast/employee-links";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text";
const dangerButton = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 font-bold text-co-cta-text";
const control = "min-h-[44px] min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";

const ERRORS: Record<string, TranslationKey> = {
  employee_already_linked: "toastLinks.error.employeeLinked",
  user_already_linked: "toastLinks.error.userLinked",
  role_insufficient: "toastLinks.error.role",
  location_access_denied: "toastLinks.error.role",
  assignee_unavailable: "toastLinks.error.unavailable",
};

/** Review Toast employees no one has linked yet; link with a tap, unlink a wrong match. */
export function ToastEmployeeLinks({ review }: { review: LinkReview }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const disabled = busy || refreshing;
  async function send(payload: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const post = () => fetch("/api/admin/toast-employees", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: review.locationId, ...payload }) });
      let response = await post();
      let body: { code?: string } = {};
      if (!response.ok) {
        body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await post();
          if (!response.ok) body = await response.json().catch(() => ({})) as { code?: string };
        }
      }
      if (!response.ok || response.redirected) { setError(ERRORS[body.code ?? ""] ?? "toastLinks.error.generic"); return; }
      startTransition(() => router.refresh());
    } catch { setError("toastLinks.error.generic"); } finally { setBusy(false); }
  }
  const kindLabel = (kind: "full_name" | "last_name" | "first_name") => t(`toastLinks.kind.${kind}`);
  return <div className="space-y-4" aria-busy={disabled}>
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {review.toastError && <p role="status" className="co-card p-4 text-co-text-muted">{t(review.toastError === "toast_employees_not_connected" ? "toastLinks.notConnected" : "toastLinks.toastUnavailable")}</p>}
    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("toastLinks.unlinkedTitle", { count: review.unlinked.length })}</h2>
      <p className="text-sm text-co-text-muted">{t("toastLinks.unlinkedHint")}</p>
      {review.unlinked.length === 0 && !review.toastError && <p className="text-sm text-co-text-muted">{t("toastLinks.allLinked")}</p>}
      <ul className="space-y-3">{review.unlinked.map((row) => <li key={row.guid} className="min-w-0 space-y-2 rounded-xl border border-co-border p-3">
        <p className="truncate font-bold text-co-text" title={row.name}>{row.name}</p>
        {row.deleted && <p className="text-sm text-co-text-muted">{t("toastLinks.archived")}</p>}
        {row.suggestions.length > 0 && <ul className="space-y-2">{row.suggestions.map((s) => <li key={s.userId} className="flex flex-wrap items-center gap-2">
          <button type="button" className={button} disabled={disabled}
            onClick={() => void send({ operation: "link", employeeGuid: row.guid, userId: s.userId })}>{t("toastLinks.linkTo", { name: s.name })}</button>
          <span className={s.kind === "first_name" ? "text-sm font-bold text-co-warning-text" : "text-sm text-co-text-muted"}>{kindLabel(s.kind)}</span>
        </li>)}</ul>}
        <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const userId = String(new FormData(event.currentTarget).get("userId") || "");
          if (userId) void send({ operation: "link", employeeGuid: row.guid, userId });
        }}>
          <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("toastLinks.pickPerson")}
            <select name="userId" defaultValue="" className={control} disabled={disabled}>
              <option value="" disabled>{t("toastLinks.pickPerson")}</option>
              {review.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <button type="submit" className={button} disabled={disabled}>{t("toastLinks.link")}</button>
        </form>
      </li>)}</ul>
    </section>
    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("toastLinks.linkedTitle", { count: review.links.length })}</h2>
      {review.links.length === 0 && <p className="text-sm text-co-text-muted">{t("toastLinks.noneLinked")}</p>}
      <ul className="space-y-2">{review.links.map((link) => <li key={link.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-co-border p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-co-text">{t("toastLinks.linkedRow", { toast: link.employeeName ?? t("toastLinks.unknownEmployee"), person: link.userName })}</p>
          <p className="text-sm text-co-text-muted">{t(link.source === "auto" ? "toastLinks.sourceAuto" : "toastLinks.sourceManual")}</p>
        </div>
        <button type="button" className={dangerButton} disabled={disabled} onClick={() => void send({ operation: "unlink", linkId: link.id })}>{t("toastLinks.unlink")}</button>
      </li>)}</ul>
    </section>
  </div>;
}
