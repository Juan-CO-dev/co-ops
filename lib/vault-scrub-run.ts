import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Retention runs even with the UI disabled. No master key or decryption is needed. */
export async function runVaultScrub(): Promise<{ scrubbed: number; migrationPending: boolean }> {
  try {
    const { data, error } = await getServiceRoleClient().rpc("vault_scrub_expired_secrets");
    // 0235 is authored but not applied. Only an absent RPC is a dormant-safe skip.
    if (error?.code === "PGRST202") return { scrubbed: 0, migrationPending: true };
    if (error || !Number.isSafeInteger(data) || data < 0) throw new Error("vault_scrub_failed");
    return { scrubbed: data as number, migrationPending: false };
  } catch {
    // Transport errors also stay out of cron responses and audit metadata.
    throw new Error("vault_scrub_failed");
  }
}
