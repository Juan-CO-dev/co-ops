/**
 * THE BOARD'S LINE FORMATTER — pure (Scheduling Phase 2, chunk F). The pure modules speak in i18n keys + raw params
 * (cents, quarters, ids, ISO dates, window keys); this turns one line into the reader's language: cents → dollars,
 * clock quarters → times (lib/i18n/format via `formatQ`), a user id → the person's name, a position id → its label,
 * an ISO date → a short date label, a window / scope / day-type key → its own translated label. Counts stay numbers
 * (`coverableQ`, `requiredQ` are counts of quarters, not clock times). Never builds English prose.
 */
import { formatCentsWhole, formatDateLabel } from "@/lib/i18n/format";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import type { NarrativeLine } from "@/lib/people-narrative";
import { formatQ, isYmd } from "./time-shared";

export interface LineContext {
  t: (key: TranslationKey, params?: TranslationParams) => string;
  language: Language;
  names: Readonly<Record<string, string>>;
  positions: Readonly<Record<string, { name: string; nameEs: string | null }>>;
}

/** Clock-time params (quarters of the day). */
const CLOCK_Q = new Set(["q", "fromQ", "toQ", "startQ", "endQ", "atQ", "savedQ", "stationQ", "earliestQ"]);
const DATE_PARAMS = new Set(["date", "from", "to", "referenceWeek", "weekStart"]);

export function positionLabel(ctx: Pick<LineContext, "language" | "positions" | "t">, id: string | null | undefined): string {
  if (!id) return "";
  if (id === "mod") return ctx.t("schedule.board.mod_short");
  const p = ctx.positions[id];
  if (!p) return ctx.t("schedule.board.position_unknown");
  return ctx.language === "es" && p.nameEs ? p.nameEs : p.name;
}

/**
 * CC chunk H9: a segment's label. A MoD-lane segment the person only counts on from a later quarter reads "On the clock · manager
 * on duty from 7:00 PM" (none of it: "On the clock · not manager on duty") — never "Manager on duty" over time that is not.
 */
export function segmentLabel(ctx: Pick<LineContext, "language" | "positions" | "t">, g: { positionId: string; startQ: number; endQ: number; modFromQ?: number | null; crewUnassigned?: boolean }): string {
  if (g.positionId === "mod" && g.crewUnassigned) return ctx.t("schedule.board.crew_unassigned");
  if (g.positionId === "mod" && g.modFromQ !== undefined) {
    return g.modFromQ === null ? ctx.t("schedule.board.mod_not_counted") : ctx.t("schedule.board.mod_from", { time: formatQ(g.modFromQ, ctx.language) });
  }
  return positionLabel(ctx, g.positionId);
}

export function personName(ctx: Pick<LineContext, "names" | "t">, id: string | null | undefined): string {
  if (!id) return "";
  return ctx.names[id] ?? ctx.t("schedule.board.person_unknown");
}

export function formatParams(params: Readonly<Record<string, string | number>> | undefined, ctx: LineContext): TranslationParams {
  const out: TranslationParams = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === "number" && /Cents$/.test(k)) out[k] = formatCentsWhole(v, ctx.language);
    else if (typeof v === "number" && CLOCK_Q.has(k)) out[k] = formatQ(v, ctx.language);
    else if (k === "peopleIds" && typeof v === "string") out.people = (JSON.parse(v) as string[]).map((id) => personName(ctx, id)).join(", ");
    else if (k === "userId" && typeof v === "string") out[k] = personName(ctx, v);
    else if ((k === "positionId" || k === "primaryId") && typeof v === "string") out[k] = positionLabel(ctx, v);
    else if (DATE_PARAMS.has(k) && typeof v === "string" && isYmd(v)) out[k] = formatDateLabel(v, ctx.language);
    else if (k === "window" && typeof v === "string") out[k] = ctx.t(`schedule.board.window.${v}` as TranslationKey);
    else if (k === "scope" && typeof v === "string") out[k] = ctx.t(`schedule.board.scope.${v}` as TranslationKey);
    else if ((k === "from" || k === "to") && typeof v === "string" && ["slow", "normal", "busy", "weekend"].includes(v)) out[k] = ctx.t(`schedule.board.day_type.${v}` as TranslationKey);
    else out[k] = v;
  }
  return out;
}

export function formatLine(line: NarrativeLine, ctx: LineContext): string {
  return ctx.t(line.key as TranslationKey, formatParams(line.params, ctx));
}
