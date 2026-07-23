/**
 * Pure Toast-crosswalk matcher (read-track 1). CLIENT-SAFE: zero I/O, no server
 * imports — fully unit-testable (tests/toast-matcher.test.ts).
 *
 * Scoring contract (spec 2026-07-23-toast-menu-crosswalk-design §Matcher):
 *   - normalized exact name = 1.0
 *   - else token-set Jaccard (0..1) + 0.15 bonus when both prices present and
 *     within 5% of each other (sum capped at 0.99 so only exact names hit 1.0)
 *   - candidates require score >= 0.8
 *   - greedy best-first pairing: each CO entity and each Toast item appears in
 *     at most ONE candidate; ties broken by normalized name, then guid, then
 *     entity id (deterministic under input reordering)
 * The matcher only has to be GOOD — the admin confirm queue is the authority.
 */

export interface CoEntity {
  kind: "menu_item" | "item";
  id: string;
  name: string;
  priceCents: number | null;
}
export interface ToastItem {
  itemGuid: string;
  name: string;
  priceCents: number | null;
  groupName: string | null;
}
export interface MatchCandidate {
  entity: CoEntity;
  toast: ToastItem;
  score: number;
}

export const MATCH_THRESHOLD = 0.8;
const PRICE_BONUS = 0.15;
const PRICE_TOLERANCE = 0.05;
const NON_EXACT_CAP = 0.99;

/** Lowercase, strip diacritics + punctuation, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function pricesAgree(a: number | null, b: number | null): boolean {
  if (a == null || b == null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= PRICE_TOLERANCE;
}

function scorePair(entity: CoEntity, toast: ToastItem): number {
  const ne = normalizeName(entity.name);
  const nt = normalizeName(toast.name);
  if (ne.length === 0 || nt.length === 0) return 0;
  if (ne === nt) return 1.0;
  let s = jaccard(tokens(ne), tokens(nt));
  if (pricesAgree(entity.priceCents, toast.priceCents)) s += PRICE_BONUS;
  return Math.min(s, NON_EXACT_CAP);
}

export function matchCandidates(entities: CoEntity[], toastItems: ToastItem[]): MatchCandidate[] {
  const scored: MatchCandidate[] = [];
  for (const entity of entities) {
    for (const toast of toastItems) {
      const score = scorePair(entity, toast);
      if (score >= MATCH_THRESHOLD) scored.push({ entity, toast, score });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const an = normalizeName(a.toast.name), bn = normalizeName(b.toast.name);
    if (an !== bn) return an < bn ? -1 : 1;
    if (a.toast.itemGuid !== b.toast.itemGuid) return a.toast.itemGuid < b.toast.itemGuid ? -1 : 1;
    return a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0;
  });
  const usedEntity = new Set<string>();
  const usedToast = new Set<string>();
  const out: MatchCandidate[] = [];
  for (const c of scored) {
    if (usedEntity.has(c.entity.id) || usedToast.has(c.toast.itemGuid)) continue;
    usedEntity.add(c.entity.id);
    usedToast.add(c.toast.itemGuid);
    out.push(c);
  }
  return out;
}
