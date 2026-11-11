import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Authenticate the exact received bytes, before parsing or persistence. */
export function verifyMetaSignature(raw: Uint8Array, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
