/**
 * Catering delivery D3 — THE bound on a delivery read that rides beside other data. No I/O of its own.
 *
 * A delivery read is never the reason a surface is there: the pulse's catering section, the mid-shift page, the pipeline
 * board and the day plan all show something else first. So a delivery read that HANGS may never take its surface down
 * (a rejected read already could not: its failure is an answer). Every such read runs through `boundedDeliveryRead`:
 * it never rejects and never outlives `ms`; a throw or a timeout is `{ ok: false }` — "Couldn't load delivery", never
 * "to book" — while the rest of the surface renders.
 *
 * `DELIVERY_READ_DEADLINE_MS` sits well inside every surface's own deadline (the pulse section's 7 s, the day load's 6 s).
 */
export const DELIVERY_READ_DEADLINE_MS = 3_000;

export function boundedDeliveryRead<T>(read: () => Promise<T>, ms: number = DELIVERY_READ_DEADLINE_MS): Promise<T | { ok: false }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false }), ms);
    Promise.resolve().then(read).then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve({ ok: false }); },
    );
  });
}
