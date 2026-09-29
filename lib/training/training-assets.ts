/**
 * training-assets — SERVICE-ROLE access to the private `training-assets` bucket
 * (0212). Same posture as lib/photos.ts and lib/email-receipts.ts: the bucket has
 * no storage.objects policies, so this service-role client is the sole authority,
 * and end users only ever hold a 60 s signed URL minted AFTER requireSession.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";

import {
  TRAINING_ASSETS_BUCKET,
  TRAINING_SIGNED_URL_TTL_SECONDS,
  trainingPhotoObjectPath,
} from "./training-assets-shared";

/**
 * A short-lived signed URL for one manifest photo. The CALLER has already run
 * requireSession and checked the name against the vendored manifest; this only
 * signs. It does NOT confirm the object exists: createSignedUrl signs a path, and
 * existence is only checked when the URL is fetched. That is deliberate and fails
 * CLOSED: a signed URL for a missing photo 400/404s at storage, the page's photo
 * preload treats any non-OK response (and any sha256 mismatch) as "no real photo"
 * and uses the drawn look, and a URL is only minted for a manifest name after the
 * session check. A HEAD per photo per page load would double the storage calls for
 * no security gain. Null (→ route 404) = signing itself failed or threw.
 */
export async function signTrainingPhoto(name: string): Promise<string | null> {
  try {
    const { data, error } = await getServiceRoleClient()
      .storage.from(TRAINING_ASSETS_BUCKET)
      .createSignedUrl(trainingPhotoObjectPath(name), TRAINING_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Server-only signed fetch: never hand media credentials/redirects to a native video or poster. */
export async function fetchTrainingMedia(name: string, range: string | null, signal: AbortSignal): Promise<Response | null> {
  try {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    // The SDK signer has no signal parameter. Bound waiting for it as well as
    // the fetch; a cancelled request must not wait forever for a signed URL.
    const signed = await new Promise<string | null>((resolve) => {
      if (bounded.aborted) { resolve(null); return; }
      const abort = () => resolve(null);
      bounded.addEventListener("abort", abort, { once: true });
      void signTrainingPhoto(name).then((url) => {
        bounded.removeEventListener("abort", abort);
        resolve(url);
      });
    });
    if (!signed) return null;
    return await fetch(signed, {
      redirect: "error", cache: "no-store",
      headers: { "Accept-Encoding": "identity", ...(range ? { Range: range } : {}) },
      signal: bounded,
    });
  } catch { return null; }
}
