"use client";

/**
 * Go to's people results (nav PR 9, plan r2 3.1, 4.4). Loaded ONLY on a query: nothing at render, nothing below 2
 * characters, then one request after 250 ms of quiet. One request in flight (the previous one aborted), each under
 * `withDeadline(10_000)`; a response is applied only when it answers the LATEST query. States: idle (nothing drawn),
 * loading, results (name + translated role, a link to the profile), "more match, keep typing", none, error (a 503, a
 * network failure or a timeout: "Couldn't load people right now.", never "No one matches."). A 403
 * `people_search_refused` (a viewer demoted since the page loaded) removes the section and reloads the navigation model.
 * Rendered only when the model offers people search.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { withDeadline } from "@/lib/bounded-fetch";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";

export const PEOPLE_DEBOUNCE_MS = 250;
export const PEOPLE_MIN_CHARS = 2;
export const PEOPLE_TIMEOUT_MS = 10_000;

interface Person { userId: string; name: string; role: RoleCode }
type State =
  | { kind: "loading" }
  | { kind: "results"; people: Person[]; hasMore: boolean }
  | { kind: "error" }
  | { kind: "refused" };

export function PeopleResults({ query, onNavigate, onCount }: {
  query: string;
  onNavigate: () => void;
  /** The number of people shown (for the live region). */
  onCount?: (n: number) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  // Read through a ref: the effect below runs per QUERY, never because a router object was re-created.
  const routerRef = useRef(router);
  useEffect(() => { routerRef.current = router; }, [router]);
  // The last settled answer and the query it answers; anything else for the current query reads "loading".
  const [answer, setAnswer] = useState<{ q: string; state: State } | null>(null);
  const [refused, setRefused] = useState(false);
  const latest = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (refused) return;
    const seq = ++latest.current;
    inflight.current?.abort();
    inflight.current = null;
    if (q.length < PEOPLE_MIN_CHARS) return;
    const timer = setTimeout(() => {
      const controller = new AbortController();
      inflight.current = controller;
      void (async () => {
        let next: State;
        try {
          next = await withDeadline(PEOPLE_TIMEOUT_MS, async (signal) => {
            // One signal for the request: the deadline's abort reaches the in-flight controller a newer query aborts.
            signal.addEventListener("abort", () => controller.abort(), { once: true });
            const res = await fetch(`/api/nav/people?q=${encodeURIComponent(q)}`, { redirect: "manual", signal: controller.signal });
            if (res.status === 403) {
              let code: string | undefined;
              try { code = ((await res.json()) as { code?: string }).code; } catch { /* no body */ }
              return code === "people_search_refused" ? { kind: "refused" as const } : { kind: "error" as const };
            }
            if (!res.ok) return { kind: "error" as const };
            const body = (await res.json()) as { people: Person[]; hasMore: boolean };
            return { kind: "results" as const, people: body.people, hasMore: body.hasMore };
          });
        } catch {
          next = { kind: "error" };
        }
        if (seq !== latest.current) return; // an older query's answer (or one after unmount): dropped
        if (next.kind === "refused") {
          setRefused(true);
          routerRef.current.refresh();
          return;
        }
        setAnswer({ q, state: next });
      })();
    }, PEOPLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, refused]);

  // Abort anything in flight on unmount.
  useEffect(() => () => { latest.current++; inflight.current?.abort(); }, []);

  // idle (nothing drawn) below 2 characters or once refused; "loading" until this query's answer settles.
  const state: State | null = refused || q.length < PEOPLE_MIN_CHARS ? null : answer?.q === q ? answer.state : { kind: "loading" };
  const shown = state?.kind === "results" ? state.people.length : 0;
  useEffect(() => { onCount?.(shown); }, [shown, onCount]);

  if (state === null || state.kind === "refused") return null;
  return (
    <section aria-labelledby="co-nav-people-heading" data-co-people="">
      <h3 id="co-nav-people-heading" className="px-4 pt-3 text-[12px] font-bold uppercase tracking-wide text-co-text-muted">
        {t("nav.goto.results.people")}
      </h3>
      {state.kind === "loading" ? <p className="px-4 py-2 text-sm text-co-text-muted">{t("nav.goto.people_loading")}</p> : null}
      {state.kind === "error" ? <p role="alert" className="px-4 py-2 text-sm text-co-cta-text">{t("nav.goto.people_error")}</p> : null}
      {state.kind === "results" && state.people.length === 0 ? <p className="px-4 py-2 text-sm text-co-text-muted">{t("nav.goto.people_none")}</p> : null}
      {state.kind === "results" && state.people.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {state.people.map((p) => (
            <li key={p.userId}>
              <Link
                href={`/profile/${encodeURIComponent(p.userId)}`}
                prefetch={false}
                onClick={onNavigate}
                className="flex min-h-[44px] items-center justify-between gap-3 px-4 text-sm text-co-text transition hover:bg-co-surface-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                <span className="font-semibold">{p.name}</span>
                <span className="text-xs text-co-text-dim">{t(`role.${p.role}` as TranslationKey)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {state.kind === "results" && state.hasMore ? <p className="px-4 py-2 text-xs text-co-text-muted">{t("nav.goto.people_more")}</p> : null}
    </section>
  );
}
