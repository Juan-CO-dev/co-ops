/**
 * The bell's loading slot (nav PR 9, plan r2 4.2): the streamed bell's <Suspense> fallback. A 44 x 44 bell with no
 * badge, `aria-busy`, labelled "Loading notifications". Plain markup (no hooks): the label comes translated.
 */
export function BellSlot({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-busy="true"
      aria-label={label}
      data-co-bell-slot=""
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-co-border bg-co-surface text-co-text-dim"
    >
      <BellIcon />
    </span>
  );
}

export function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5v2.25c0 1-0.4 1.95-1.1 2.65L3.75 13.5h12.5l-0.65-0.6c-0.7-0.7-1.1-1.65-1.1-2.65V8a4.5 4.5 0 0 0-4.5-4.5Z" />
      <path d="M8.25 16.25a1.75 1.75 0 0 0 3.5 0" />
      <path d="M10 2.5v1" />
    </svg>
  );
}
