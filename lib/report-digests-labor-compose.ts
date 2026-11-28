/**
 * Digest LABOR MONEY lines F1–F5 (digests round 3, PR 4; plan §3.3 as amended by §11.2): the finished-span labor
 * money of the shop digest and of each shop of the unified digest, in the Labor section. PURE: facts in, lines out.
 *
 * THE TWO WAYS THIS FAILS, AND WHY IT CANNOT HERE:
 *   1. A money group a recipient may not see. Every line carries ONE `needs` (F1–F3 `labor_hourly`, F4
 *      `labor_loaded`, F5 `labor_cost_by_role`) and `finishSection` cuts it BEFORE anything is counted. This module
 *      never asks a role, a level, a setting or a shop.
 *   2. A count moved by a hidden line. A line's tone and `unknown` mark travel with the line, so a cut line takes its
 *      issue, its `?` and its place in "and N more" with it. The lines are composed from the sealed store alone,
 *      independently of today's Toast state (a failed pull for D leaves every money line as it is).
 *
 * FIGURES ARE NEVER FORMATTED HERE (plan §3.6): every number is a `Figure` from lib/report-digests-labor-view.ts and is
 * printed ONLY through `figureText(figure, figureFormatFor(language), { short: true })`, which carries its state ("so
 * far", a dash with its reason) and its qualifications. Dates go through `formatDateLabel`. This file is a surface of
 * tests/business-report-figure-census.test.ts.
 *
 * FAILURES ARE ISOLATED BY PART (L7): each of F1 / F2 / F3 is judged from its OWN part, so one failed span never
 * moves another line. One wording per failure: "Labor cost not available" (an hourly part), "Cost by role not
 * available" (the role part), "Labor figures are updating" (a week that is not usable). No hourly entry at all = ONE
 * "not available" line for the hourly lines and one for fully loaded (and F5's own sentence), nothing else.
 */
