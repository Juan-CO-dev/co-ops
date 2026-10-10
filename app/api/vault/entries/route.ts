import type { NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { createVaultEntry, listVaultEntries } from "@/lib/vault";
import { guardVaultRequest, isObjectBody, vaultErrorResponse } from "@/lib/vault-route";
import { validateEntryInput } from "@/lib/vault-shared";

const PATH = "/api/vault/entries";

/** The entries the viewer may see (shared at/above their floor in their shops + their own personal). Never a secret. */
export async function GET(req: NextRequest) {
  const vr = await guardVaultRequest(req, PATH, { mutating: false });
  if (vr instanceof Response) return vr;
  try {
    return jsonOk(await listVaultEntries(getServiceRoleClient(), vr.actor));
  } catch (e) {
    return vaultErrorResponse(e);
  }
}

/** Create a shared (GM own shop / level 8+) or personal entry. The secret is required and is never echoed. */
export async function POST(req: NextRequest) {
  const vr = await guardVaultRequest(req, PATH, { mutating: true });
  if (vr instanceof Response) return vr;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isObjectBody(parsed)) return jsonError(400, "invalid_payload");
  try {
    const input = validateEntryInput(parsed, { requireSecret: true });
    const view = await createVaultEntry(getServiceRoleClient(), vr.actor, input, vr.meta);
    return jsonOk({ entry: view }, 201);
  } catch (e) {
    return vaultErrorResponse(e);
  }
}
