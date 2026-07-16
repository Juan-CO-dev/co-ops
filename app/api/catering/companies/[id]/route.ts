import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadCompany,
  editCompany,
  addDomain,
  removeDomain,
  attachContactByEmail,
  CateringCompanyError,
  COMPANY_READ_MIN,
  COMPANY_WRITE_MIN,
} from "@/lib/catering/companies";

// GET — one company + its domains + contacts (view >= 5).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/companies/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < COMPANY_READ_MIN) return jsonError(403, "forbidden");
  try {
    const detail = await loadCompany(ctx, id);
    if (!detail) return jsonError(404, "not_found");
    return jsonOk({ company: detail.company, domains: detail.domains, contacts: detail.contacts });
  } catch (e) {
    if (e instanceof CateringCompanyError) return jsonError(e.status, e.code);
    throw e;
  }
}

// PATCH — one concern per call (write >= 6): edit | add domain | remove domain | attach contact.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/catering/companies/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < COMPANY_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasEdit = "name" in b || "notes" in b;
  const hasAddDomain = "addDomain" in b;
  const hasRemoveDomain = "removeDomainId" in b;
  const hasAttach = "attachContactEmail" in b;
  const concerns = [hasEdit, hasAddDomain, hasRemoveDomain, hasAttach].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields" });
  if (concerns > 1) return jsonError(400, "mixed_concerns", { message: "One change at a time" });

  try {
    if (hasAddDomain) {
      if (typeof b.addDomain !== "string") return jsonError(400, "invalid_payload", { field: "addDomain" });
      const { id: domainId } = await addDomain(ctx, id, b.addDomain);
      return jsonOk({ id: domainId }, 201);
    }
    if (hasRemoveDomain) {
      if (typeof b.removeDomainId !== "string") return jsonError(400, "invalid_payload", { field: "removeDomainId" });
      await removeDomain(ctx, b.removeDomainId);
      return jsonOk({ ok: true });
    }
    if (hasAttach) {
      if (typeof b.attachContactEmail !== "string") return jsonError(400, "invalid_payload", { field: "attachContactEmail" });
      const { contactId } = await attachContactByEmail(ctx, id, b.attachContactEmail);
      return jsonOk({ contactId });
    }
    // edit
    const patch: { name?: string; notes?: string | null } = {};
    if ("name" in b) {
      if (typeof b.name !== "string") return jsonError(400, "invalid_payload", { field: "name" });
      patch.name = b.name;
    }
    if ("notes" in b) patch.notes = typeof b.notes === "string" ? b.notes : null;
    await editCompany(ctx, id, patch);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof CateringCompanyError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
