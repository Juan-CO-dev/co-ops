/** Pure build-receipt helpers. No import.meta, no I/O — safe to import from Playwright specs (CJS-transpiled). */
import { createHash } from "node:crypto";
import { SIM_APP_ORIGIN } from "../../../lib/sim-isolation-shared";

type Env = Record<string, string | undefined>;
export type BuildReceipt = {
  candidateSha: string; dirty: boolean; lockfileSha256: string; policyVersion: string;
  publicConfigDigest: string; buildId: string; builtAt: string; nodeVersion: string; nextVersion: string;
};
export type BuildIdentity = Omit<BuildReceipt, "builtAt">;
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Canonical public configuration only. Neither keys nor values are persisted in the receipt. */
export function publicConfigDigest(env: Env): string {
  return hash(JSON.stringify(Object.keys(env).filter(key => key.startsWith("NEXT_PUBLIC_") && env[key] !== undefined)
    .sort().map(key => [key, hash(env[key]!)])));
}

/** Pure refusal contract: messages contain field names only, never observed values. */
export function validateBuildReceipt(value: unknown, expected: BuildIdentity): BuildReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("build receipt mismatch: receipt");
  const receipt = value as Record<string, unknown>;
  for (const key of Object.keys(expected) as (keyof BuildIdentity)[]) {
    if (receipt[key] !== expected[key]) throw new Error(`build receipt mismatch: ${key}`);
  }
  if (typeof receipt.buildId !== "string" || !/^[A-Za-z0-9_-]+$/.test(receipt.buildId) || /\s/.test(receipt.buildId)) throw new Error("build receipt mismatch: buildId");
  if (typeof receipt.builtAt !== "string" || !Number.isFinite(Date.parse(receipt.builtAt))) throw new Error("build receipt mismatch: builtAt");
  return receipt as BuildReceipt;
}

/** Return only local build-specific asset paths, never RSC strings or generic chunk directories.
 * App Router HTML normally yields NONE (chunks are content-hashed under /_next/static/chunks/). */
export function buildAssetsFromHtml(html: string): { buildId: string; path: string }[] {
  const assets: { buildId: string; path: string }[] = [];
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi)) {
    const raw = match[2]!.replaceAll("&amp;", "&");
    if (raw.startsWith("//") || /[\s\\]/.test(raw)) continue;
    try {
      const url = new URL(raw, SIM_APP_ORIGIN);
      if (url.origin !== SIM_APP_ORIGIN || url.username || url.password) continue;
      const path = url.pathname;
      const id = /^\/_next\/static\/([A-Za-z0-9_-]+)\/.+/.exec(path)?.[1];
      if (id && !["chunks", "css", "media", "development"].includes(id)) assets.push({ buildId: id, path });
    } catch { /* Invalid asset URLs do not attest identity. */ }
  }
  return assets;
}
