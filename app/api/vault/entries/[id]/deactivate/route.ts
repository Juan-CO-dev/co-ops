import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/admin/step-up-shared";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { deactivateVaultEntry } from "@/lib/vault";
import { guardVaultRequest, vaultErrorResponse } from "@/lib/vault-route";

/** Remove an entry from the vault (active=false; history stays). Recorded; management notified for a shared entry. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vr = await guardVaultRequest(req, `/api/vault/entries/${id}/deactivate`, { mutating: true });
  if (vr instanceof Response) return vr;
  if (!isUuid(id)) return jsonError(404, "entry_not_found"); // B166: a malformed id never reaches the uuid column
  try {
    await deactivateVaultEntry(getServiceRoleClient(), vr.actor, id, vr.meta);
    return jsonOk({ ok: true });
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
