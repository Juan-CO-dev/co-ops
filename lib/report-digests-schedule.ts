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
 *   3. The deadline belongs to the WINDOW (`from|to`, plan §11.1.4): 6 s from its FIRST ask, HERE, before its first
 *      mirror read (S10): one AbortController, one `deadlineAt` (on the run's clock), one timer and one client per
 *      window; every read is ALSO raced against the timer, so a transport that ignores the signal still settles
 *      (`deadline`). A second window gets its own 6 s, so the worst case added to a run is 6 s per window. Work a
 *      later ask joins while its window is open is awaited only until that window's ORIGINAL deadline. A later ask
 *      of a window whose deadline has passed gets NO fresh time: when the shop links, `whoami` and that window's page
 *      are all already settled it is answered at once from them, with no I/O and no wait (so shop B asking the same
 *      window 30 s after shop A, the real serial order of a run, gets its roster); if anything it needs is not
 *      settled it is `deadline` at once.
 *   4. The shop links, read ONCE per run for EVERY shop by the first ask (inside that ask's window): one read of the
 *      live links (`location_id` → the 7shifts location) and one read of those locations' companies. A shop absent
 *      from the result is `shop_not_linked`; more than one live link for a shop, or an id that is not a canonical
 *      real id, refuses THAT shop (`mirror_read_failed`); a read error refuses every shop. A links read that ended by
 *      its window's deadline is NOT kept (a later window may read again inside its own 6 s); anything else is kept.
 *   5. `whoami`, ONCE per run (S7, AGENTS.md "One company per token"): exactly one canonical company, equal to the
 *      linked location's. Otherwise `company_unverified` and NO shift request is sent. A failure is kept for the run.
 *   6. ONE page of the documented default listing per company and window (never a cursor), through the bounded,
 *      source-checked read (S6, A2-3), then the pure `checkPublishedAnswer`. Every shop shares that one promise; a
 *      failure is kept for the run.
 *   7. First names (structured fields only, never `last_name`, never a CO-OPS display name) and role names from the
 *      mirror, in ordered batches of at most 100 ids, memoized for the run per verified company (plan §2.2): a page
 *      asks only for ids not yet resolved. A user row of ANOTHER company is a contradiction (`mirror_conflict`): the
 *      company and window are refused. A user id with no row is "no name on file". A failed read is
 *      `mirror_read_failed` (never an "unnamed" roster) and is never cached.
 *
 * MIRROR IDS ARE TEXT at the database boundary (`::text` in every select list): a 16 – 18 digit bigint does not fit a
 * JavaScript number, so an id that arrives as a number is unverifiable and refused, never converted. Filters send
 * canonical strings.
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

/** One logical read (a window): its mirror reads, `whoami` when it has not been asked yet, the page and its retry. */
export const SCHEDULE_WINDOW_MS = 6_000;
/** The bounded read's ceiling for `whoami` (its `users` array is walked). */
export const SCHEDULE_WHOAMI_MAX_BYTES = 64 * 1024;
/** The ceiling for the one shift page (200 rows at about 10 KB each). */
export const SCHEDULE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Name, role and location lookups: at most this many ids per mirror read. */
export const SCHEDULE_ID_BATCH = 100;

/**
 * The columns the reader selects (exported so the PGlite test runs these exact lists against the real schema). Every
 * bigint id is cast to TEXT (F5): PostgREST answers it as a string, so a 16 – 18 digit id never becomes a JS number.
 */
export const SCHEDULE_LINK_COLUMNS = "location_id, sevenshifts_location_id::text";
export const SCHEDULE_LOCATION_COLUMNS = "id::text, company_id::text";
/** Structured first-name fields ONLY: never `last_name` (finding S3). `company_id` proves the row is the company's (F3). */
export const SCHEDULE_USER_COLUMNS = "id::text, company_id::text, first_name, preferred_first_name";
export const SCHEDULE_ROLE_COLUMNS = "id::text, name";

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

/**
 * A mirror id as its canonical string; null when it is not provably a real id. The selects cast every id to text, so
 * an id arrives as a string; a NUMBER is unverifiable (a large bigint may already have been rounded) and is refused (F5).
 */
function mirrorId(v: unknown): string | null {
  return typeof v === "string" && REAL_ID.test(v) ? v : null;
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
/** Every shop's live link, read once per run: shop id → its link, or the refusal for THAT shop. */
type LinkMap = ReadonlyMap<string, Link | Fail>;
type Page = { shifts: PublishedShift[]; names: ScheduleNames };
const DEADLINE: Fail = { fail: "deadline" };
const isFail = (v: unknown): v is Fail => typeof v === "object" && v !== null && "fail" in v;

/** A memoized promise whose answer can be read synchronously once it has settled (step 3's no-wait reuse). */
interface Settled<T> { p: Promise<T>; done: boolean; value: T | undefined }
function track<T>(p: Promise<T>): Settled<T> {
  const s: Settled<T> = { p, done: false, value: undefined };
  void p.then((v) => { s.done = true; s.value = v; });
  return s;
}

/**
 * One WINDOW (`from|to`): its signal, deadline, client and timer, made by its FIRST ask. Every later ask of the window
 * shares them: nobody gets fresh time (plan §11.1.4).
 */
interface WindowCtx {
  key: string;
  signal: AbortSignal;
  deadlineAt: number;
  client: SevenShiftsClient;
  /** The window as asked (whoami is asked with the first window's, as the sync asks it with its own). */
  window: SyncWindow;
  gte: string;
  lte: string;
  /** Settles (to DEADLINE) when the window's 6 s are up, whether or not a transport honours the signal. */
  expired: Promise<Fail>;
  /** The window's 6 s are spent (or its signal fired). */
  over(): boolean;
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

/** ONE per digest run. Memoizes by shop + window, the links once, whoami once, a page per company + window. Never throws. */
export function createScheduleReader(sb: ServiceRoleClient, deps: ScheduleReaderDeps = {}): ScheduleReader {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? (() => Date.now());
  const counter = deps.counter ?? { requests: 0 };
  // S10: ONE limiter for the run, on the same clock `deadlineAt` is read on; shared by whoami, every page, every retry.
  const limiter: Limiter = createLimiter({ ...SEVENSHIFTS_LIMITS, now: clock });
  const from = (table: string) => (sb as unknown as { from(t: string): Query }).from(table);

  /** `windowInstants` ONCE per window key: the same two strings feed the request and the check (§15.1.2). */
  const instants = new Map<string, { window: SyncWindow; gte: string; lte: string }>();
  const windows = new Map<string, WindowCtx>();
  const shopMemo = new Map<string, Promise<Loaded<ShopSchedule>>>();
  const pageMemo = new Map<string, Settled<Page | Fail>>();
  let links: Settled<LinkMap | Fail> | null = null;
  let whoami: Settled<string[] | Fail> | null = null;
  /** Step 7, run-level, per verified company (F7): user id → first name (null = no row / no name), role id → name. */
  const nameCache = new Map<string, { users: Map<string, string | null>; roles: Map<string, string | null> }>();

  /** The window's context: made by its FIRST ask, before that ask's first mirror read; shared by every later ask. */
  function windowCtx(token: string, key: string, inst: { window: SyncWindow; gte: string; lte: string }): WindowCtx {
    const have = windows.get(key);
    if (have) return have;
    const controller = new AbortController();
    const deadlineAt = clock() + SCHEDULE_WINDOW_MS;
    let fire: (f: Fail) => void = () => {};
    const expired = new Promise<Fail>((resolve) => { fire = resolve; });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = 0;
    const expire = () => { timer = null; controller.abort(); fire(DEADLINE); };
    const ctx: WindowCtx = {
      key,
      signal: controller.signal,
      deadlineAt,
      window: inst.window, gte: inst.gte, lte: inst.lte, expired,
      // The token goes to the client factory and nowhere else.
      client: createSevenShiftsClient({
        token, limiter, signal: controller.signal, counter, fetch: deps.fetch, now: clock, deadlineAt,
        maxResponseBytes: SCHEDULE_WHOAMI_MAX_BYTES,
      }),
      over: () => controller.signal.aborted || clock() >= deadlineAt,
      // The timer runs only while something of this window is in flight, so an idle run holds no timer.
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
    windows.set(key, ctx);
    return ctx;
  }

  /** `work` raced against the window's deadline; a throw is a fixed code, never the error itself. */
  async function within<T>(ctx: WindowCtx, work: () => Promise<T | Fail>, onThrow: string): Promise<T | Fail> {
    ctx.enter();
    try {
      if (ctx.signal.aborted) return DEADLINE;
      const run = (async () => { try { return await work(); } catch { return { fail: ctx.signal.aborted ? "deadline" : onThrow }; } })();
      return await Promise.race([run, ctx.expired]);
    } finally {
      ctx.leave();
    }
  }

  /** Step 4's two reads, for every shop at once. */
  async function readLinks(ctx: WindowCtx): Promise<LinkMap | Fail> {
    const live = await from("sevenshifts_location_links").select(SCHEDULE_LINK_COLUMNS).eq("active", true).abortSignal(ctx.signal);
    if (live.error || !Array.isArray(live.data)) return { fail: "mirror_read_failed" };
    const byShop = new Map<string, Array<string | null>>();
    for (const row of live.data as Array<Record<string, unknown>>) {
      const shop = row.location_id;
      // A row that names no shop cannot be attributed: nothing is provable for any shop.
      if (typeof shop !== "string" || shop === "") return { fail: "mirror_read_failed" };
      const list = byShop.get(shop) ?? [];
      list.push(mirrorId(row.sevenshifts_location_id));
      byShop.set(shop, list);
    }
    const out = new Map<string, Link | Fail>();
    const wanted = new Map<string, string>(); // shop → its one 7shifts location
    for (const [shop, ids] of byShop) {
      // One live link per shop is a unique index; anything else is not provably this shop's location.
      const only = ids.length === 1 ? ids[0] ?? null : null;
      if (only === null) out.set(shop, { fail: "mirror_read_failed" });
      else wanted.set(shop, only);
    }
    const locIds = [...new Set(wanted.values())].sort(idCompare);
    const company = new Map<string, string | null>(); // 7shifts location → its company (null = refused)
    for (let i = 0; i < locIds.length; i += SCHEDULE_ID_BATCH) {
      const batch = locIds.slice(i, i + SCHEDULE_ID_BATCH);
      const locs = await from("sevenshifts_locations").select(SCHEDULE_LOCATION_COLUMNS)
        .in("id", batch).order("id").abortSignal(ctx.signal);
      if (locs.error || !Array.isArray(locs.data)) return { fail: "mirror_read_failed" };
      const asked = new Set(batch);
      for (const row of locs.data as Array<Record<string, unknown>>) {
        const id = mirrorId(row.id);
        // A row whose own id cannot be proved cannot be attributed to a link: refuse every shop.
        if (id === null || !asked.has(id)) return { fail: "mirror_read_failed" };
        const c = mirrorId(row.company_id);
        // Two rows for one location (a primary key) is not provable either.
        company.set(id, company.has(id) ? null : c);
      }
    }
    for (const [shop, loc] of wanted) {
      if (!company.has(loc)) { out.set(shop, { fail: "shop_not_linked" }); continue; }
      const c = company.get(loc) ?? null;
      out.set(shop, c === null ? { fail: "mirror_read_failed" } : { sevenShiftsLocationId: loc, companyId: c });
    }
    return out;
  }

  /** Step 4: the links ONCE per run. A read ended by its window's deadline is dropped so a later window may read again. */
  function linksOnce(ctx: WindowCtx): Promise<LinkMap | Fail> {
    if (links) return links.p;
    const p: Promise<LinkMap | Fail> = within<LinkMap>(ctx, () => readLinks(ctx), "mirror_read_failed").then((r) => {
      // Dropped BEFORE any awaiter resumes, so a joiner with time left can start its own read.
      if (isFail(r) && r.fail === "deadline" && links?.p === p) links = null;
      return r;
    });
    links = track(p);
    return p;
  }

  /** Step 5: whoami ONCE per run, under the window that started it. Any failure (its deadline too) is kept for the run. */
  function whoamiOnce(ctx: WindowCtx): Promise<string[] | Fail> {
    whoami ??= track(within<string[]>(ctx, async () => {
      const who = await ctx.client.get("whoami", { companyId: null, window: ctx.window });
      if (who.kind !== "snapshot") return { fail: "company_unverified" };
      const ids = (who.value as { companyIds?: unknown }).companyIds;
      if (!Array.isArray(ids) || !ids.every((i): i is string => typeof i === "string")) return { fail: "company_unverified" };
      return ids;
    }, "company_unverified"));
    return whoami.p;
  }

  /**
   * Step 7: names and roles for the ids on an accepted page, in ordered batches of at most 100, asking the mirror only
   * for ids not yet resolved in this run for this company (F7). A user row of another company refuses (F3).
   */
  async function namesFor(shifts: readonly PublishedShift[], companyId: string, ctx: WindowCtx): Promise<ScheduleNames | Fail> {
    let cache = nameCache.get(companyId);
    if (!cache) { cache = { users: new Map(), roles: new Map() }; nameCache.set(companyId, cache); }
    const userIds = [...new Set(shifts.flatMap((s) => (s.userId === null ? [] : [s.userId])))].sort(idCompare);
    const roleIds = [...new Set(shifts.flatMap((s) => (s.roleId === null ? [] : [s.roleId])))].sort(idCompare);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    const newUsers = userIds.filter((id) => !cache.users.has(id));
    for (let i = 0; i < newUsers.length; i += SCHEDULE_ID_BATCH) {
      const batch = newUsers.slice(i, i + SCHEDULE_ID_BATCH);
      const r = await from("sevenshifts_users").select(SCHEDULE_USER_COLUMNS)
        .in("id", batch).order("id").abortSignal(ctx.signal);
      if (r.error || !Array.isArray(r.data)) return { fail: "mirror_read_failed" };
      const asked = new Set(batch);
      const found = new Map<string, string | null>();
      for (const row of r.data as Array<Record<string, unknown>>) {
        const id = mirrorId(row.id);
        const company = mirrorId(row.company_id);
        if (id === null || company === null || !asked.has(id) || found.has(id)) return { fail: "mirror_read_failed" };
        // F3: a person of ANOTHER company never supplies a printed name: a known contradiction refuses the window.
        if (company !== companyId) return { fail: "mirror_conflict" };
        found.set(id, structuredFirstName({ first_name: str(row.first_name), preferred_first_name: str(row.preferred_first_name) }));
      }
      // Cached only once the whole batch is proved; an id with no row is "no name on file".
      for (const id of batch) cache.users.set(id, found.get(id) ?? null);
    }
    const newRoles = roleIds.filter((id) => !cache.roles.has(id));
    for (let i = 0; i < newRoles.length; i += SCHEDULE_ID_BATCH) {
      const batch = newRoles.slice(i, i + SCHEDULE_ID_BATCH);
      const r = await from("sevenshifts_roles").select(SCHEDULE_ROLE_COLUMNS)
        .in("id", batch).order("id").abortSignal(ctx.signal);
      if (r.error || !Array.isArray(r.data)) return { fail: "mirror_read_failed" };
      const asked = new Set(batch);
      const found = new Map<string, string | null>();
      for (const row of r.data as Array<Record<string, unknown>>) {
        const id = mirrorId(row.id);
        if (id === null || !asked.has(id) || found.has(id)) return { fail: "mirror_read_failed" };
        found.set(id, str(row.name));
      }
      for (const id of batch) cache.roles.set(id, found.get(id) ?? null);
    }
    const firstNames = new Map<string, string | null>(userIds.map((id) => [id, cache.users.get(id) ?? null]));
    const roleNames = new Map<string, string | null>(roleIds.map((id) => [id, cache.roles.get(id) ?? null]));
    return { firstNames, roleNames };
  }

  /**
   * Step 6 + 7: the ONE page per company and window, checked, with its names, fetched under its window's deadline.
   * Every shop shares this promise; a failure (the deadline too) is kept for the run.
   */
  function pageFor(companyId: string, ctx: WindowCtx): Promise<Page | Fail> {
    const key = `${companyId}|${ctx.key}`;
    const have = pageMemo.get(key);
    if (have) return have.p;
    const s = track(within<Page>(ctx, async () => {
      let json: unknown;
      try {
        json = await ctx.client.getOnePage({ companyId, startGte: ctx.gte, startLte: ctx.lte }, { maxBytes: SCHEDULE_PAGE_MAX_BYTES });
      } catch {
        return { fail: ctx.signal.aborted ? "deadline" : "request_failed" };
      }
      // §15.1.2: the very strings sent as start[gte] / start[lte].
      const answer = checkPublishedAnswer(json, { limit: LIST_PAGE_LIMIT, companyId, startGte: ctx.gte, startLte: ctx.lte });
      if (!answer.ok) return { fail: "answer_refused" };
      const names = await namesFor(answer.shifts, companyId, ctx);
      if (isFail(names)) return names;
      return { shifts: answer.shifts, names };
    }, "request_failed"));
    pageMemo.set(key, s);
    return s.p;
  }

  /** The shop's link out of the run's map. */
  function linkOf(map: LinkMap, locationId: string): Link | Fail {
    return map.get(locationId) ?? { fail: "shop_not_linked" };
  }

  /** S7 / A2-3: exactly one company, canonical, and the linked location's (compared as canonical strings). */
  function verified(who: string[] | Fail, link: Link): Fail | null {
    if (isFail(who)) return { fail: "company_unverified" };
    if (who.length !== 1 || !REAL_ID.test(who[0]!) || who[0] !== link.companyId) return { fail: "company_unverified" };
    return null;
  }

  /**
   * Step 3's no-wait answer for a window whose deadline has passed: only what is ALREADY settled, no I/O, no fresh
   * time. Anything not settled is `deadline`.
   */
  function fromSettled(locationId: string, ctx: WindowCtx, days: string[]): ShopSchedule | Fail {
    if (!links?.done || links.value === undefined) return DEADLINE;
    if (isFail(links.value)) return links.value;
    const link = linkOf(links.value, locationId);
    if (isFail(link)) return link;
    if (!whoami?.done || whoami.value === undefined) return DEADLINE;
    const bad = verified(whoami.value, link);
    if (bad) return bad;
    const page = pageMemo.get(`${link.companyId}|${ctx.key}`);
    if (!page?.done || page.value === undefined) return DEADLINE;
    if (isFail(page.value)) return page.value;
    return publishedRoster(page.value.shifts, link.sevenShiftsLocationId, days, page.value.names);
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
    const days = etDays(fromDay, toDay);
    // 3: the WINDOW's 6 s start at its first ask, here, before its first mirror read (S10).
    const c = windowCtx(token, windowKey, inst);
    const r = c.over()
      ? fromSettled(locationId, c, days)
      : await within<ShopSchedule>(c, async () => {
        let map = await linksOnce(c);
        // A links read another window started ran out of THAT window's time: read again inside this one's.
        if (isFail(map) && map.fail === "deadline" && !c.over()) map = await linksOnce(c);
        if (isFail(map)) return map;
        const link = linkOf(map, locationId);
        if (isFail(link)) return link;
        const bad = verified(await whoamiOnce(c), link);
        if (bad) return bad;
        const page = await pageFor(link.companyId, c);
        if (isFail(page)) return page;
        return publishedRoster(page.shifts, link.sevenShiftsLocationId, days, page.names);
      }, "unexpected");
    if (isFail(r)) {
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
