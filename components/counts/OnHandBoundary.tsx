"use client";

/**
 * B9 — the error boundary around the STREAMED on-hand panel on /operations/counts.
 *
 * The count form renders first; the on-hand panel streams in behind <Suspense>. If the
 * panel's read fails (or runs past its deadline — see the page), this replaces the
 * "Loading…" line with a translated notice and a retry, so the panel can never sit on
 * "Loading…" forever and the form above stays usable. `unstable_retry` re-fetches the
 * Server Component children (next/error); the raw error message is never rendered (in
 * production it is a redacted digest anyway).
 *
 * Text arrives pre-translated from the server (the page owns the language).
 */
import { unstable_catchError, type ErrorInfo } from "next/error";
import { ActionButton } from "@/components/ActionButton";

function OnHandLoadFailed(
  props: { message: string; retryLabel: string },
  { unstable_retry }: ErrorInfo,
) {
  return (
    <div role="alert" className="mt-3 rounded-lg border border-co-border bg-co-warning-surface p-3">
      <p className="text-sm text-co-warning-text">{props.message}</p>
      <ActionButton variant="secondary" className="mt-3" onClick={() => unstable_retry()}>
        {props.retryLabel}
      </ActionButton>
    </div>
  );
}

export const OnHandBoundary = unstable_catchError(OnHandLoadFailed);
