import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  moveStage,
  editLead,
  loadLead,
  leadCapacity,
  isPipelineStage,
  CateringPipelineError,
  PIPELINE_WRITE_MIN,
  PIPELINE_READ_MIN,
  type EditLeadInput,
} from "@/lib/catering/pipeline";

// GET — one lead + its Mode-A capacity signal (view >= 5).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/pipeline/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PIPELINE_READ_MIN) return jsonError(403, "forbidden");
  try {
    const lead = await loadLead(ctx, id);
    if (!lead) return jsonError(404, "not_found");
    const capacity = await leadCapacity(ctx, id);
    return jsonOk({ lead, capacity });
  } catch (e) {
    if (e instanceof CateringPipelineError) return jsonError(e.status, e.code);
    throw e;
  }
}

const EDIT_KEYS = [
  "contactName",
  "company",
  "eventDate",
  "headcount",
  "leadSource",
  "assignedTo",
  "notes",
  "followUpDate",
  "customerId",
  "estimatedRevenueCents",
] as const;

// PATCH — one concern per call (write >= 6):
//   { stage, note? }  → append-only stage move
//   any EDIT_KEYS     → edit the lead's mutable CRM fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/catering/pipeline/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < PIPELINE_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasStage = "stage" in b;
  const hasEdit = EDIT_KEYS.some((k) => k in b);
  const concerns = [hasStage, hasEdit].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields" });
  if (concerns > 1) return jsonError(400, "mixed_concerns", { message: "Move stage or edit fields, not both" });

  const optStr = (v: unknown): string | null | undefined =>
    v === null || v === undefined ? null : typeof v === "string" ? v : undefined;
  const optNum = (v: unknown): number | null | undefined =>
    v === null || v === undefined ? null : typeof v === "number" ? v : undefined;

  try {
    if (hasStage) {
      if (!isPipelineStage(b.stage)) return jsonError(400, "invalid_stage", { field: "stage" });
      const note = optStr(b.note);
      if (note === undefined) return jsonError(400, "invalid_payload", { field: "note" });
      await moveStage(ctx, { id, toStage: b.stage, note: note ?? null });
      return jsonOk({ ok: true });
    }

    const input: EditLeadInput = {};
    if ("contactName" in b) {
      if (typeof b.contactName !== "string") return jsonError(400, "invalid_payload", { field: "contactName" });
      input.contactName = b.contactName;
    }
    if ("company" in b) {
      const v = optStr(b.company);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "company" });
      input.company = v;
    }
    if ("eventDate" in b) {
      const v = optStr(b.eventDate);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "eventDate" });
      input.eventDate = v;
    }
    if ("headcount" in b) {
      const v = optNum(b.headcount);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "headcount" });
      input.headcount = v;
    }
    if ("assignedTo" in b) {
      const v = b.assignedTo;
      if (v !== null && typeof v !== "string") return jsonError(400, "invalid_payload", { field: "assignedTo" });
      input.assignedTo = v as string | null;
    }
    if ("leadSource" in b) {
      const v = optStr(b.leadSource);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "leadSource" });
      input.leadSource = v;
    }
    if ("notes" in b) {
      const v = optStr(b.notes);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "notes" });
      input.notes = v;
    }
    if ("followUpDate" in b) {
      const v = optStr(b.followUpDate);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "followUpDate" });
      input.followUpDate = v;
    }
    if ("customerId" in b) {
      const v = optStr(b.customerId);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "customerId" });
      input.customerId = v;
    }
    if ("estimatedRevenueCents" in b) {
      const v = optNum(b.estimatedRevenueCents);
      if (v === undefined) return jsonError(400, "invalid_payload", { field: "estimatedRevenueCents" });
      input.estimatedRevenueCents = v;
    }

    await editLead(ctx, id, input);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof CateringPipelineError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
