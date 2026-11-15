import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/admin/step-up-shared";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listPersonalEntriesForRecovery } from "@/lib/vault";
import { guardVaultRequest, vaultErrorResponse } from "@/lib/vault-route";
import { VAULT_OWNER_RECOVERY_LEVEL } from "@/lib/vault-shared";

/** Owner-level (9+): another person's personal entry NAMES, so one can be recovered. Never a secret. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const vr = await guardVaultRequest(req, `/api/vault/personal/${userId}`, { mutating: false });
  if (vr instanceof Response) return vr;
  // B166: a malformed user id never reaches the uuid column (it was a 500). Below the owner level the
  // answer stays the lib's own 403, so a low-level caller learns nothing new from the shape of the id.
  if (!isUuid(userId)) {
    return vr.actor.level < VAULT_OWNER_RECOVERY_LEVEL ? jsonError(403, "forbidden") : jsonError(400, "invalid_payload", { field: "userId" });
  }
  try {
    return jsonOk({ entries: await listPersonalEntriesForRecovery(getServiceRoleClient(), vr.actor, userId) });
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
