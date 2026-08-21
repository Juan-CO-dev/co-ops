"use client";

/**
 * ReceiptAttachPanel — the "later" in "photo later" (Phase-3 UX pair, Juan-approved
 * 2026-08-19; report-B bug 6).
 *
 * The door ceremony lets an operator submit an intake without the receipt photo, and
 * `receipt_url IS NULL` IS the badge state — the "Photo missing" AlertPill on this
 * page's header and on the receiving list. Nothing could clear it after intake. This
 * panel is the missing writer: it mounts on the delivery detail page ONLY while the
 * receipt is missing, reuses the same PhotoCapture the door form uses, and PATCHes
 * the resulting photo id at /api/operations/receiving/{id}/receipt.
 *
 * NO LOCAL "attached" STATE. On success it router.refresh()es and the server re-reads
 * `receipt_url` — the panel unmounts, the badge clears and the "Receipt attached" link
 * appears, all from the one column that was already the source of truth. Duplicating
 * that into client state is exactly the drift the badge was written to avoid.
 *
 * The upload IS the intent: an operator who taps the camera inside a panel headed
 * "attach the receipt" has said everything a second confirm tap would say, and this
 * is a 6 AM surface. So onUploaded attaches immediately.
 *
 * GATE: KH+ — mirrored from RECEIVE_MIN (lib/receiving.ts, a server-only module); the
 * route re-checks. The page also only renders this island above that level.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { PhotoCapture } from "@/components/photos/PhotoCapture";
import type { TranslationKey } from "@/lib/i18n/types";

/** Route error code → its i18n key. Anything unmapped falls to the generic line —
 *  never a raw code, never a bare key string, on an operator-facing surface. */
const ERROR_KEY: Record<string, TranslationKey> = {
  forbidden: "receiving.error.forbidden",
  not_found: "receiving.error.not_found",
  photo_not_found: "receiving.error.photo_not_found",
  invalid_photo: "receiving.error.invalid_photo",
  invalid_payload: "receiving.error.invalid_photo",
  receipt_already_attached: "receiving.error.receipt_already_attached",
};

export function ReceiptAttachPanel({
  deliveryId,
  locationId,
}: {
  deliveryId: string;
  locationId: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attach = async (photoId: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/operations/receiving/${deliveryId}/receipt`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoId }),
        redirect: "manual",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { code?: string };
        setErr(t(ERROR_KEY[j?.code ?? ""] ?? "receiving.error.generic"));
        // A 409 means someone else attached one — refresh so this operator sees
        // the receipt that IS there rather than an empty panel and an error.
        if (res.status === 409) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setErr(t("receiving.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("receiving.detail.attach_receipt_title")}
      className="mt-3 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2"
    >
      <h2 className="text-sm font-bold text-co-text">{t("receiving.detail.attach_receipt_title")}</h2>
      <p className="mt-1 text-[13px] text-co-text">{t("receiving.detail.attach_receipt_hint")}</p>
      <PhotoCapture
        locationId={locationId}
        onUploaded={(photoId) => void attach(photoId)}
        label={t("receiving.detail.attach_receipt_button")}
        className="mt-2"
      />
      {busy ? <p className="mt-1 text-[13px] text-co-text-muted">{t("receiving.detail.attach_receipt_saving")}</p> : null}
      {err ? <p className="mt-1 text-sm text-co-cta-text">{err}</p> : null}
    </section>
  );
}
