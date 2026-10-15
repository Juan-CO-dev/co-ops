"use client";

/**
 * A door report's photo (catalog Phase 2b, full-branch r1 P2-3). Rendered ONLY through the app's
 * canonical, authorized read — GET /api/photos/{id}, which binds the viewer to the photo's shop and
 * 302s to a short-lived signed URL. The photo was bound to the report's shop when it was filed
 * (lib/pack-change-requests.ts), so it is always that shop's evidence.
 */
import { useTranslation } from "@/lib/i18n/provider";

export function DoorPhoto({ photoId }: { photoId: string }) {
  const { t } = useTranslation();
  const href = `/api/photos/${encodeURIComponent(photoId)}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex min-h-[44px] w-fit items-center gap-2 text-sm font-bold text-co-text underline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={href} alt={t("catalog.requests.photo_alt")} className="h-16 w-16 rounded object-cover" />
      {t("catalog.requests.photo_open")}
    </a>
  );
}
