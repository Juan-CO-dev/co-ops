/**
 * The page anchors the digest deep links scroll to (lib/report-digests-links.ts). Client-safe and
 * zero-import so the target pages and components can name the SAME id the email links to. Each is a
 * stable id on an existing element (no visual change); the sign-in page carries the fragment through
 * a sign-in (app/page.tsx, `withReturnFragment`).
 */
export const DIGEST_ANCHORS = {
  /** /operations/receiving — the recent deliveries list. */
  receivingRecent: "recent-deliveries",
  /** /operations/receiving — the open vendor credits panel. */
  receivingCredits: "open-credits",
  /** /catering/pipeline — the "to ring in Toast" list. */
  pipelineToRing: "to-ring-in-toast",
  /** /catering/pipeline — one lead's card (the board already opens it from this hash). */
  lead: (id: string) => `lead-${id}`,
} as const;
