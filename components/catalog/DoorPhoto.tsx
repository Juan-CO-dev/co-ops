"use client";

/**
 * A door report's photo (catalog Phase 2b; full-branch r1 P2-3, r2). Rendered ONLY through the
 * REPORT-BOUND read — GET /api/admin/catalog/pack-requests/{request}/photo (or …/additions/{id}/photo)
 * — which authorizes the viewer as a reviewer of THAT report's shop (MoO+ any shop) and signs only
 * the photo stored on the report, then 302s to a short-lived signed URL.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { packRequestPhotoHref } from "@/lib/catalog/sku-item-shared";

export function DoorPhoto({ requestId, additionId = null }: { requestId: string; additionId?: string | null }) {
  const { t } = useTranslation();
  const href = packRequestPhotoHref(requestId, additionId);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-[44px] w-fit items-center gap-2 text-sm font-bold text-co-text underline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={href} alt={t("catalog.requests.photo_alt")} className="h-16 w-16 rounded object-cover" />
      {t("catalog.requests.photo_open")}
    </a>
  );
}
