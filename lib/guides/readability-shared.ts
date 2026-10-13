// lib/guides/readability-shared.ts
/**
 * readability — the Guides v2 plain-language line (Juan 2026-10-13: "6th grade reading level").
 *
 * PURE. Flesch-Kincaid grade = 0.39·(words/sentence) + 11.8·(syllables/word) − 15.59.
 * The syllable count is the usual English heuristic (vowel groups, minus a silent final e), which
 * is close enough to hold a line; it is not a linguistics library. Bold UI labels count as one
 * short word ("X"), because a label is read off the screen, not decoded. Headings, photos, tables
 * and code are left out. Only the English is scored; the Spanish is read by a reviewer.
 */

export const SPANISH_HEADING = /^###\s+En español\s*$/im;

export function syllables(word: string): number {
  if (/^[0-9]/.test(word)) return 1;
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 0);
}

function inlinePlain(line: string): string {
  return line
    .replace(/\*\*[^*]+\*\*/g, "X")
    .replace(/`[^`]+`/g, "X")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]([^*_]+)[*_]/g, "$1")
    .trim();
}

const endWithStop = (s: string) => (/[.!?:]$/.test(s) ? s.replace(/:$/, ".") : `${s}.`);

export function plainSentences(markdown: string): string[] {
  const out: string[] = [];
  let paragraph: string[] = [];
  let inCode = false;
  const flush = () => {
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    for (const s of text.split(/(?<=[.!?])\s+/)) if (/[A-Za-z0-9]/.test(s)) out.push(endWithStop(s.trim()));
  };
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) { flush(); inCode = !inCode; continue; }
    if (inCode) continue;
    if (!line || /^#/.test(line) || /^!\[/.test(line) || /^\|/.test(line) || /^-{3,}$/.test(line) || /^<!--/.test(line)) { flush(); continue; }
    const bullet = line.match(/^(?:[-*+]|\d+\.)\s+(.*)$/);
    if (bullet) { flush(); paragraph.push(inlinePlain(bullet[1] ?? "")); flush(); continue; }
    paragraph.push(inlinePlain(line));
  }
  flush();
  return out;
}

export function fkGrade(sentences: string[]): { grade: number; words: number; sentences: number; syllables: number } {
  const words = sentences.flatMap((s) => s.match(/[A-Za-z0-9][A-Za-z0-9'’:-]*/g) ?? []);
  if (words.length === 0 || sentences.length === 0) return { grade: 0, words: 0, sentences: sentences.length, syllables: 0 };
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  return { grade, words: words.length, sentences: sentences.length, syllables: syl };
}

export function englishSections(markdown: string): { heading: string; body: string }[] {
  const parts = markdown.split(/^## /m).slice(1);
  return parts.map((part) => {
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const rest = nl === -1 ? "" : part.slice(nl + 1);
    const es = rest.search(SPANISH_HEADING);
    return { heading, body: es === -1 ? rest : rest.slice(0, es) };
  });
}
