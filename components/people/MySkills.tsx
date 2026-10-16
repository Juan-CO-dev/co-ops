/**
 * "My skills" on /my-feedback (Scheduling Phase 1, Task 17) — the SELF view (R8).
 *
 * The positions the person worked at this shop, each with its band (Strong / Solid / Building; es Fuerte /
 * Sólido / En progreso) and the positive evidence lines only, under "What you've been doing well". No
 * number, no confidence, no needs-work count and no trace of a manager adjustment — the rows come from
 * `toSelfSkillView` (lib/people/skill-matrix-shared.ts), which strips them at the lib boundary, so this
 * component has nothing to leak.
 */
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { SelfSkillRow } from "@/lib/people/skill-matrix-shared";

export function MySkills({ rows, language }: { rows: readonly SelfSkillRow[]; language: Language }) {
  return (
    <section className="mt-6" aria-labelledby="my-skills-title">
      <h2 id="my-skills-title" className="text-base font-bold text-co-text">{serverT(language, "people.skills.self.title")}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-lg border-2 border-co-border bg-co-surface px-3 py-3 text-sm text-co-text">{serverT(language, "people.skills.self.empty")}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-co-text-muted">{serverT(language, "people.skills.self.heading")}</p>
          <ul className="mt-2 grid gap-2">
            {rows.map((r) => (
              <li key={r.positionId} className="rounded-lg border-2 border-co-border bg-co-surface px-3 py-2">
                <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-co-text">{language === "es" && r.nameEs ? r.nameEs : r.name}</span>
                  <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">
                    {serverT(language, `people.skills.band.${r.band}` as TranslationKey)}
                  </span>
                </div>
                {r.lines.length > 0 && (
                  <ul className="grid gap-1 pb-1 text-sm text-co-text">
                    {r.lines.map((l, i) => <li key={i}>{serverT(language, l.key as TranslationKey, l.params)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
