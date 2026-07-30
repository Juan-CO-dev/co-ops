"use client";

/**
 * PrepOverviewPanel — READ-ONLY prep overview + prep Doctor on the closing/opening
 * Template Builder (PR-3/4 of the checklist full-edit arc).
 *
 * Prep evolves in ITS OWN editor (unanimous council ruling — never publish-versioned).
 * This panel is a SUMMARY, not a second editor: ZERO edit affordances — every fix
 * deep-links to the prep editor (/admin/checklist-templates/{subtype}). Prep findings
 * are ADVISORY and are NOT folded into the closing/opening Doctor totals (mirrors how
 * orphanedMirrors stays out of issueCount).
 *
 * Disclosure Doctrine: a default-collapsed CollapsibleSection; the header carries a
 * summary badge; per (location × subtype) block groups lines by section with badge
 * chips (input-type / needs-link / es-missing). Advisory input-type-drift findings
 * render at the top of the same block.
 *
 * Canonical spec: docs/superpowers/specs/2026-07-30-prep-builder-view-design.md
 */

import Link from "next/link";
import { useMemo } from "react";

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import {
  classifyPrepNeedsLink,
  prepEsFill,
  type PrepOverviewLine,
  type PrepOverviewReport,
  type PrepOverviewTemplate,
  type PrepSubtypeKey,
} from "@/lib/admin/prep-overview-shared";
import type { LineInputType } from "@/lib/types";

const tk = (k: string): TranslationKey => k as TranslationKey;

/** The prep-editor deep link for a subtype (the [subtype] route → ChecklistTabs). */
function prepEditorHref(subtype: PrepSubtypeKey): string {
  return `/admin/checklist-templates/${subtype}`;
}

/** Input-type chip label key (each LineInputType has an i18n label). */
function inputTypeKey(t: LineInputType): TranslationKey {
  return tk(`admin.templates.prep.input_type.${t}`);
}

export function PrepOverviewPanel({ overview }: { overview: PrepOverviewReport | null }) {
  const { t } = useTranslation();

  // ADVISORY panel: a null overview = the best-effort load failed (the page
  // logged it) — render nothing rather than take down the builder. Also nothing
  // to show when no prep templates exist at the actor's locations.
  if (overview === null || overview.templates.length === 0) return null;

  const { needsLink, esMissing, inputTypeDrift } = overview.totals;
  const findingCount = needsLink + esMissing + inputTypeDrift;

  const badge =
    findingCount === 0 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-co-success/15 px-2 py-0.5 text-[11px] font-bold text-co-success">
        ✓ {t("admin.templates.prep.all_clear")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold text-co-text">
        {t("admin.templates.prep.advisory_n", { n: String(findingCount) })}
      </span>
    );

  const locName = (id: string): string =>
    overview.templates.find((tpl) => tpl.locationId === id)?.locationName ?? id;

  return (
    <CollapsibleSection
      idBase="tb-prep-overview"
      title={t("admin.templates.prep.title")}
      count={t("admin.templates.prep.managed_elsewhere")}
      badge={badge}
      defaultOpen={false}
    >
      <div className="flex flex-col gap-4">
        {/* Input-type drift across locations — ADVISORY (fixed in the prep editor). */}
        {overview.inputTypeDrift.length > 0 && (
          <div>
            <h3 className="text-xs font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
              {t("admin.templates.prep.drift_heading", { n: String(overview.inputTypeDrift.length) })}
            </h3>
            <p className="mt-1 mb-2 text-xs text-co-text-muted">
              {t("admin.templates.prep.drift_note")}
            </p>
            <ul className="flex flex-col gap-1">
              {overview.inputTypeDrift.map((d, i) => (
                <li
                  key={`${d.subtype}-${d.identityLabel}-${i}`}
                  className="rounded-lg border border-co-border/60 bg-co-surface p-2 text-sm text-co-text"
                >
                  <span className="font-bold">{d.identityLabel}</span>{" "}
                  <span className="text-co-text-muted">
                    ({t(tk(`admin.templates.subtype.${d.subtype}`))})
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2">
                    {d.perLocation.map((p) => (
                      <span
                        key={p.locationId}
                        className="inline-flex items-center gap-1 rounded-full bg-co-gold/15 px-2 py-0.5 text-[11px] font-semibold text-co-text"
                      >
                        {locName(p.locationId)}: {t(inputTypeKey(p.inputType))}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Per (location × subtype) read-only block. */}
        {overview.templates.map((tpl) => (
          <PrepTemplateBlock key={tpl.templateId} tpl={tpl} />
        ))}
      </div>
    </CollapsibleSection>
  );
}

function PrepTemplateBlock({ tpl }: { tpl: PrepOverviewTemplate }) {
  const { t } = useTranslation();
  const needsLink = classifyPrepNeedsLink(tpl);
  const needsLinkIds = useMemo(() => new Set(needsLink.map((n) => n.lineId)), [needsLink]);
  const esFill = prepEsFill(tpl);

  // Group active lines by section, preserving displayOrder within a section.
  const bySection = useMemo(() => {
    const groups = new Map<string, PrepOverviewLine[]>();
    for (const line of tpl.lines) {
      const arr = groups.get(line.section) ?? [];
      arr.push(line);
      groups.set(line.section, arr);
    }
    return [...groups.entries()];
  }, [tpl.lines]);

  return (
    <div className="rounded-lg border border-co-border/60 bg-co-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-co-text">
            {tpl.locationName ?? tpl.locationId}{" "}
            <span className="text-co-text-muted">· {t(tk(`admin.templates.subtype.${tpl.subtype}`))}</span>
          </p>
          <p className="text-xs text-co-text-muted">
            {t("admin.templates.prep.managed_in_editor")} ·{" "}
            {t("admin.templates.prep.es_fill", { filled: String(esFill.filled), total: String(esFill.total) })}
            {needsLink.length > 0
              ? ` · ${t("admin.templates.prep.needs_link_n", { n: String(needsLink.length) })}`
              : ""}
          </p>
        </div>
        <Link
          href={prepEditorHref(tpl.subtype)}
          className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15"
        >
          {t("admin.templates.prep.open_editor")}
        </Link>
      </div>

      {tpl.lines.length === 0 ? (
        <p className="mt-2 text-sm text-co-text-muted">{t("admin.templates.prep.no_lines")}</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {bySection.map(([section, lines]) => (
            <div key={section}>
              <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-co-text-muted">{section}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {lines.map((line) => (
                  <li key={line.lineId} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-co-text">{line.displayLabel}</span>
                    <span className="inline-flex items-center rounded-full bg-co-border/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-co-text-muted">
                      {t(inputTypeKey(line.inputType))}
                    </span>
                    {needsLinkIds.has(line.lineId) && (
                      <span className="inline-flex items-center rounded-full bg-co-cta/15 px-2 py-0.5 text-[10px] font-bold text-co-cta">
                        {t("admin.templates.prep.chip_needs_link")}
                      </span>
                    )}
                    {line.esMissing && (
                      <span className="inline-flex items-center rounded-full bg-co-gold/15 px-2 py-0.5 text-[10px] font-bold text-co-text">
                        {t("admin.templates.prep.chip_es_missing")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
