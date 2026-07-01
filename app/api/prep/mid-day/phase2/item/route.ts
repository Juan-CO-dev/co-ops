/**
 * POST /api/prep/mid-day/phase2/item — collaborative per-item Phase 2 save (C.43).
 * Records the prepped amount for one item (append-only supersede). Any clocked-in
 * cook; window = phase1_complete.
 *
 * Body: { instanceId: uuid, templateItemId: uuid, prepped: number >= 0 }
 * Response (success): { completionId: string, savedAt: string }
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { AM_PREP_BASE_LEVEL, saveMidDayPhase2Item, type MidDayOverUnder } from "@/lib/prep";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { ConfirmedInput } from "@/lib/prep-consumption";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ItemBody {
  instanceId: string;
  templateItemId: string;
  prepped: number;
  overUnder?: MidDayOverUnder | null;
  confirmedConsumption?: ConfirmedInput[] | null;
}

function parseOverUnder(v: unknown): MidDayOverUnder | null {
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind !== "over" && o.kind !== "under") return null;
  if (typeof o.reasonCategory !== "string") return null;
  return {
    kind: o.kind,
    reasonCategory: o.reasonCategory,
    directedBy: typeof o.directedBy === "string" ? o.directedBy : null,
    freeText: typeof o.freeText === "string" ? o.freeText : null,
  };
}

// null (not an array) = untouched → the lib records the derived-default consumption.
function parseConfirmedConsumption(v: unknown): ConfirmedInput[] | null {
  if (!Array.isArray(v)) return null;
  const out: ConfirmedInput[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.skuId !== "string" || !UUID_RE.test(o.skuId)) continue;
    if (typeof o.qtyOz !== "number" || !Number.isFinite(o.qtyOz)) continue;
    out.push({
      skuId: o.skuId,
      qtyOz: o.qtyOz,
      qtyEntered: typeof o.qtyEntered === "number" && Number.isFinite(o.qtyEntered) ? o.qtyEntered : null,
      unitEntered: typeof o.unitEntered === "string" ? o.unitEntered : null,
      derivedOz: typeof o.derivedOz === "number" && Number.isFinite(o.derivedOz) ? o.derivedOz : null,
    });
  }
  return out;
}

function validateBody(
  raw: unknown,
): { ok: true; body: ItemBody } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;
  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return { ok: false, field: "instanceId" };
  }
  if (typeof r.templateItemId !== "string" || !UUID_RE.test(r.templateItemId)) {
    return { ok: false, field: "templateItemId" };
  }
  if (typeof r.prepped !== "number" || !Number.isFinite(r.prepped) || r.prepped < 0) {
    return { ok: false, field: "prepped" };
  }
  const overUnder = parseOverUnder(r.overUnder);
  const confirmedConsumption = parseConfirmedConsumption(r.confirmedConsumption);
  return {
    ok: true,
    body: { instanceId: r.instanceId, templateItemId: r.templateItemId, prepped: r.prepped, overUnder, confirmedConsumption },
  };
}

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/prep/mid-day/phase2/item");
  if (ctx instanceof Response) return ctx;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include instanceId (uuid), templateItemId (uuid), prepped (number >= 0).",
      field: validation.field,
    });
  }
  const body = validation.body;

  const service = getServiceRoleClient();
  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id")
    .eq("id", body.instanceId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (instErr) {
    console.error(`[/api/prep/mid-day/phase2/item] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", { message: "Instance not found", instance_id: body.instanceId });
  }
  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, instance.location_id)) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: instance.location_id,
    });
  }
  if (ctx.level < AM_PREP_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", {
      message: "Mid-day prep is for shift staff.",
      required_level: AM_PREP_BASE_LEVEL,
    });
  }

  try {
    const result = await saveMidDayPhase2Item(service, {
      instanceId: body.instanceId,
      templateItemId: body.templateItemId,
      prepped: body.prepped,
      overUnder: body.overUnder ?? null,
      confirmedConsumption: body.confirmedConsumption,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    if (!result.ok) {
      if (result.reason === "not_found") {
        return jsonError(404, "instance_not_found", { message: "Mid-day instance not found." });
      }
      if (result.reason === "not_in_phase2") {
        return jsonError(409, "not_in_phase2", { message: "This instance isn't in the Phase 2 window." });
      }
      return jsonError(400, "bad_item", { message: "Item not found in this template." });
    }
    return jsonOk({ completionId: result.completionId, savedAt: result.savedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/mid-day/phase2/item] save failed:`, msg);
    return jsonError(500, "internal_error", { message: "save failed" });
  }
}
