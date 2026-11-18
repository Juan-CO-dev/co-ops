/**
 * Demand signals (item 4 PR 1): the content hash. Node-only (node:crypto), no I/O. The database
 * recomputes the same sha256 over the same text in `demand_blob_put` (0342), so a blob can never be
 * stored under a name its content does not have.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-shared";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A value's canonical text and its name. */
export function addressOf(value: unknown): { hash: string; text: string } {
  const text = canonicalJson(value);
  return { hash: sha256Hex(text), text };
}
