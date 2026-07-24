/**
 * EZCater webhook verification + notification parsing (spec #2c). Node-crypto
 * pure functions, fully unit-tested (tests/ezcater-webhook.test.ts) — never
 * imported client-side (only the webhook route and intake lib consume it).
 *
 * Contract (ezCater Public API User Guide, May 2024 v5 — fixture-fiction rule):
 *   X-Ezcater-Signature: "<unix-timestamp>.<hex hmac>"
 *   hmac = HMAC-SHA256(webhookSecret, "<timestamp>.<raw request body>")
 * Notification body: { id, parent_type, parent_id, entity_type, entity_id,
 * key ("accepted"|"cancelled"), occurred_at }.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface ParsedSignature {
  timestampSec: number;
  signature: string;
}

export function parseEzcaterSignature(header: string | null): ParsedSignature | null {
  if (!header) return null;
  const dot = header.indexOf(".");
  if (dot <= 0 || dot === header.length - 1) return null;
  const ts = Number(header.slice(0, dot));
  const sig = header.slice(dot + 1).trim();
  if (!Number.isFinite(ts) || ts <= 0 || sig.length === 0) return null;
  return { timestampSec: Math.trunc(ts), signature: sig };
}

/** Reject signatures older/newer than this window — closes the replay-append vector. */
export const SIGNATURE_FRESHNESS_SEC = 300;

export function verifyEzcaterSignature(
  secret: string,
  header: string | null,
  rawBody: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const parsed = parseEzcaterSignature(header);
  if (!parsed) return false;
  if (Math.abs(nowSec - parsed.timestampSec) > SIGNATURE_FRESHNESS_SEC) return false;
  const payload = `${parsed.timestampSec}.${rawBody}`;
  const computed = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(parsed.signature.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface EzcaterNotification {
  notificationId: string | null;
  parentId: string;   // ezCater caterer uuid
  entityType: string; // "Order"
  entityId: string;   // ezCater order uuid
  key: string;        // "accepted" | "cancelled" | future
  occurredAt: string | null;
}

/** Poison on malformed (house rule) — the route records the raw body either way. */
export function parseEzcaterNotification(json: unknown): EzcaterNotification {
  const b = json as Record<string, unknown> | null;
  if (b == null || typeof b !== "object") throw new Error("ezcater notification: not an object");
  const parentId = b.parent_id;
  const entityId = b.entity_id;
  const key = b.key;
  if (typeof parentId !== "string" || parentId.length === 0) throw new Error("ezcater notification: missing parent_id");
  if (typeof entityId !== "string" || entityId.length === 0) throw new Error("ezcater notification: missing entity_id");
  if (typeof key !== "string" || key.length === 0) throw new Error("ezcater notification: missing key");
  return {
    notificationId: typeof b.id === "string" ? b.id : null,
    parentId,
    entityType: typeof b.entity_type === "string" ? b.entity_type : "Order",
    entityId,
    key,
    occurredAt: typeof b.occurred_at === "string" ? b.occurred_at : null,
  };
}
