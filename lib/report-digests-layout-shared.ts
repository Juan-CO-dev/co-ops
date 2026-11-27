/**
 * The digest LAYOUT rule: one pure function for every section of every digest. Zero I/O.
 *
 * THE ORDER IS THE POINT: cut → count → sort → cap.
 *   1. CUT. A line may carry `needs: <capability>`. Lines the recipient may not see are removed first.
 *      Nothing says a line was removed. A section's PRESENCE is decided from the lines that are LEFT: a
 *      section with no allowed line does not exist (null), exactly as if its hidden lines had never been
 *      composed. A draft that never had a line is the same case, so an email with a hidden line is
 *      byte-identical to the email without it (no heading, no link, nothing).
 *   2. COUNT. The section's status and its issue / unknown / to-do counts (which feed the preheader) are
 *      computed from the lines that are LEFT, before anything is truncated. So a hidden line can never move a
 *      count, and a folded line can never be missing from one.
 *   3. SORT (stable). Issues first, then unknown lines, then `attention` lines (a to-do: an order to ring in,
 *      a late order, someone still on the clock), then routine lines. Inside a tier the composer's order holds.
 *   4. CAP. Issue lines are NEVER capped (plan §2.3). Every other line counts against the cap: at most `cap`
 *      print (5; labor and sales 6) in the sorted order, so an unknown or a to-do is never folded behind a
 *      routine line; the others fold into ONE "and N more" line that names them and carries the section
 *      link. N counts only lines this recipient may see (the cut already ran).
 *
 * FOUR STATUSES: issue (`!`), unknown (`?`), to do (`→`), ok (`✓`). A line whose read failed, whose source is
 * missing, or that says something could not be checked is `unknown: true`; a section with an unknown line and
 * no issue is NEVER "All good". A section with a to-do and no issue / unknown reads "N to do", never "All
 * good". Unknown is never zero.
 *
 * The digest's INTRO lines go through the same cut (`finishIntro`), and are counted after it.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import type { DigestCapability } from "@/lib/report-digests-access-shared";
import type { DigestLine, DigestSection, DigestSectionStatus } from "@/lib/report-digests-compose";

export const SECTION_CAP = 5;
/** Labor and sales carry one more line. */
export const SECTION_CAP_WIDE = 6;
/** Names or items listed inside one line before "+N" (plan §2.6; the house `names()` limit). */
export const LINE_ITEMS_MAX = 5;

type Tr = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A composed section before the rule runs. `live` (the section link opens a live screen) passes through unchanged. */
export interface SectionDraft { title: string; lines: DigestLine[]; href?: string | null; live?: boolean; cap?: number }

export interface FinishCtx {
  t: Tr;
  /** May THIS recipient see this capability's data for the section's shop and day? (digestCan, bound.) */
  can: (capability: DigestCapability) => boolean;
}

export interface DigestCounts { issues: number; unknowns: number; todos: number }

const isIssue = (l: DigestLine) => l.tone === "issue";
const isUnknown = (l: DigestLine) => l.unknown === true;
const isTodo = (l: DigestLine) => l.tone === "attention";

/**
 * At most `max` items, then " +N" (plan §2.6). The one rule for every list inside a line.
 */
export function capItems(items: readonly string[], max = LINE_ITEMS_MAX): string {
  return items.slice(0, max).join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}

/** The cut: the lines this recipient may see, in the composer's order. */
export function cutLines(lines: readonly DigestLine[], can: FinishCtx["can"]): DigestLine[] {
  return lines.filter((l) => l.needs === undefined || can(l.needs));
}

/**
 * The digest's intro lines, cut like any other line. A kept line has its `needs` cleared (it has been decided
 * for this recipient); `renderDigest` and `digestCounts` drop an intro line that still carries `needs`, so an
 * intro that skipped this function fails closed.
 */
export function finishIntro(lines: readonly DigestLine[], ctx: Pick<FinishCtx, "can">): DigestLine[] {
  return cutLines(lines, ctx.can).map((l) => {
    const kept = { ...l };
    delete kept.needs;
    return kept;
  });
}

/** Intro lines that went through `finishIntro` (an unfinished gated line is never shown or counted). */
export function finishedIntro(lines: readonly DigestLine[]): DigestLine[] {
  return lines.filter((l) => l.needs === undefined);
}

/** Issues, unknowns and to-dos among lines the recipient was ALREADY cut to. A line can be issue AND unknown. */
export function lineCounts(lines: readonly DigestLine[]): DigestCounts {
  return { issues: lines.filter(isIssue).length, unknowns: lines.filter(isUnknown).length, todos: lines.filter(isTodo).length };
}

