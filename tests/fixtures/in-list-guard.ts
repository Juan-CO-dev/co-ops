/**
 * THE REQUEST-LINE CEILING, made executable (audit W17: B023 / B098 / B184).
 *
 * PostgREST puts an `.in()` filter in the GET request line, and the gateway refuses a line
 * that is too long BEFORE any SQL runs (a `production_id` list breaks at 221 ids — pinned in
 * loader-scale-ceilings.test.ts). The in-memory fake answers any list, so a loader that
 * spends an ever-growing id list passes every fixture and fails in production. This wrapper
 * gives the fake the same cliff: an `.in()` list longer than `max` throws, exactly where
 * the gateway would have answered 414.
 */
import type { getServiceRoleClient } from "@/lib/supabase-server";

type Client = ReturnType<typeof getServiceRoleClient>;

/** The house chunk size (PRODUCTION_ID_CHUNK): a list this long is the most a request may spend. */
export const IN_LIST_MAX = 150;

export function withInListGuard(client: Client, max = IN_LIST_MAX): Client {
  const inner = client as unknown as { from(table: string): Record<string, unknown> };
  return {
    from(table: string) {
      const q = inner.from(table);
      const realIn = q.in as (col: string, vs: unknown[]) => unknown;
      q.in = (col: string, vs: unknown[]) => {
        if (vs.length > max) throw new Error(`414 request-line: ${table}.${col} in (${vs.length} ids)`);
        return realIn(col, vs);
      };
      return q;
    },
  } as unknown as Client;
}
