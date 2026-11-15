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
 * The type guard mirrors lib/photos-shared (the server re-validates — this is
 * just a fast client-side reject so the operator gets an instant message).
 *
 * SIZE (audit W10 / B065): the photo is SHRUNK ON THE DEVICE before it is sent
 * (lib/photos-client.ts: longest edge 2560 px, JPEG, never more than 4 MiB),
 * because the upload passes through a hosting function whose request body is
 * limited to 4.5 MB. Before this a 4.5–8 MB phone photo passed the 8 MB check
 * here and then failed on every try. The busy label covers the shrink and the
 * upload; the upload has a deadline, so the button never stays busy forever.
 */
import { useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import { PhotoTooLargeError, postPhoto, prepareUpload, type PreparedUpload } from "@/lib/photos-client";
import { isAllowedContentType } from "@/lib/photos-shared";

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

    setBusy(true);
    try {
      // Shrink first (B065): a big phone photo is re-encoded on the device so the request fits the
      // hosting body limit. One that cannot be made small enough is refused here, with the clear message.
      let prepared: PreparedUpload;
      try {
        prepared = await prepareUpload(file);
      } catch (err) {
        setError(t(err instanceof PhotoTooLargeError ? "photo.capture.error.too_large" : "photo.capture.error.upload_failed"));
        return;
      }
      // The POST runs under a deadline and never throws; a platform 413 comes back as too_large.
      const outcome = await postPhoto(prepared, locationId);
      if (!outcome.ok) {
        setError(t(`photo.capture.error.${outcome.error}`));
        return;
      }
      setPhotoId(outcome.photoId);
      onUploaded(outcome.photoId);
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
            className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-co-cta-text underline"
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
      {error ? <p className="mt-1 text-sm text-co-cta-text">{error}</p> : null}
    </div>
  );
}
