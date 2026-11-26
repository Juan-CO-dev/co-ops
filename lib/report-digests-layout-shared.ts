/**
 * The digest LAYOUT rule: one pure function for every section of every digest. Zero I/O.
 *
 * THE ORDER IS THE POINT: cut → count → cap.
 *   1. CUT. A line may carry `needs: <capability>`. Lines the recipient may not see are removed first.
 *      Nothing says a line was removed; a section left with no line at all is dropped (null).
 *   2. COUNT. The section's status and its issue / unknown counts (which feed the preheader) are computed
 *      from the lines that are LEFT, before anything is truncated. So a hidden line can never move a
 *      count, and a truncated line can never be missing from one.
 *   3. CAP. Issue lines and unknown lines are NEVER capped. Of the rest at most `cap` print (5; labor and
 *      sales 6); the others fold into ONE "and N more" line that names them and carries the section link.
 *      N counts only lines this recipient may see (the cut already ran).
 *
 * THREE STATUSES, not two: issue (`!`), unknown (`?`), ok (`✓`). A line whose read failed, whose source is
 * missing or that was "not assessed" is `unknown: true`; a section with an unknown line and no issue is
 * NEVER "All good". Unknown is never zero.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import type { DigestCapability } from "@/lib/report-digests-access-shared";
import type { DigestLine, DigestSection, DigestSectionStatus } from "@/lib/report-digests-compose";

export const SECTION_CAP = 5;
/** Labor and sales carry one more line. */
export const SECTION_CAP_WIDE = 6;
/** Names listed inside the "and N more" line before "+N" (the house `names()` limit). */
const MORE_NAMES_MAX = 5;

type Tr = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** A composed section before the rule runs. */
export interface SectionDraft { title: string; lines: DigestLine[]; href?: string | null; cap?: number }

export interface FinishCtx {
  t: Tr;
  /** May THIS recipient see this capability's data for the section's shop and day? (digestCan, bound.) */
  can: (capability: DigestCapability) => boolean;
}

export interface DigestCounts { issues: number; unknowns: number }

const isIssue = (l: DigestLine) => l.tone === "issue";
const isUnknown = (l: DigestLine) => l.unknown === true;

/** Issues and unknowns among lines the recipient was ALREADY cut to. A line can be both. */
export function lineCounts(lines: readonly DigestLine[]): DigestCounts {
  return { issues: lines.filter(isIssue).length, unknowns: lines.filter(isUnknown).length };
}

/** The totals of finished sections (plus any intro lines): what the preheader is chosen from. */
export function digestCounts(sections: readonly DigestSection[], intro: readonly DigestLine[] = []): DigestCounts {
  const base = lineCounts(intro);
  return sections.reduce<DigestCounts>((acc, s) => ({
    issues: acc.issues + (s.status?.issues ?? lineCounts(s.lines).issues),
    unknowns: acc.unknowns + (s.status?.unknowns ?? lineCounts(s.lines).unknowns),
  }), base);
}

const plural = (t: Tr, n: number, one: TranslationKey, other: TranslationKey) => n === 1 ? t(one) : t(other, { n });

/** The status of a set of (already cut) lines. No line at all = no status: silence is never "All good". */
export function sectionStatus(lines: readonly DigestLine[], t: Tr): DigestSectionStatus | undefined {
  if (lines.length === 0) return undefined;
  const { issues, unknowns } = lineCounts(lines);
  const parts = [
    issues > 0 ? plural(t, issues, "digest.status.issues_one", "digest.status.issues_other") : null,
    unknowns > 0 ? plural(t, unknowns, "digest.status.unknown_one", "digest.status.unknown_other") : null,
  ].filter((x): x is string => x !== null);
  return {
    tone: issues > 0 ? "issue" : unknowns > 0 ? "unknown" : "ok",
    text: parts.length > 0 ? parts.join(" · ") : t("digest.status.ok"),
    issues, unknowns,
  };
}

/** cut → count → cap. null = every line was cut (the section does not exist for this recipient). */
export function finishSection(draft: SectionDraft, ctx: FinishCtx): DigestSection | null {
  // 1. Cut.
  const allowed = draft.lines.filter((l) => l.needs === undefined || ctx.can(l.needs));
  if (allowed.length === 0 && draft.lines.length > 0) return null;
  // 2. Count (before any truncation).
  const status = sectionStatus(allowed, ctx.t);
  // 3. Cap: issues and unknowns always print; the rest keep their order up to the cap.
  const cap = draft.cap ?? SECTION_CAP;
  const kept: DigestLine[] = [];
  const folded: DigestLine[] = [];
  let plain = 0;
  for (const l of allowed) {
    if (isIssue(l) || isUnknown(l)) { kept.push(l); continue; }
    if (plain < cap) { kept.push(l); plain += 1; } else folded.push(l);
  }
  if (folded.length > 0) {
    const labels = [...new Set(folded.map((l) => l.label))];
    kept.push({
      label: plural(ctx.t, folded.length, "digest.section.more_one", "digest.section.more_other"),
      text: labels.slice(0, MORE_NAMES_MAX).join(", ") + (labels.length > MORE_NAMES_MAX ? ` +${labels.length - MORE_NAMES_MAX}` : ""),
      tone: "info", href: draft.href ?? null,
    });
  }
  return { title: draft.title, lines: kept, href: draft.href, ...(status ? { status } : {}) };
}

/** finishSection over a list, dropping the sections that do not exist for this recipient. */
export function finishSections(drafts: readonly SectionDraft[], ctx: FinishCtx): DigestSection[] {
  return drafts.map((d) => finishSection(d, ctx)).filter((s): s is DigestSection => s !== null);
}
