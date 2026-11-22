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

const signals = new WeakMap<object, AbortSignal>();

export function withAbort<C extends SupabaseClient>(client: C, signal: AbortSignal): C {
  const parent = signals.get(client);
  if (parent) signal = AbortSignal.any([parent, signal]);
  const wrapped = new Proxy(client, {
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
  signals.set(wrapped, signal);
  return wrapped;
}

/**
 * Nav PR 7 (lead ruling r3, H2): `withAbort`, and once the signal is aborted the client builds NO new query: `from()` and
 * `rpc()` throw the abort reason, so a reader past its deadline issues no page two and no follow-up read. No signal = the
 * client itself, untouched (a caller that passes nothing behaves byte for byte as before).
 */
export function withAbortStrict<C extends SupabaseClient>(client: C, signal: AbortSignal | undefined): C {
  if (!signal) return client;
  const wrapped = withAbort(client, signal);
  return new Proxy(wrapped, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if ((prop === "from" || prop === "rpc") && typeof v === "function") {
        return (...args: unknown[]) => { signal.throwIfAborted(); return (v as (...a: unknown[]) => unknown)(...args); };
      }
      return v;
    },
  });
}
