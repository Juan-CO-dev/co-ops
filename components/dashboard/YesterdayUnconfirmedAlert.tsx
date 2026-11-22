/**
 * Yesterday's unconfirmed closing (the late-close alert; spec 3.2 item 3, 3.3.2). Moved verbatim out of the Dashboard
 * page (nav PR 7) so the page can render it from `plan.alerts` and the midnight cases can render it on their own. Server
 * component.
 */
import { ActionLink } from "@/components/ActionButton";
import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

export function YesterdayUnconfirmedAlert({
  location,
  yesterdayDate,
  language,
}: {
  location: { id: string; code: string };
  yesterdayDate: string;
  language: Language;
}) {
  return (
    <section
      role="alert"
      aria-label={serverT(language, "dashboard.yesterday.aria")}
      className="
        flex flex-col gap-3 rounded-2xl
        border-2 border-co-gold-deep bg-co-warning-surface
        p-4 sm:p-5
      "
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="
            mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center
            rounded-full bg-co-gold-deep text-co-text
          "
        >
          <WarningIcon />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-co-text">
            {serverT(language, "dashboard.yesterday.title", { code: location.code })}
          </p>
          <p className="mt-1 text-xs text-co-text-muted">
            {serverT(language, "dashboard.yesterday.body", {
              date: formatDateLabel(yesterdayDate, language),
            })}
          </p>
        </div>
      </div>
      <div className="sm:pl-10">
        <ActionLink
          href={`/operations/closing?location=${location.id}&date=${yesterdayDate}`}
          variant="secondary"
          className="w-full sm:w-auto"
        >
          {serverT(language, "dashboard.yesterday.cta")}
        </ActionLink>
      </div>
    </section>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5L15 14H1L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}
