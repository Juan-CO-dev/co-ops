"use client";

/**
 * NeedsLinkQueue — the hub-root queue of item-shaped checklist lines (count
 * lines) that reference neither a registry item nor a SKU (The Master List,
 * spec §2 + §4). Each row gets a master-list picker (items + SKUs, filterable,
 * with a taxonomy type badge) + a Link action that sets item_id OR
 * vendor_item_id on the EXISTING line in place (id + label preserved).
 *
 * GM+ links (Tier A step-up via the admin StepUpProvider). Types come from the
 * client-safe needs-link-shared module. No server import here.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { NeedsLinkRow, LinkTarget } from "@/lib/admin/needs-link-shared";

const tk = (k: string): TranslationKey => k as TranslationKey;

// Map the server's machine-stable error `code` → a specific message key, so the
// operator learns WHY a link failed (already linked / not a count line / stale
// line / bad target / forbidden) instead of the generic "try again".
const ERROR_KEY_BY_CODE: Record<string, TranslationKey> = {
  forbidden: "admin.templates.needs_link.error_forbidden",
  line_not_found: "admin.templates.needs_link.error_line_not_found",
  not_countable: "admin.templates.needs_link.error_not_countable",
  already_linked: "admin.templates.needs_link.error_already_linked",
  invalid_target: "admin.templates.needs_link.error_invalid_target",
};

export function NeedsLinkQueue({
  rows,
  targets,
  canLink,
}: {
  rows: NeedsLinkRow[];
  targets: LinkTarget[];
  canLink: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const link = async (lineId: string, target: LinkTarget) => {
    if (busyLineId) return;
    setErrorKey(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusyLineId(lineId);
    try {
      const res = await fetch(`/api/admin/checklist-templates/needs-link/${lineId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetKind: target.kind, targetId: target.id }),
        redirect: "manual",
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof body?.code === "string" ? body.code : null;
      setErrorKey((code && ERROR_KEY_BY_CODE[code]) || "admin.templates.needs_link.error");
    } catch {
      setErrorKey("admin.templates.needs_link.error");
    } finally {
      setBusyLineId(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
        {t("admin.templates.needs_link.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errorKey && <p className="text-sm font-semibold text-co-cta-text">{t(errorKey)}</p>}
      {rows.map((r) => (
        <NeedsLinkCard
          key={r.lineId}
          row={r}
          targets={targets}
          canLink={canLink}
          busy={busyLineId === r.lineId}
          onLink={(target) => void link(r.lineId, target)}
        />
      ))}
    </div>
  );
}

function NeedsLinkCard({
  row,
  targets,
  canLink,
  busy,
  onLink,
}: {
  row: NeedsLinkRow;
  targets: LinkTarget[];
  canLink: boolean;
  busy: boolean;
  onLink: (target: LinkTarget) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "item" | "sku">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return targets
      .filter((tg) => (kindFilter === "all" ? true : tg.kind === kindFilter))
      .filter((tg) => (q ? tg.name.toLowerCase().includes(q) : true))
      .slice(0, 20);
  }, [targets, query, kindFilter]);

  const kindChip = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold transition ${
      active ? "border-co-gold-deep bg-co-surface-2 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;

  return (
    <div className="co-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-co-text">{row.label}</span>
        <span className="rounded bg-co-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text-dim">
          {t(tk(`admin.templates.type.${row.templateType}`))}
        </span>
        {row.locationName && (
          <span className="text-xs text-co-text-muted">{row.locationName}</span>
        )}
        {row.section && <span className="text-xs text-co-text-muted">· {row.section}</span>}
      </div>

      {canLink ? (
        <div className="mt-3 border-t border-co-border/50 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={kindChip(kindFilter === "all")} aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")}>
              {t("admin.templates.needs_link.filter_all")}
            </button>
            <button type="button" className={kindChip(kindFilter === "item")} aria-pressed={kindFilter === "item"} onClick={() => setKindFilter("item")}>
              {t("admin.templates.needs_link.filter_items")}
            </button>
            <button type="button" className={kindChip(kindFilter === "sku")} aria-pressed={kindFilter === "sku"} onClick={() => setKindFilter("sku")}>
              {t("admin.templates.needs_link.filter_skus")}
            </button>
          </div>
          <input
            type="search"
            aria-label={t("admin.templates.needs_link.search_label")}
            placeholder={t("admin.templates.needs_link.search_placeholder")}
            value={query}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2 min-h-[44px] w-full max-w-sm rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text disabled:opacity-50"
          />
          <ul className="mt-2 flex flex-col gap-1">
            {filtered.length === 0 ? (
              <li className="text-xs text-co-text-muted">{t("admin.templates.needs_link.no_targets")}</li>
            ) : (
              filtered.map((tg) => (
                <li key={`${tg.kind}:${tg.id}`} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm text-co-text">
                    {tg.name}
                    <span className="rounded bg-co-gold/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">
                      {t(tk(`admin.catalog.type.${tg.typeLabel}`))}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onLink(tg)}
                    className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-surface-2 disabled:opacity-50"
                  >
                    {busy ? t("admin.templates.needs_link.linking") : t("admin.templates.needs_link.link")}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
