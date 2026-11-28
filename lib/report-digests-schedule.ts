/**
 * THE DIGEST'S SCHEDULE READER — SERVER-ONLY, READ-ONLY, GET ONLY, NEVER THROWS (digest PR 2, plan §2.2, §11.1.4,
 * §11.1.5, §13.1.2 – §13.1.4, §15.1.2; CC addendum A2-3).
 *
 * The ONE reader a digest run uses to learn a shop's PUBLISHED schedule from 7shifts at send time. It decides whether
 * staff first names and shift times are emailed, so it FAILS CLOSED: anything it cannot prove is "not available",
 * never a partial roster and never "no one scheduled".
 *
 * Nothing is read from `sevenshifts_shifts`: the mirror cannot prove what is published NOW (a shift taken back to
 * draft keeps its old row there for good, plan §2.2).
 *
 * One reader per run (`createScheduleReader`), in this order per shop and window:
 *   1. 7shifts not ready (no token, or the switch off) → `seven_not_ready`, nothing read, nothing sent.
 *   2. `windowInstants` ONCE per window; the SAME `{ gte, lte }` goes to the request and to the check (§15.1.2).
 *   3. Each ASK (a shop and a window) has its own 6 s from its start, HERE, before its first mirror read (S10): its
 *      own AbortController, `deadlineAt` (on the run's clock), timer and client; every read is ALSO raced against
 *      the timer, so a transport that ignores the signal still settles (`deadline`). The one page per company and
 *      window and the one whoami per run are fetched ONCE, under the ask that started them; a later ask awaits the
 *      same promise (settled or in flight) raced against ITS OWN 6 s. A page or whoami that failed, by its
 *      starter's deadline too, stays failed for the run: the same answer for every shop, no retry.
 *   4. The shop's live link → its 7shifts location → that location's company (mirror; memoized per shop).
 *   5. `whoami`, ONCE per run (S7, AGENTS.md "One company per token"): exactly one canonical company, equal to the
 *      linked location's. Otherwise `company_unverified` and NO shift request is sent. A failure is kept for the run.
 *   6. ONE page of the documented default listing per company and window (never a cursor), through the bounded,
 *      source-checked read (S6, A2-3), then the pure `checkPublishedAnswer`. Both shops share that one promise.
 *   7. First names (structured fields only, never `last_name`, never a CO-OPS display name) and role names from the
 *      mirror, in ordered batches of at most 100 ids. A failed read is `mirror_read_failed`, not an "unnamed" roster.
 *
 * THE TOKEN comes from `sevenShiftsToken(env)` and is handed ONLY to the client factory: never logged, returned or
 * put in an error. Logs are fixed codes only (`[digests] schedule: <code>`), never a value from an answer or a name.
 */
import "server-only";
import { createSevenShiftsClient, type SevenShiftsClient, type SevenShiftsFetch } from "@/lib/sevenshifts/client";
import { sevenShiftsStatus, sevenShiftsToken } from "@/lib/sevenshifts/config";
import { LIST_PAGE_LIMIT, windowInstants, type SyncWindow } from "@/lib/sevenshifts/endpoints-shared";
import { createLimiter, SEVENSHIFTS_LIMITS, type Limiter } from "@/lib/sevenshifts/rate-limit-shared";
import { etYmdMinusDays } from "@/lib/operational-day";
import { calendarDay } from "@/lib/sevenshifts/normalize-shared";
import type { getServiceRoleClient } from "@/lib/supabase-server";
import { failed, ok, unavailable, type Loaded } from "@/lib/report-digests-v2-shared";
import {
  checkPublishedAnswer, publishedRoster, structuredFirstName,
  type PublishedShift, type ScheduleNames, type ScheduleReader, type ShopSchedule,
} from "@/lib/report-digests-schedule-shared";

/** One logical read (a window): the mirror reads, `whoami` when it has not been asked yet, the page and its retry. */
export const SCHEDULE_WINDOW_MS = 6_000;
/** The bounded read's ceiling for `whoami` (its `users` array is walked). */
export const SCHEDULE_WHOAMI_MAX_BYTES = 64 * 1024;
/** The ceiling for the one shift page (200 rows at about 10 KB each). */
export const SCHEDULE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Name and role lookups: at most this many ids per mirror read. */
export const SCHEDULE_ID_BATCH = 100;

/** The columns the reader selects (exported so the PGlite test runs these exact lists against the real schema). */
export const SCHEDULE_LINK_COLUMNS = "sevenshifts_location_id";
export const SCHEDULE_LOCATION_COLUMNS = "id, company_id";
/** Structured first-name fields ONLY: never `last_name` (finding S3). */
export const SCHEDULE_USER_COLUMNS = "id, first_name, preferred_first_name";
export const SCHEDULE_ROLE_COLUMNS = "id, name";