/** The totals of finished sections (plus any finished intro lines): what the preheader is chosen from. */
export function digestCounts(sections: readonly DigestSection[], intro: readonly DigestLine[] = []): DigestCounts {
  const base = lineCounts(finishedIntro(intro));
  return sections.reduce<DigestCounts>((acc, s) => {
    const own = s.status ?? lineCounts(s.lines);
    return { issues: acc.issues + own.issues, unknowns: acc.unknowns + own.unknowns, todos: acc.todos + own.todos };
  }, base);
}

const plural = (t: Tr, n: number, one: TranslationKey, other: TranslationKey) => n === 1 ? t(one) : t(other, { n });

/** The status of a set of (already cut) lines. No line at all = no status: silence is never "All good". */
export function sectionStatus(lines: readonly DigestLine[], t: Tr): DigestSectionStatus | undefined {
  if (lines.length === 0) return undefined;
  const { issues, unknowns, todos } = lineCounts(lines);
  const parts = [
    issues > 0 ? plural(t, issues, "digest.status.issues_one", "digest.status.issues_other") : null,
    unknowns > 0 ? plural(t, unknowns, "digest.status.unknown_one", "digest.status.unknown_other") : null,
    todos > 0 ? plural(t, todos, "digest.status.todo_one", "digest.status.todo_other") : null,
  ].filter((x): x is string => x !== null);
  return {
    tone: issues > 0 ? "issue" : unknowns > 0 ? "unknown" : todos > 0 ? "todo" : "ok",
    text: parts.length > 0 ? parts.join(" · ") : t("digest.status.ok"),
    issues, unknowns, todos,
  };
}

/** The sort tier of a line: issue 0, unknown 1, to-do 2, routine 3. */
function tier(l: DigestLine): number {
  return isIssue(l) ? 0 : isUnknown(l) ? 1 : isTodo(l) ? 2 : 3;
}

/** Stable priority sort: issues, unknowns, to-dos, routine; the composer's order inside a tier. */
export function prioritize(lines: readonly DigestLine[]): DigestLine[] {
  return lines.map((l, i) => ({ l, i })).sort((a, b) => tier(a.l) - tier(b.l) || a.i - b.i).map((x) => x.l);
}

/**
 * The "and N more" text: every folded line is accounted for. Repeated labels are grouped ("Inventory for today
 * ×3"), at most 5 groups are named, and "+M" counts the folded LINES not named, so the names always add up to N.
 */
function moreText(folded: readonly DigestLine[]): string {
  const groups: Array<{ label: string; n: number }> = [];
  for (const l of folded) {
    const g = groups.find((x) => x.label === l.label);
    if (g) g.n += 1; else groups.push({ label: l.label, n: 1 });
  }
  const shown = groups.slice(0, LINE_ITEMS_MAX);
  const rest = folded.length - shown.reduce((a, g) => a + g.n, 0);
  return shown.map((g) => g.n > 1 ? `${g.label} ×${g.n}` : g.label).join(", ") + (rest > 0 ? ` +${rest}` : "");
}

/** cut → count → sort → cap. null = no line is left for this recipient (the section does not exist). */
export function finishSection(draft: SectionDraft, ctx: FinishCtx): DigestSection | null {
  // 1. Cut. Presence is decided from the ALLOWED lines alone.
  const allowed = cutLines(draft.lines, ctx.can);
  if (allowed.length === 0) return null;
  // 2. Count (before any truncation).
  const status = sectionStatus(allowed, ctx.t);
  // 3. Sort, then 4. cap: issues always print; every other line counts against the cap.
  const cap = draft.cap ?? SECTION_CAP;
  const kept: DigestLine[] = [];
  const folded: DigestLine[] = [];
  let capped = 0;
  for (const l of prioritize(allowed)) {
    if (isIssue(l)) { kept.push(l); continue; }
    if (capped < cap) { kept.push(l); capped += 1; } else folded.push(l);
  }
  if (folded.length > 0) {
    kept.push({
      label: plural(ctx.t, folded.length, "digest.section.more_one", "digest.section.more_other"),
      text: moreText(folded),
      tone: "info", href: draft.href ?? null,
    });
  }
  return { title: draft.title, lines: kept, href: draft.href, ...(draft.live ? { live: true } : {}), ...(status ? { status } : {}) };
}

/** finishSection over a list, dropping the sections that do not exist for this recipient. */
export function finishSections(drafts: readonly SectionDraft[], ctx: FinishCtx): DigestSection[] {
  return drafts.map((d) => finishSection(d, ctx)).filter((s): s is DigestSection => s !== null);
}
