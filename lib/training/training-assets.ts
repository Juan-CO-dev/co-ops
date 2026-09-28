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
 * signs. Returns null when storage has no such object (the scene then falls back
 * to the drawn look).
 */
export async function signTrainingPhoto(name: string): Promise<string | null> {
  const { data, error } = await getServiceRoleClient()
    .storage.from(TRAINING_ASSETS_BUCKET)
    .createSignedUrl(trainingPhotoObjectPath(name), TRAINING_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
