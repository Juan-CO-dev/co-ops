/**
 * Trusted client-IP extraction (A-M2).
 *
 * `x-forwarded-for` is client-settable, so its LEFTMOST token is spoofable — an attacker can send
 * `X-Forwarded-For: <anything>` to forge the source IP, defeating any per-IP rate-limit key and
 * poisoning audit `ip_address` forensics. On Vercel, the platform sets `x-vercel-forwarded-for`
 * (and `x-real-ip`) to the REAL connecting IP and ignores client-injected values for them — those
 * are the trustworthy sources. Fall back to the RIGHTMOST `x-forwarded-for` hop (the one appended by
 * the nearest trusted proxy), never the leftmost.
 */

import type { NextRequest } from "next/server";

export function trustedClientIp(req: NextRequest): string | null {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]?.trim() || null;
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim() || null;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    return hops.length > 0 ? hops[hops.length - 1]! : null;
  }
  return null;
}
