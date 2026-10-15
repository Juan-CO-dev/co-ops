"use client";

/**
 * "This case looks different" — the receiving door's report (catalog Phase 2b; spec §2, §5 job 1).
 * The crew can't change how an item arrives, but they are the first to see a new case. One tap
 * opens a short sheet: what's different, optionally how many are inside and about how much each
 * weighs, and a photo. It files a report for the shop's GM, who answers it on the item page
 * ("It arrives differently now", prefilled). It changes nothing by itself, so it takes no password.
 * Disclosure state is useState only. Operational surface → the ActionButton grammar. Every refusal
 * the route can return is shown by its own name (doorReportErrorKey), never as the generic text.
 */
import { useId, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { ActionButton } from "@/components/ActionButton";
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import { postJson } from "@/components/admin/vendors/shared";
import { doorReportErrorKey } from "@/lib/pack-change-requests-shared";

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";
const fieldLabel = "text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim";

function positive(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function CaseLooksDifferent({ skuId, locationId, deliveryId = null }: { skuId: string; locationId: string; deliveryId?: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [inner, setInner] = useState("");
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"oz" | "lb">("lb");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "already" | "added" | "error">("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Unique per LINE, not per SKU: the same item can sit on two door lines (chunk-3 review P3b).
  const panelId = `case-different-${useId()}`;

  const submit = async () => {
    if (busy) return;
    const innerCount = positive(inner);
    const eachWeight = positive(weight);
    const proposal = innerCount == null && eachWeight == null ? null : { innerCount, eachWeight, eachUnit: eachWeight == null ? null : unit };
    setBusy(true);
    const r = await postJson("/api/operations/receiving/pack-change", {
      skuId, locationId, deliveryId, note: note.trim() || null, proposal, photoId,
    });
    setBusy(false);
    if (!r.ok) { setErrorCode(r.code); setStatus("error"); return; }
    // Joining the open report ADDS what this person brought; the door says so (chunk-3 review P3a).
    setStatus(r.data.already === true ? (r.data.added === true ? "added" : "already") : "sent");
    setOpen(false);
  };

  return (
    <div className="mt-3">
      <ActionButton type="button" variant="secondary" aria-expanded={open} aria-controls={panelId}
        onClick={() => { setOpen((o) => !o); setStatus("idle"); }}>
        {t("receiving.case_different.button")}
      </ActionButton>
      {status === "sent" || status === "already" || status === "added" ? (
        <p role="status" className="mt-2 text-sm text-co-confirm-text">
          {t(status === "sent" ? "receiving.case_different.sent" : status === "added" ? "receiving.case_different.added" : "receiving.case_different.already")}
        </p>
      ) : null}
      {status === "error" ? <p role="alert" className="mt-2 text-sm text-co-cta-text">{t(doorReportErrorKey(errorCode))}</p> : null}
      {open ? (
        <div id={panelId} className="mt-2 flex flex-col gap-2 rounded-xl border-2 border-co-border-2 bg-co-surface-inset p-3">
          <p className="text-sm font-bold text-co-text">{t("receiving.case_different.title")}</p>
          <label className="block">
            <span className={fieldLabel}>{t("receiving.case_different.note")}</span>
            <textarea className={`${field} min-h-[88px] py-2`} maxLength={500} value={note} aria-label={t("receiving.case_different.note")} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className={fieldLabel}>{t("receiving.case_different.inner_count")}</span>
              <input className={field} type="number" min={0} step="any" inputMode="decimal" value={inner} disabled={busy} aria-label={t("receiving.case_different.inner_count")} onChange={(e) => setInner(e.target.value)} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t("receiving.case_different.each_weight")}</span>
              <input className={field} type="number" min={0} step="any" inputMode="decimal" value={weight} disabled={busy} aria-label={t("receiving.case_different.each_weight")} onChange={(e) => setWeight(e.target.value)} />
            </label>
            <label className="block">
              <span className={fieldLabel}>{t("receiving.case_different.unit")}</span>
              <select className={field} value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value === "oz" ? "oz" : "lb")}>
                <option value="lb">lb</option>
                <option value="oz">oz</option>
              </select>
            </label>
          </div>
          <PhotoCapture locationId={locationId} label={t("receiving.form.photo_capture")} initialPhotoId={photoId} onUploaded={(pid) => setPhotoId(pid)} />
          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" variant="primary" disabled={busy} onClick={() => void submit()}>{t("receiving.case_different.send")}</ActionButton>
            <ActionButton type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{t("receiving.case_different.close")}</ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