export type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

export interface ScheduleReaderDeps {
  /** Default process.env; read ONLY through lib/sevenshifts/config.ts. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Tests inject a fake. */
  fetch?: SevenShiftsFetch;
  /** Default Date.now: the limiter, `deadlineAt` and the race all run on it (S10). */
  clock?: () => number;
  /** Tests read the HTTP request count. */
  counter?: { requests: number };
}

/** A real 7shifts id in its one canonical spelling (A2-3): a nonzero digit and up to 17 more. */
const REAL_ID = /^[1-9]\d{0,17}$/;

/** A mirror bigint (a number or a string, by driver) as its canonical string; null when it is not a real id. */
function mirrorId(v: unknown): string | null {
  if (typeof v === "number" && !Number.isSafeInteger(v)) return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const s = String(v);
  return REAL_ID.test(s) ? s : null;
}

/** Canonical digit strings: shorter is smaller, then lexical (numeric order, locale-free). */
function idCompare(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Every ET day from `from` to `to`, both included (the window already passed `windowInstants`). */
function etDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = etYmdMinusDays(d, -1)) days.push(d);
  return days;
}

function logCode(code: string): void {
  // A fixed code only: never a value from an answer, a name or the token.
  console.error(`[digests] schedule: ${code}`);
}

type Fail = { fail: string };
type Link = { sevenShiftsLocationId: string; companyId: string };
type Page = { shifts: PublishedShift[]; names: ScheduleNames };
const DEADLINE: Fail = { fail: "deadline" };

/**
 * One ASK (a shop and a window): its own signal, deadline, client and timer. The deadline belongs to the ask, never to
 * the window key: the engine loads shops one after the other (a Toast pull in between can take 20 s), so a window's
 * second shop asks long after its first, and must get its own 6 s to reuse the memoized page and whoami.
 */
interface AskCtx {
  signal: AbortSignal;
  deadlineAt: number;
  client: SevenShiftsClient;
  /** The window as asked (whoami is asked with the first window's, as the sync asks it with its own). */
  window: SyncWindow;
  gte: string;
  lte: string;
  /** Settles (to DEADLINE) when the ask's 6 s are up, whether or not a transport honours the signal. */
  expired: Promise<Fail>;
  enter(): void;
  leave(): void;
}

/** A query builder as far as this reader uses it (the service-role client's shape). */
interface Query extends PromiseLike<{ data: unknown; error: unknown }> {
  select(cols: string): Query;
  eq(col: string, v: unknown): Query;
  in(col: string, v: readonly unknown[]): Query;
  order(col: string): Query;
  abortSignal(s: AbortSignal): Query;
}

