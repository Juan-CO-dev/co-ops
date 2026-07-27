import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createCountEvent, CountError, COUNT_WRITE_MIN, type CreateCountEventInput } from "@/lib/counts";
import type { CountLineInput } from "@/lib/counts-shared";

// Record a physical-count EVENT (pack hierarchy PR 2). AGM+ (>=6), Tier-A step-up
// (A4), location-bound (checked in createCountEvent). One event per POST (council L5).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/counts");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < COUNT_WRITE_MIN) return jsonError(403, "forbidden");

  // Tier-A step-up on write (A4).
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  if (!Array.isArray(b.lines)) return jsonError(400, "no_lines");

  // Narrow each line defensively (client is untrusted).
  const lines: CountLineInput[] = [];
  for (const raw of b.lines as unknown[]) {
    if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_payload", { field: "lines" });
    const r = raw as Record<string, unknown>;
    if (typeof r.skuId !== "string" || typeof r.levelLabel !== "string" || typeof r.qty !== "number") {
      return jsonError(400, "invalid_payload", { field: "lines" });
    }
    const partial = r.partialFraction;
    const partialFraction = partial === undefined || partial === null ? null : typeof partial === "number" ? partial : undefined;
    if (partialFraction === undefined) return jsonError(400, "invalid_payload", { field: "partialFraction" });
    lines.push({
      skuId: r.skuId, levelLabel: r.levelLabel, qty: r.qty,
      isLoose: r.isLoose === true, partialFraction,
    });
  }

  const note = b.note === undefined || b.note === null ? null : typeof b.note === "string" ? b.note : undefined;
  if (note === undefined) return jsonError(400, "invalid_payload", { field: "note" });

  const input: CreateCountEventInput = { locationId: b.locationId, note, lines };
  try {
    const res = await createCountEvent(ctx, input);
    return jsonOk({ countEventId: res.countEventId }, 201);
  } catch (e) {
    if (e instanceof CountError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
