import type { NextRequest } from "next/server";
import { jsonOk } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listPersonalEntriesForRecovery } from "@/lib/vault";
import { guardVaultRequest, vaultErrorResponse } from "@/lib/vault-route";

/** Owner-level (9+): another person's personal entry NAMES, so one can be recovered. Never a secret. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const vr = await guardVaultRequest(req, `/api/vault/personal/${userId}`, { mutating: false });
  if (vr instanceof Response) return vr;
  try {
    return jsonOk({ entries: await listPersonalEntriesForRecovery(getServiceRoleClient(), vr.actor, userId) });
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
