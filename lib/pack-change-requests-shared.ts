/**
 * "This case looks different" — the client-safe half (catalog Phase 2b, 0261). The door sends a
 * note and, optionally, two numbers it can see; the GM's sentence editor opens prefilled from them.
 * PURE: no I/O, no server imports.
 */
import type { SentenceDraft } from "@/lib/catalog/pack-sentence-shared";
import { catalogWriteRoleAllowed } from "@/lib/sku-versions-shared";
import type { RoleCode } from "@/lib/roles";

export interface PackChangeProposal { innerCount: number | null; eachWeight: number | null; eachUnit: "oz" | "lb" | null }

/** Reporting is a key-holder act at the door (receiving's own floor, RECEIVE_MIN). */
export const PACK_REQUEST_FILE_MIN = 4;
/** Resolving (apply or "nothing changed") and reading the open list is the shop's version writer: AGM+. */
export const PACK_REQUEST_RESOLVE_MIN = 6;
export const PACK_REQUEST_NOTE_MAX = 500;

/**
 * Who may READ and RESOLVE door reports: the catalog writers — level 7+ any role; at level 6 only the
 * operational managers (AGM, prep, catering), never the social media manager (a ROLE check —
 * catalogWriteRoleAllowed, the 2a lead decision). Callers check this before asking for the list.
 */
export function packRequestReviewAllowed(actor: { role: RoleCode; level: number }): boolean {
  return actor.level >= PACK_REQUEST_RESOLVE_MIN && catalogWriteRoleAllowed(actor.role, actor.level);
}

/** null = no proposal (absent, or every field empty); "invalid" = refuse the request. */
export function parsePackChangeProposal(raw: unknown): PackChangeProposal | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== "innerCount" && k !== "eachWeight" && k !== "eachUnit") return "invalid";
  const num = (v: unknown, max: number): number | null | "invalid" => {
    if (v === null || v === undefined) return null;
    return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : "invalid";
  };
  const innerCount = num(r.innerCount, 1000);
  const eachWeight = num(r.eachWeight, 10000);
  const eachUnit = r.eachUnit === null || r.eachUnit === undefined ? null : r.eachUnit === "oz" || r.eachUnit === "lb" ? r.eachUnit : "invalid";
  if (innerCount === "invalid" || eachWeight === "invalid" || eachUnit === "invalid") return "invalid";
  if (innerCount !== null && !Number.isInteger(innerCount)) return "invalid";
  if ((eachWeight === null) !== (eachUnit === null)) return "invalid";
  if (innerCount === null && eachWeight === null) return null;
  return { innerCount, eachWeight, eachUnit };
}

/** Prefill the GM's sentence from the door's numbers, on top of the current sentence. */
export function proposalToSentence(p: PackChangeProposal, current: SentenceDraft | null): SentenceDraft {
  const base: SentenceDraft = current
    ? { containers: current.containers.map((c) => ({ ...c })), leafQty: current.leafQty, leafUnit: current.leafUnit }
    : { containers: [{ label: "case", qty: "1" }], leafQty: "", leafUnit: "oz" };
  if (p.innerCount != null) {
    if (base.containers.length >= 2) base.containers[1] = { ...base.containers[1]!, qty: String(p.innerCount) };
    else base.containers.push({ label: "inner", qty: String(p.innerCount) });
  }
  if (p.eachWeight != null && p.eachUnit != null) {
    base.leafQty = String(p.eachWeight);
    base.leafUnit = p.eachUnit;
  }
  return base;
}
