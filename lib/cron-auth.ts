import { timingSafeEqual } from "node:crypto";

function same(provided: string, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(provided), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Desktop header takes precedence, preserving digest-tick's credential contract. */
export function cronAuthStatus(headers: Headers): 401 | 503 | null {
  const pinger = process.env.CATERING_SCAN_SECRET;
  const vercel = process.env.CRON_SECRET;
  if (!pinger && !vercel) return 503;
  const header = headers.get("x-cron-secret");
  if (header !== null) return same(header, pinger) ? null : 401;
  const bearer = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1] ?? "";
  return same(bearer, vercel) || same(bearer, pinger) ? null : 401;
}
