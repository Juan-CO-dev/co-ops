"use client";

/**
 * PhotoCapture — the client photo-upload affordance (photo uploader seam, 0164).
 *
 * A 44px camera button that opens the device camera / file picker (accept=image/*
 * capture=environment), POSTs the chosen file as multipart/form-data to
 * /api/photos with the location id, and calls onUploaded(photoId) on success.
 * After a successful upload it shows a thumbnail via GET /api/photos/{id} (which
 * 302s to a short-lived signed URL) plus a "View photo" link + a replace button.
 *
 * Busy + error states are i18n'd (tú-form in es). The parent decides what to do
 * with the returned photoId — a checklist completion stores it in photo_id; a
 * receiving slot stores the URL /api/photos/{id} in a text column.
 *
 * The type/size guard mirrors lib/photos-shared (the server re-validates — this
 * is just a fast client-side reject so the operator gets an instant message).
 */
import { useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { isAllowedContentType, isWithinSizeCap } from "@/lib/photos-shared";

interface Props {
  locationId: string;
  /** Called with the new photo id after a successful upload. */
  onUploaded: (photoId: string) => void;
  /** Pre-existing photo id (e.g. a receiving slot already has one) — renders the
   *  attached/thumbnail state on mount. */
  initialPhotoId?: string | null;
  /** Optional label override for the capture button (defaults to photo.capture.button). */
  label?: string;
  className?: string;
}

export function PhotoCapture({ locationId, onUploaded, initialPhotoId = null, label, className }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(initialPhotoId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = () => {
    if (busy) return;
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so re-selecting the same file re-fires change.
    e.target.value = "";
    if (!file) return;

    setError(null);
    if (!isAllowedContentType(file.type)) {
      setError(t("photo.capture.error.unsupported_type"));
      return;
    }
    if (!isWithinSizeCap(file.size)) {
      setError(t("photo.capture.error.too_large"));
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("locationId", locationId);
      const res = await fetch("/api/photos", { method: "POST", body: form, redirect: "manual" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        const code = body?.code;
        if (code === "too_large") setError(t("photo.capture.error.too_large"));
        else if (code === "unsupported_type") setError(t("photo.capture.error.unsupported_type"));
        else setError(t("photo.capture.error.upload_failed"));
        return;
      }
      const data = (await res.json()) as { photoId: string };
      setPhotoId(data.photoId);
      onUploaded(data.photoId);
    } catch {
      setError(t("photo.capture.error.upload_failed"));
    } finally {
      setBusy(false);
    }
  };

  const buttonLabel = photoId
    ? t("photo.capture.replace")
    : busy
      ? t("photo.capture.uploading")
      : (label ?? t("photo.capture.button"));

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={t("photo.capture.aria_input")}
        onChange={(e) => void onFile(e)}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pick}
          disabled={busy}
          aria-label={buttonLabel}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-white px-4 text-sm font-semibold text-co-text disabled:opacity-60"
        >
          {buttonLabel}
        </button>
        {photoId ? (
          <a
            href={`/api/photos/${photoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-co-cta underline"
          >
            {/* Thumbnail via the same canonical read URL (302 → signed url). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${photoId}`}
              alt={t("photo.capture.attached")}
              className="h-10 w-10 rounded object-cover"
            />
            {t("photo.capture.view")}
          </a>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-sm text-co-cta">{error}</p> : null}
    </div>
  );
}
