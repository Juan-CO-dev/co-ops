/**
 * Mid-shift Pulse v2 — carry one AbortSignal into every PostgREST query a client issues (Astra #2:
 * "the seven-second promise race does not cancel database work"). PURE (no I/O, no server import):
 * a Proxy over the Supabase client whose `from()` builders and `rpc()` calls get `.abortSignal(signal)`
 * appended to the first filter builder they produce. Readers that take the service client (the shift
 * board, report statuses, fridges, catering, par pass, handoff, layout) need no change to be cancellable.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Abortable = { abortSignal?: (signal: AbortSignal) => unknown };

function attach(result: unknown, signal: AbortSignal): unknown {
  const r = result as Abortable | null;
  return r && typeof r === "object" && typeof r.abortSignal === "function" ? r.abortSignal(signal) : result;
}

export function withAbort<C extends SupabaseClient>(client: C, signal: AbortSignal): C {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          const qb = (target as unknown as { from: (t: string) => object }).from(table);
          return new Proxy(qb, {
            get(qt, qp) {
              const v = Reflect.get(qt, qp) as unknown;
              if (typeof v !== "function") return v;
              return (...args: unknown[]) => attach((v as (...a: unknown[]) => unknown).apply(qt, args), signal);
            },
          });
        };
      }
      if (prop === "rpc") {
        return (...args: unknown[]) => attach((target as unknown as { rpc: (...a: unknown[]) => unknown }).rpc(...args), signal);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
