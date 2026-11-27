/**
 * The page anchors the digest deep links scroll to (lib/report-digests-links.ts). Client-safe and
 * zero-import so the target pages and components can name the SAME id the email links to. Each is a
 * stable id on an existing element (no visual change); the sign-in page carries the fragment through
 * a sign-in (app/page.tsx, `withReturnFragment`). Every id here is a plain id (letters, digits, `-`),
 * which is what that fragment rule accepts (tests/report-digests-deep-links.test.ts pins it).
 */
export const DIGEST_ANCHORS = {
  /** /operations/receiving — the recent deliveries list. */
  receivingRecent: "recent-deliveries",
  /** /operations/receiving — the open vendor credits panel. */
  receivingCredits: "open-credits",
  /** /catering/pipeline — the "to ring in Toast" list. */
  pipelineToRing: "to-ring-in-toast",
  /** /catering/pipeline — the "Follow-ups due" list (rendered only when one is due). */
  pipelineFollowUps: "follow-ups",
  /** /catering/pipeline — the stage board (Inquiry … Lost columns). */
  pipelineStages: "pipeline-stages",
  /** /catering/pipeline — one lead's card (the board already opens it from this hash). */
  lead: (id: string) => `lead-${id}`,
  /** /ordering — "Today's orders" (OrderingSurfaces). */
  orderingToday: "todays-orders",
  /** /ordering — the missed-cutoff alert (rendered only when a cutoff passed with nothing placed). */
  orderingMissed: "missed-cutoffs",
  /** /ordering — today's cutoff vendors without a draft (OrderingSurfaces). */
  orderingCutoffs: "order-cutoffs",
  /** /ordering — the par walk. */
  orderingWalk: "order-walk",
  /** /operations/counts — the on-hand panel. */
  countsOnHand: "on-hand",
  /** /admin/catering/prep-demand — one need date's section on the Prep tab. */
  prepDay: (day: string) => `prep-day-${day}`,
} as const;
