import type { NextRequest } from "next/server";
import { isUuid } from "@/lib/admin/step-up-shared";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { updateVaultEntry } from "@/lib/vault";
import { guardVaultRequest, isObjectBody, vaultErrorResponse } from "@/lib/vault-route";
import { validateEntryInput } from "@/lib/vault-shared";

/** Edit an entry's details and/or rotate its secret (a blank secret keeps the current one). Never echoes a secret. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vr = await guardVaultRequest(req, `/api/vault/entries/${id}`, { mutating: true });
  if (vr instanceof Response) return vr;
  if (!isUuid(id)) return jsonError(404, "entry_not_found"); // B166: a malformed id never reaches the uuid column
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isObjectBody(parsed)) return jsonError(400, "invalid_payload");
  try {
    const input = validateEntryInput(parsed, { requireSecret: false });
    const view = await updateVaultEntry(getServiceRoleClient(), vr.actor, id, input, vr.meta);
    return jsonOk({ entry: view });
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
