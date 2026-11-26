"use client";

/**
 * The Go to sheet (nav PR 9, plan r2 3.1, 4.4; spec 4.2). Inside the shared `Sheet`: a visually hidden heading, a close
 * button, the search box (focused on open), a polite live region with the result count, then either the RESULTS (pages,
 * then people) or the five ROOMS with the pages this person can open, then the Me controls.
 *
 * Pages are searched on the client over the model the server already filtered (`searchEntries`): there is nothing to
 * ask for that widens it. People are fetched from the gated route only when a query is typed (PeopleResults), and only
 * when the model offers them. Enter in the box follows the first page result. Every link is `prefetch={false}` (a
 * prefetch from an admin page would render a non-admin layout and clear the step-up unlock) and closes the sheet.
 */
import { useCallback, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { searchEntries, type GoToEntry, type GoToModel } from "@/lib/nav/go-to-shared";

import { GO_TO_SHEET_ID } from "./GoToButton";
import { MeControls, type MeProps } from "./MeControls";
import { PeopleResults } from "./PeopleResults";
import { Sheet } from "./Sheet";

export interface GoToSheetProps {
  model: GoToModel;
  me: MeProps;
  open: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

export function GoToSheet({ model, me, open, onClose, returnFocus }: GoToSheetProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [peopleCount, setPeopleCount] = useState(0);
  const router = useRouter();

  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const q = query.trim();
  const pages = useMemo(() => (q ? searchEntries(model, q) : []), [model, q]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const first = pages[0];
    if (!first) return;
    e.preventDefault();
    close();
    router.push(first.href);
  };

  return (
    <Sheet id={GO_TO_SHEET_ID} open={open} onClose={close} labelledBy={headingId} initialFocus={searchRef} returnFocus={returnFocus}>
      <div className="flex items-center gap-2 border-b-2 border-co-border px-4 py-3">
        <h2 id={headingId} className="sr-only">{t("nav.goto.heading")}</h2>
        <label htmlFor={`${headingId}-q`} className="sr-only">{t("nav.goto.search_label")}</label>
        <input
          ref={searchRef}
          id={`${headingId}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="go"
          autoComplete="off"
          placeholder={t("nav.goto.search_placeholder")}
          aria-label={t("nav.goto.search_label")}
          aria-describedby={hintId}
          data-co-goto-search=""
          className="
            min-h-[44px] flex-1 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        />
        <button
          type="button"
          onClick={close}
          aria-label={t("nav.goto.close")}
          className="
            inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-co-border-2 text-co-text-muted
            transition hover:border-co-text hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          <CloseIcon />
        </button>
      </div>
      <p id={hintId} className="px-4 pt-2 text-[11px] text-co-text-dim">{t("nav.goto.shortcut_hint")}</p>
      <p aria-live="polite" role="status" className="sr-only">
        {q ? t("nav.goto.results_count", { pages: pages.length, people: model.people ? peopleCount : 0 }) : ""}
      </p>

      <div className="flex-1">
        {q ? (
          <>
            <section aria-labelledby={`${headingId}-pages`} data-co-goto-results="">
              <h3 id={`${headingId}-pages`} className="px-4 pt-3 text-[12px] font-bold uppercase tracking-wide text-co-text-muted">
                {t("nav.goto.results.pages")}
              </h3>
              {pages.length === 0 ? (
                <p className="px-4 py-2 text-sm text-co-text-muted">{t("nav.goto.no_results", { q })}</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {pages.map((e) => <EntryLink key={e.id} entry={e} onNavigate={close} jobLabel={t("nav.goto.job")} />)}
                </ul>
              )}
            </section>
            {model.people ? <PeopleResults query={q} onNavigate={close} onCount={setPeopleCount} /> : null}
          </>
        ) : (
          <div data-co-goto-rooms="">
            {model.rooms.map((room) => (
              <section key={room.room} aria-labelledby={`${headingId}-${room.room}`} data-co-goto-room={room.room}>
                <h3 id={`${headingId}-${room.room}`} className="px-4 pt-4 text-[12px] font-bold uppercase tracking-wide text-co-text-muted">
                  {room.name}
                </h3>
                {room.entries.length > 0 ? (
                  <ul className="m-0 list-none p-0">
                    {room.entries.map((e) => <EntryLink key={e.id} entry={e} onNavigate={close} jobLabel={t("nav.goto.job")} />)}
                  </ul>
                ) : null}
                {room.groups.map((g) => (
                  <div key={g.id} data-co-goto-group={g.id}>
                    <h4 className="px-4 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{g.name}</h4>
                    <ul className="m-0 list-none p-0">
                      {g.entries.map((e) => <EntryLink key={e.id} entry={e} onNavigate={close} jobLabel={t("nav.goto.job")} />)}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>

      <MeControls {...me} />
    </Sheet>
  );
}

function EntryLink({ entry, onNavigate, jobLabel }: { entry: GoToEntry; onNavigate: () => void; jobLabel: string }) {
  return (
    <li>
      <Link
        href={entry.href}
        prefetch={false}
        onClick={onNavigate}
        data-co-goto-entry={entry.id}
        className="
          flex min-h-[44px] items-center justify-between gap-3 px-4 py-1 text-sm font-semibold text-co-text transition
          hover:bg-co-surface-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        "
      >
        <span className="flex flex-col">
          <span>{entry.name}</span>
          {entry.description ? <span className="text-xs font-normal text-co-text-dim">{entry.description}</span> : null}
        </span>
        {entry.kind === "job" ? <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{jobLabel}</span> : null}
      </Link>
    </li>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}
