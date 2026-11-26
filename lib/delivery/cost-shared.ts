/**
 * Catering delivery (D1) — folding the courier COST observations (plan r6 section 4.4). Zero I/O. Client-safe.
 *
 * COST IS NOT THE FEE. A cost is what a courier charges US (a payable). The delivery fee the customer pays
 * (`catering_quotes.delivery_fee_cents`) is a receivable. They never share a column or a sum, and neither is ever
 * added to pipeline value or a sales figure.
 *
 * UNKNOWN IS NOT ZERO. A job with NO cost row has cost `unknown`. A job that cost nothing is recorded as such (an
 * explicit `base` row of 0): a record, distinct from silence. An ORDER's cost is `complete` only when EVERY one of its
 * jobs (closed or open) is known; `partial` reads "at least $X — N deliveries with no cost recorded".
 *
 * FOLDING. A monetary identity (`money_identity`) is one figure. Within it, a correction chain's HEAD (the row nothing
 * corrects) stands for the chain. A `snapshot` states the figure (the latest snapshot head wins); a `delta` adds to it
 * (deltas observed after the latest snapshot, or all of them when there is none). Manual rows are always snapshots with
 * one chain per identity; the delta and multi-snapshot shapes are the provider adapter's (a later PR).
 * A job's cost = its `invoice_total` when one exists (the other components stay as the explanation and the difference
 * is SHOWN, never absorbed), else the sum of its components.
 */
import { DELIVERY_COST_COMPONENTS, type DeliveryCostComponent, type DeliveryCostRow } from "./types-shared";

/** What folding reads of a cost row: no note, no author, no source (D4's report selects exactly these). */
export type CostFoldRow = Pick<DeliveryCostRow, "id" | "jobId" | "component" | "semantics" | "amountCents" | "moneyIdentity" | "observedAt" | "correctsId">;

/** The heads of every correction chain: rows that no other row corrects. */
export function costHeads<T extends CostFoldRow>(rows: readonly T[]): T[] {
  const corrected = new Set(rows.map((r) => r.correctsId).filter((id): id is string => id !== null));
  return rows.filter((r) => !corrected.has(r.id));
}

const byObserved = (a: CostFoldRow, b: CostFoldRow) => {
  const ta = Date.parse(a.observedAt), tb = Date.parse(b.observedAt);
  return ta !== tb ? ta - tb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/** One identity's figure from its chain heads. */
function identityCents(heads: readonly CostFoldRow[]): number {
  const snapshots = heads.filter((h) => h.semantics === "snapshot").sort(byObserved);
  const latest = snapshots[snapshots.length - 1];
  const deltas = heads.filter((h) => h.semantics === "delta" && (!latest || byObserved(h, latest) > 0));
  return (latest?.amountCents ?? 0) + deltas.reduce((sum, d) => sum + d.amountCents, 0);
}

export type JobCost =
  | { kind: "unknown" }
  | {
      kind: "known";
      /** THE job's cost. */
      cents: number;
      basis: "invoice_total" | "components";
      /** The sum of every component but the invoice total (the explanation). */
      componentsCents: number;
      invoiceTotalCents: number | null;
      /** invoice total − components, when both exist. Shown, never absorbed. */
      differenceCents: number | null;
      /** Each component's current figure, in the canonical component order (no invoice total). */
      components: { component: DeliveryCostComponent; cents: number }[];
    };

/** One job's cost from ITS cost rows (every row must belong to the job; `orderCost` filters). */
export function jobCost(rows: readonly CostFoldRow[]): JobCost {
  if (rows.length === 0) return { kind: "unknown" };
  const identities = new Map<string, CostFoldRow[]>();
  for (const h of costHeads(rows)) {
    const list = identities.get(h.moneyIdentity);
    if (list) list.push(h); else identities.set(h.moneyIdentity, [h]);
  }
  const perComponent = new Map<DeliveryCostComponent, number>();
  for (const heads of identities.values()) {
    const component = heads[0]!.component;
    perComponent.set(component, (perComponent.get(component) ?? 0) + identityCents(heads));
  }
  const components = DELIVERY_COST_COMPONENTS.filter((c) => c !== "invoice_total" && perComponent.has(c))
    .map((component) => ({ component, cents: perComponent.get(component)! }));
  const componentsCents = components.reduce((sum, c) => sum + c.cents, 0);
  const invoice = perComponent.has("invoice_total") ? perComponent.get("invoice_total")! : null;
  if (invoice !== null) {
    return { kind: "known", cents: invoice, basis: "invoice_total", componentsCents, invoiceTotalCents: invoice,
      differenceCents: components.length > 0 ? invoice - componentsCents : null, components };
  }
  return { kind: "known", cents: componentsCents, basis: "components", componentsCents, invoiceTotalCents: null, differenceCents: null, components };
}

/** An order's delivery cost over ALL its jobs. Only `complete` may yield a net or enter a complete total. */
export type OrderCost =
  | { kind: "complete"; cents: number }
  | { kind: "partial"; knownCents: number; unknownJobs: number }
  | { kind: "none" }
  | { kind: "unknown" };

export function orderCost(jobs: readonly { jobId: string; costs: readonly CostFoldRow[] }[]): OrderCost {
  if (jobs.length === 0) return { kind: "none" };
  let knownCents = 0, known = 0;
  for (const job of jobs) {
    const cost = jobCost(job.costs.filter((c) => c.jobId === job.jobId));
    if (cost.kind === "known") { known += 1; knownCents += cost.cents; }
  }
  if (known === 0) return { kind: "unknown" };
  if (known < jobs.length) return { kind: "partial", knownCents, unknownJobs: jobs.length - known };
  return { kind: "complete", cents: knownCents };
}