import { figureKindOf, figureText, type Figure } from "@/lib/business-figure-shared";
import { figureFormatFor } from "@/lib/business-figure-format";
import type { LaborView } from "@/lib/business-view-shared";
import { formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { DigestLine, DigestTone } from "@/lib/report-digests-compose";
import type { DigestCapability } from "@/lib/report-digests-access-shared";
import type { LaborMoneyStore, LaborTarget } from "@/lib/report-digests-labor-shared";
import { laborMoneyView, type LaborSpanView, type RoleBucketView, type SpanPartView } from "@/lib/report-digests-labor-view";
import { digestLink, type DigestTarget, type LinkViewer } from "@/lib/report-digests-links";

type Tr = (key: TranslationKey, params?: Record<string, string | number>) => string;
export interface LaborMoneyCtx { language: Language; baseUrl: string; locationId: string; day: string; viewer?: LinkViewer | null }

/** The F1–F5 lines, each already in its own slot of the Labor section (lib/report-digests-v2-compose.ts places them). */
export interface LaborMoneyLines { f1: DigestLine; f2: DigestLine | null; f3: DigestLine | null; f4: DigestLine; f5: DigestLine | null }

const HOURLY: DigestCapability = "labor_hourly";
const LOADED: DigestCapability = "labor_loaded";
const ROLES: DigestCapability = "labor_cost_by_role";

/**
 * A figure that is not whole (a dash, or "so far") makes its line UNKNOWN: unknown is never zero, never "All good". A
 * figure that is not there at all (Fable F8) is unknown too.
 */
const notWhole = (f: Figure | undefined) => { if (f === undefined) return true; const k = figureKindOf(f); return k === "unknown" || k === "incomplete"; };

function targetWords(t: Tr, target: LaborTarget, kind: "pure" | "loaded"): string {
  // The business report's own wording (components/reports-business/BusinessParts.tsx): a target is configuration.
  return target === "target_varies" ? t("reports.business.target_varies") : t(kind === "pure" ? "reports.business.target" : "reports.business.target_le", { pct: target });
}

/**
 * F1 / F3's tone: `issue` when the PURE HOURLY tone is over target (`watch` / `high`, lib/scheduling/board-shared.ts
 * laborTone); a span whose weeks have different targets prints no tone at all.
 */
function overTarget(span: LaborSpanView): boolean {
  if (span.target === "target_varies") return false;
  return span.labor.pureTone === "watch" || span.labor.pureTone === "high";
}

/**
 * The pieces every line prints, each through figureText. The view holds both money groups, so a figure is always
 * there; if one ever is not (Fable F8), the piece says the part's own "not available" sentence and its line is
 * unknown (`notWhole`), never a hand-written dash.
 */
function pieces(c: { t: Tr; fmt: ReturnType<typeof figureFormatFor> }, l: LaborView) {
  const missing = () => c.t("digest.labor_money.not_available");
  const say = (f: Figure | undefined) => (f === undefined ? missing() : figureText(f, c.fmt, { short: true }));
  return {
    say,
    hours: () => c.t("digest.labor_money.hours", { hours: say(l.hours) }),
    pct: (f: Figure | undefined, target: LaborTarget, kind: "pure" | "loaded") =>
      f === undefined ? missing() : figureText(f, c.fmt, { short: true, wrap: (v) => c.t("digest.labor_money.pct_of_net", { pct: v, target: targetWords(c.t, target, kind) }) }),
    overtime: () => c.t("digest.labor_money.overtime", { hours: say(l.otHours), premium: say(l.otPremium) }),
  };
}

/**
 * THE labor-money lines of one shop and day. `store` absent or null = not a labor-money run: null, and the caller
 * composes NOTHING (the switch-off byte identity). Every line is composed whatever the recipient may see; the cut is
 * `finishSection`'s.
 */
export function laborMoneyLines(ctx: LaborMoneyCtx, store: LaborMoneyStore | null | undefined): LaborMoneyLines | null {
  if (!store) return null;
  const t: Tr = (key, params) => serverT(ctx.language, key, params);
  const fmt = figureFormatFor(ctx.language);
  const date = (d: string) => formatDateLabel(d, ctx.language);
  const team: DigestTarget = { to: "team", location: ctx.locationId, day: ctx.day };
  /** A finished span's business report (F5 opens its People tab), else Team, else no link. */
  const href = (span: { from: string; to: string } | null, tab?: "people") => digestLink({ baseUrl: ctx.baseUrl, viewer: ctx.viewer },
    ...(span ? [{ to: "business" as const, location: ctx.locationId, from: span.from, through: span.to, ...(tab ? { tab } : {}) }] : []), team);
  const line = (needs: DigestCapability, label: string, text: string, o: { tone?: DigestTone; unknown?: boolean; span?: { from: string; to: string } | null; tab?: "people" } = {}): DigestLine =>
    ({ label, text, tone: o.tone ?? "info", href: href(o.span ?? null, o.tab), needs, ...(o.unknown ? { unknown: true } : {}) });
  /** A part that is not `ok`: its one sentence, unknown. */
  const sentence = (p: { kind: "unavailable" | "updating" }, updating: TranslationKey = "digest.labor_money.updating") =>
    t(p.kind === "updating" ? updating : "digest.labor_money.not_available");

  const view = laborMoneyView(store.hourly(ctx.locationId, ctx.day), store.roles(ctx.locationId, ctx.day));
  const rolesLabel = t("digest.labor_money.roles_label_plain");
  const rolesNotAvailable = line(ROLES, rolesLabel, t("digest.labor_money.roles_not_available"), { unknown: true });

  // No hourly entry (never loaded, cut, or the pre-load did not run): ONE line per capability, nothing else.
  if (view.hourly === null) {
    return {
      f1: line(HOURLY, t("digest.labor_money.label"), t("digest.labor_money.not_available"), { unknown: true }),
      f2: null, f3: null,
      f4: line(LOADED, t("reports.business.card.fully_loaded"), t("digest.labor_money.not_available"), { unknown: true }),
      f5: rolesNotAvailable,
    };
  }
  const h = view.hourly;

  // F1: the latest final day (its own date names how fresh the figures are).
  const day = h.latestFinalDay;
  let f1: DigestLine;
  if (day.kind === "none") f1 = line(HOURLY, t("digest.labor_money.latest_label_plain"), t("digest.labor_money.no_final_day"), { unknown: true });
  else if (day.kind !== "ok") f1 = line(HOURLY, t("digest.labor_money.latest_label_plain"), sentence(day), { unknown: true });
  else {
    const s = day.span, l = s.labor, p = pieces({ t, fmt }, l);
    const shown = [l.pureCost, l.purePct, l.otHours, l.otPremium];
    f1 = line(HOURLY, t("digest.labor_money.latest_label", { date: date(s.to) }),
      [p.say(l.pureCost), p.pct(l.purePct, s.target, "pure"), p.overtime()].join(" · "),
      { tone: overTarget(s) ? "issue" : "info", unknown: shown.some(notWhole), span: s });
  }

  // F2: the payroll week so far (Sunday → the latest final day). Never an issue.
  const wk = h.weekSoFar;
  let f2: DigestLine;
  if (wk.kind === "no_final_day_this_week") f2 = line(HOURLY, t("digest.labor_money.week_so_far_label_plain"), t("digest.labor_money.no_final_day_this_week"));
  else if (wk.kind !== "ok") f2 = line(HOURLY, t("digest.labor_money.week_so_far_label_plain"), sentence(wk, "digest.labor_money.week_updating"), { unknown: true });
  else {
    const s = wk.span, l = s.labor, p = pieces({ t, fmt }, l);
    const shown = [l.hours, l.pureCost, l.purePct, l.otHours, l.otPremium];
    f2 = line(HOURLY, t("digest.labor_money.week_so_far_label", { from: date(s.from), to: date(s.to) }),
      [p.hours(), p.say(l.pureCost), p.pct(l.purePct, s.target, "pure"), p.overtime()].join(" · "), { unknown: shown.some(notWhole), span: s });
  }

  // F3: the last full payroll week before D's.
  const last = h.lastFullWeek;
  let f3: DigestLine;
  if (last.kind !== "ok") f3 = line(HOURLY, t("digest.labor_money.last_week_label_plain"), sentence(last), { unknown: true });
  else {
    const s = last.span, l = s.labor, p = pieces({ t, fmt }, l);
    const shown = [l.purePct, l.otHours, l.otPremium];
    f3 = line(HOURLY, t("digest.labor_money.last_week_label", { from: date(s.from), to: date(s.to) }),
      [p.pct(l.purePct, s.target, "pure"), p.overtime()].join(" · "),
      { tone: overTarget(s) ? "issue" : "info", unknown: shown.some(notWhole), span: s });
  }

  // F4: fully loaded — the latest final day's $ and % (its own target) · the last full week's %. A part that is not
  // `ok` is said with its own sentence; both parts with no figure = ONE "not available" line. Never an issue.
  const loadedLabel = t("reports.business.card.fully_loaded");
  const partText = (p: SpanPartView | { kind: "none" }, what: string, ok: (s: LaborSpanView) => string): { text: string; figures: Array<Figure | undefined>; span: LaborSpanView | null } => {
    if (p.kind === "ok") {
      const l = p.span.labor;
      return { text: ok(p.span), figures: [l.loadedCost, l.loadedPct], span: p.span };
    }
    const why = p.kind === "none" ? t("digest.labor_money.no_final_day") : sentence(p);
    return { text: t("digest.labor_money.part", { what, sentence: why }), figures: [], span: null };
  };
  const dayPart = partText(day, t("digest.labor_money.latest_label_plain"), (s) => {
    const p = pieces({ t, fmt }, s.labor);
    return t("digest.labor_money.loaded_day", { date: date(s.to), cost: p.say(s.labor.loadedCost), pct: p.pct(s.labor.loadedPct, s.loadedTarget, "loaded") });
  });
  const weekPart = partText(last, t("digest.labor_money.last_week_label_plain"), (s) =>
    t("digest.labor_money.loaded_week", { pct: pieces({ t, fmt }, s.labor).pct(s.labor.loadedPct, s.loadedTarget, "loaded") }));
  const f4 = dayPart.span === null && weekPart.span === null && day.kind === "unavailable" && last.kind === "unavailable"
    ? line(LOADED, loadedLabel, t("digest.labor_money.not_available"), { unknown: true })
    : line(LOADED, loadedLabel, [dayPart.text, weekPart.text].join(" · "), {
      unknown: dayPart.span === null || weekPart.span === null || [...dayPart.figures, ...weekPart.figures].some(notWhole),
      span: dayPart.span ?? weekPart.span,
    });

  // F5: cost by role of the latest final day (straight time, before overtime). It stands on F1's day. Opus R-2 (plan
  // §11.2.2): a day part that is `updating` (its week is not usable) or `none` (no final day) has NO F5 line at all.
  // A day part `unavailable`, no role entry, or a role read that did not finish = "Cost by role not available".
  // Fewer than two buckets = no line.
  const roles = view.roles;
  let f5: DigestLine | null;
  if (day.kind === "updating" || day.kind === "none") f5 = null;
  else if (day.kind !== "ok" || roles === null || roles.kind === "unavailable" || (roles.kind === "ok" && roles.date !== day.span.to)) f5 = rolesNotAvailable;
  else if (roles.kind === "omitted") f5 = null;
  else {
    const name = (b: RoleBucketView) => (b.kind === "role" && b.name ? b.name : t(b.kind === "pool" ? "digest.labor_money.role_pool" : "digest.labor_money.role_other"));
    const items = roles.buckets.map((b) => t("digest.labor_money.role_item", { name: name(b), cost: figureText(b.amount, fmt, { short: true }) })).join(", ");
    const notes = [
      roles.roundedSeparately ? t("digest.labor_money.roles_rounded") : null,
      // The day row's own estimated-rate flag (Opus R-2), in the business report's own words.
      roles.wageEstimated ? t("reports.business.qual.wage_estimated") : null,
    ].filter((x): x is string => x !== null);
    f5 = line(ROLES, t("digest.labor_money.roles_label", { date: date(roles.date) }), notes.length > 0 ? `${items} (${notes.join("; ")})` : items,
      { unknown: roles.buckets.some((b) => notWhole(b.amount)), span: { from: roles.date, to: roles.date }, tab: "people" });
  }

  return { f1, f2, f3, f4, f5 };
}