/** ONE per digest run. Memoizes by shop, by company + window, and whoami once. Never throws. */
export function createScheduleReader(sb: ServiceRoleClient, deps: ScheduleReaderDeps = {}): ScheduleReader {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => Date.now());
  const counter = deps.counter ?? { requests: 0 };
  // S10: ONE limiter for the run, on the same clock `deadlineAt` is read on; shared by whoami, every page, every retry.
  const limiter: Limiter = createLimiter({ ...SEVENSHIFTS_LIMITS, now: clock });
  const from = (table: string) => (sb as unknown as { from(t: string): Query }).from(table);

  /** `windowInstants` ONCE per window key: the same two strings feed the request and the check (§15.1.2). */
  const instants = new Map<string, { window: SyncWindow; gte: string; lte: string }>();
  const shopMemo = new Map<string, Promise<Loaded<ShopSchedule>>>();
  const linkMemo = new Map<string, Promise<Link | Fail>>();
  const pageMemo = new Map<string, Promise<Page | Fail>>();
  let whoami: Promise<string[] | Fail> | null = null;

  /** A NEW ask context: called once per `shopWindow` ask that is not memoized, before its first mirror read. */
  function askCtx(token: string, window: SyncWindow, gte: string, lte: string): AskCtx {
    const controller = new AbortController();
    const deadlineAt = clock() + SCHEDULE_WINDOW_MS;
    let fire: (f: Fail) => void = () => {};
    const expired = new Promise<Fail>((resolve) => { fire = resolve; });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = 0;
    const expire = () => { timer = null; controller.abort(); fire(DEADLINE); };
    const ctx: AskCtx = {
      signal: controller.signal,
      deadlineAt,
      window, gte, lte, expired,
      // The token goes to the client factory and nowhere else.
      client: createSevenShiftsClient({
        token, limiter, signal: controller.signal, counter, fetch: deps.fetch, now: clock, deadlineAt,
        maxResponseBytes: SCHEDULE_WHOAMI_MAX_BYTES,
      }),
      // The timer runs only while something of this ask is in flight, so an idle run holds no timer.
      enter() {
        pending += 1;
        if (controller.signal.aborted || timer !== null) return;
        const left = deadlineAt - clock();
        if (left <= 0) expire();
        else timer = setTimeout(expire, left);
      },
      leave() {
        pending -= 1;
        if (pending <= 0 && timer !== null) { clearTimeout(timer); timer = null; }
      },
    };
    return ctx;
  }

  /** `work` raced against the ask's deadline; a throw is a fixed code, never the error itself. */
  async function within<T>(ctx: AskCtx, work: () => Promise<T | Fail>, onThrow: string): Promise<T | Fail> {
    ctx.enter();
    try {
      if (ctx.signal.aborted) return DEADLINE;
      const run = (async () => { try { return await work(); } catch { return { fail: ctx.signal.aborted ? "deadline" : onThrow }; } })();
      return await Promise.race([run, ctx.expired]);
    } finally {
      ctx.leave();
    }
  }

  /** Step 4: the shop's LIVE link → its 7shifts location → that location's company. Memoized per shop. */
  function linkFor(locationId: string, ctx: AskCtx): Promise<Link | Fail> {
    const have = linkMemo.get(locationId);
    if (have) return have;
    const p = within<Link>(ctx, async () => {
      const links = await from("sevenshifts_location_links").select(SCHEDULE_LINK_COLUMNS)
        .eq("location_id", locationId).eq("active", true).abortSignal(ctx.signal);
      if (links.error || !Array.isArray(links.data)) return { fail: "mirror_read_failed" };
      if (links.data.length === 0) return { fail: "shop_not_linked" };
      // One live link per shop is a unique index; anything else is not provably this shop's location.
      if (links.data.length !== 1) return { fail: "mirror_read_failed" };
      const sevenShiftsLocationId = mirrorId((links.data[0] as Record<string, unknown>).sevenshifts_location_id);
      if (sevenShiftsLocationId === null) return { fail: "mirror_read_failed" };
      const locs = await from("sevenshifts_locations").select(SCHEDULE_LOCATION_COLUMNS)
        .eq("id", sevenShiftsLocationId).abortSignal(ctx.signal);
      if (locs.error || !Array.isArray(locs.data)) return { fail: "mirror_read_failed" };
      if (locs.data.length === 0) return { fail: "shop_not_linked" };
      if (locs.data.length !== 1) return { fail: "mirror_read_failed" };
      const companyId = mirrorId((locs.data[0] as Record<string, unknown>).company_id);
      if (companyId === null) return { fail: "mirror_read_failed" };
      return { sevenShiftsLocationId, companyId };
    }, "mirror_read_failed");
    linkMemo.set(locationId, p);
    // A deadline belongs to the ask that started the lookup; a later ask may look the shop up again with its own 6 s.
    void p.then((r) => { if ("fail" in r && r.fail === "deadline" && linkMemo.get(locationId) === p) linkMemo.delete(locationId); });
    return p;
  }

  /** Step 5: whoami ONCE per run, under the ask that started it. Any failure (its deadline too) is kept for the run. */
  function whoamiOnce(ctx: AskCtx): Promise<string[] | Fail> {
    whoami ??= within<string[]>(ctx, async () => {
      const who = await ctx.client.get("whoami", { companyId: null, window: ctx.window });
      if (who.kind !== "snapshot") return { fail: "company_unverified" };
      const ids = (who.value as { companyIds?: unknown }).companyIds;
      if (!Array.isArray(ids) || !ids.every((i): i is string => typeof i === "string")) return { fail: "company_unverified" };
      return ids;
    }, "company_unverified");
    return whoami;
  }

  /** Step 7: names and roles for the ids on an accepted page, in ordered batches of at most 100. */
  async function namesFor(shifts: readonly PublishedShift[], ctx: AskCtx): Promise<ScheduleNames | Fail> {
    const userIds = [...new Set(shifts.flatMap((s) => (s.userId === null ? [] : [s.userId])))].sort(idCompare);
    const roleIds = [...new Set(shifts.flatMap((s) => (s.roleId === null ? [] : [s.roleId])))].sort(idCompare);
    const firstNames = new Map<string, string | null>();
    const roleNames = new Map<string, string | null>();
    for (let i = 0; i < userIds.length; i += SCHEDULE_ID_BATCH) {
      const r = await from("sevenshifts_users").select(SCHEDULE_USER_COLUMNS)
        .in("id", userIds.slice(i, i + SCHEDULE_ID_BATCH)).order("id").abortSignal(ctx.signal);
      if (r.error || !Array.isArray(r.data)) return { fail: "mirror_read_failed" };
      for (const row of r.data as Array<Record<string, unknown>>) {
        const id = mirrorId(row.id);
        if (id === null) return { fail: "mirror_read_failed" };
        const str = (v: unknown) => (typeof v === "string" ? v : null);
        firstNames.set(id, structuredFirstName({ first_name: str(row.first_name), preferred_first_name: str(row.preferred_first_name) }));
      }
    }
    for (let i = 0; i < roleIds.length; i += SCHEDULE_ID_BATCH) {
      const r = await from("sevenshifts_roles").select(SCHEDULE_ROLE_COLUMNS)
        .in("id", roleIds.slice(i, i + SCHEDULE_ID_BATCH)).order("id").abortSignal(ctx.signal);
      if (r.error || !Array.isArray(r.data)) return { fail: "mirror_read_failed" };
      for (const row of r.data as Array<Record<string, unknown>>) {
        const id = mirrorId(row.id);
        if (id === null) return { fail: "mirror_read_failed" };
        roleNames.set(id, typeof row.name === "string" ? row.name : null);
      }
    }
    return { firstNames, roleNames };
  }

  /**
   * Step 6 + 7: the ONE page per company and window, checked, with its names, fetched under the ask that started it.
   * Both shops share this promise; a failure (its starter's deadline too) is kept for the run.
   */
  function pageFor(companyId: string, windowKey: string, ctx: AskCtx): Promise<Page | Fail> {
    const key = `${companyId}|${windowKey}`;
    const have = pageMemo.get(key);
    if (have) return have;
    const p = within<Page>(ctx, async () => {
      let json: unknown;
      try {
        json = await ctx.client.getOnePage({ companyId, startGte: ctx.gte, startLte: ctx.lte }, { maxBytes: SCHEDULE_PAGE_MAX_BYTES });
      } catch {
        return { fail: ctx.signal.aborted ? "deadline" : "request_failed" };
      }
      // §15.1.2: the very strings sent as start[gte] / start[lte].
      const answer = checkPublishedAnswer(json, { limit: LIST_PAGE_LIMIT, companyId, startGte: ctx.gte, startLte: ctx.lte });
      if (!answer.ok) return { fail: "answer_refused" };
      const names = await namesFor(answer.shifts, ctx);
      if ("fail" in names) return names;
      return { shifts: answer.shifts, names };
    }, "request_failed");
    pageMemo.set(key, p);
    return p;
  }

  async function read(locationId: string, fromDay: string, toDay: string): Promise<Loaded<ShopSchedule>> {
    // 1
    if (sevenShiftsStatus(env).state !== "ready") return unavailable("seven_not_ready");
    const token = sevenShiftsToken(env);
    if (token === null) return unavailable("seven_not_ready");
    // 2: computed ONCE per window; the same two strings feed the request and the check.
    const windowKey = `${fromDay}|${toDay}`;
    let inst = instants.get(windowKey);
    if (!inst) {
      const w: SyncWindow = { from: fromDay, to: toDay, modifiedSince: null };
      // `windowInstants` lets V8 roll 30 February into March; a window must name real calendar days.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay) || !calendarDay(fromDay) || !calendarDay(toDay)) {
        return unavailable("bad_window");
      }
      let pair: { gte: string; lte: string };
      try { pair = windowInstants(w); } catch { return unavailable("bad_window"); }
      inst = { window: w, gte: pair.gte, lte: pair.lte };
      instants.set(windowKey, inst);
    }
    // 3: THIS ask's 6 s start here, before its first mirror read (S10).
    const c = askCtx(token, inst.window, inst.gte, inst.lte);
    const r = await within<ShopSchedule>(c, async () => {
      const link = await linkFor(locationId, c);
      if ("fail" in link) return link;
      const who = await whoamiOnce(c);
      if ("fail" in who) return { fail: "company_unverified" };
      // S7 / A2-3: exactly one company, canonical, and the linked location's (compared as canonical strings).
      if (who.length !== 1 || !REAL_ID.test(who[0]!) || who[0] !== link.companyId) return { fail: "company_unverified" };
      const page = await pageFor(link.companyId, windowKey, c);
      if ("fail" in page) return page;
      return publishedRoster(page.shifts, link.sevenShiftsLocationId, etDays(fromDay, toDay), page.names);
    }, "unexpected");
    if ("fail" in r) {
      logCode(r.fail);
      return r.fail === "unexpected" ? failed() : unavailable(r.fail);
    }
    return ok(r);
  }

  return {
    shopWindow(locationId: string, fromDay: string, toDay: string): Promise<Loaded<ShopSchedule>> {
      const key = `${locationId}|${fromDay}|${toDay}`;
      const have = shopMemo.get(key);
      if (have) return have;
      let p: Promise<Loaded<ShopSchedule>>;
      try {
        p = read(locationId, fromDay, toDay).catch(() => { logCode("unexpected"); return failed<ShopSchedule>(); });
      } catch {
        p = Promise.resolve(failed<ShopSchedule>());
      }
      shopMemo.set(key, p);
      return p;
    },
  };
}
