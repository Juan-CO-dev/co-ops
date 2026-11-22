/**
 * GET /api/nav/people?q= — Go to's people search (nav PR 9, plan r2 3.3, 4.4; lead ruling r1 F4).
 *
 * Order: the session (its own path, which is step-up NEUTRAL: a search typed on an admin page neither keeps nor clears
 * the unlock) → the people rule, 403 `people_search_refused` BEFORE any read (the viewer's Go to list holds no
 * `profile`: today the social media manager) → `q` trimmed, 2-64 characters, else 400 with no read → the narrow reads →
 * `{ people: [{ userId, name, role }], hasMore }`, exactly those keys, at most 10 people. Any read error is 503
 * `people_unavailable`, never an empty list. Read-only GET: no same-origin check (it changes nothing).
 */
import { type NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/api-helpers";
import { peopleSearchAllowed } from "@/lib/nav/go-to";
import { PEOPLE_QUERY_MAX, PEOPLE_QUERY_MIN, PeopleSearchRefused, searchPeopleFor } from "@/lib/nav/people-search";
import { navSwitches } from "@/lib/nav-switches";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/nav/people");
  if (ctx instanceof Response) return ctx;

  const switches = navSwitches();
  if (!peopleSearchAllowed(ctx, switches)) {
    const res = jsonError(403, "people_search_refused");
    res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return res;
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < PEOPLE_QUERY_MIN || q.length > PEOPLE_QUERY_MAX) {
    const res = jsonError(400, "invalid_query");
    res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return res;
  }

  try {
    const { people, hasMore } = await searchPeopleFor(getServiceRoleClient(), {
      role: ctx.role, level: ctx.level, locations: ctx.locations, language: ctx.user.language,
    }, switches, q);
    const res = jsonOk({ people: people.map((p) => ({ userId: p.userId, name: p.name, role: p.role })), hasMore });
    res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return res;
  } catch (err) {
    if (err instanceof PeopleSearchRefused) {
      const res = jsonError(403, "people_search_refused");
      res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
      return res;
    }
    console.error("nav people search failed:", err instanceof Error ? err.message : String(err));
    const res = jsonError(503, "people_unavailable");
    res.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return res;
  }
}
