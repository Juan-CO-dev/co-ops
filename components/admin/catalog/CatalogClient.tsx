"use client";

/**
 * CatalogClient — the Items Master Catalog surface (/admin/items, default view).
 * Lens chips + search + section-grouped rows, each expanding to a routing
 * DOSSIER of Links to the owning editors. The catalog only WRITES `seasonal`
 * (level ≥7, Tier-A step-up via the shared PasswordModal — pendingRef pattern
 * cribbed from SalesTab). Every other edge is a read-only Link.
 *
 * Types come from lib/admin/catalog-shared (client-safe; the server loader
 * re-exports them). No server import here.
 */
import { useMemo, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { CatalogEntity, CatalogIssue } from "@/lib/admin/catalog-shared";

const tk = (k: string): TranslationKey => k as TranslationKey;

type Lens = "all" | "prep" | "sold_as_is" | "menu_items" | "packages" | "seasonal" | "issues";
const LENSES: Lens[] = ["all", "prep", "sold_as_is", "menu_items", "packages", "seasonal", "issues"];

const SEASONAL_MIN = 7; // GM+ writes the seasonal flag (mirrors the menu manager write floor)

function matchesLens(e: CatalogEntity, lens: Lens): boolean {
  switch (lens) {
    case "all": return true;
    case "prep": return e.kind === "item" && !e.flags.soldDirectly;
    case "sold_as_is": return e.kind === "item" && e.flags.soldDirectly;
    case "menu_items": return e.kind === "menu_item";
    case "packages": return e.kind === "package";
    case "seasonal": return e.seasonal;
    case "issues": return e.issues.length > 0;
  }
}

export function CatalogClient({ entities, actorLevel }: { entities: CatalogEntity[]; actorLevel: number }) {
  const { t } = useTranslation();
  const router = useRouter();

  const [lens, setLens] = useState<Lens>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);

  const canWriteSeasonal = actorLevel >= SEASONAL_MIN;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entities.filter((e) => {
      if (!matchesLens(e, lens)) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || (e.nameEs?.toLowerCase().includes(q) ?? false);
    });
  }, [entities, lens, query]);

  // Group by section (menu_items/items by section slug/label; packages under
  // their location name or "Global"). Preserve first-seen section order.
  const groups = useMemo(() => {
    const map = new Map<string, CatalogEntity[]>();
    for (const e of filtered) {
      const key = e.section ?? t("admin.catalog.section.none");
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [filtered, t]);

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const writeSeasonal = useCallback(async (e: CatalogEntity, seasonal: boolean) => {
    setErrorKey(null);
    setBusyKey(e.key);
    const url = e.kind === "package"
      ? `/api/admin/catering/packages/${e.id}`
      : `/api/admin/catering/menu/${e.id}`;
    const body = e.kind === "package"
      ? { seasonal }
      : { kind: e.kind, seasonal };
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "manual",
      });
      if (res.ok) {
        setStepUpOpen(false);
        pendingRef.current = null;
        router.refresh();
        return;
      }
      const b = (await res.json().catch(() => ({}))) as { code?: string };
      if (b.code === "step_up_required" || b.code === "step_up_stale") {
        pendingRef.current = () => writeSeasonal(e, seasonal);
        setStepUpOpen(true);
        return;
      }
      setErrorKey("admin.catalog.error.generic");
    } catch {
      setErrorKey("admin.catalog.error.generic");
    } finally {
      setBusyKey(null);
    }
  }, [router]);

  const chip = (active: boolean) =>
    `inline-flex min-h-[36px] items-center rounded-full border-2 px-3 text-xs font-bold transition ${
      active ? "border-co-gold-deep bg-co-gold/25 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;
  const inputCls = "min-h-[40px] w-full max-w-sm rounded-lg border-2 border-co-border-2 bg-co-surface px-3 text-sm text-co-text";

  return (
    <div className="mt-4 flex flex-col gap-5">
      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}

      {/* Lens chips */}
      <div className="flex flex-wrap gap-2">
        {LENSES.map((l) => (
          <button key={l} type="button" className={chip(lens === l)} aria-pressed={lens === l} onClick={() => setLens(l)}>
            {t(tk(`admin.catalog.lens.${l}`))}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label={t("admin.catalog.search_label")}
          placeholder={t("admin.catalog.search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={inputCls}
        />
        <span className="text-xs text-co-text-muted">{t("admin.catalog.count", { n: String(filtered.length) })}</span>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.catalog.empty")}
        </div>
      ) : (
        groups.map(([section, rows]) => (
          <section key={section}>
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">{section}</h2>
            <div className="mt-2 flex flex-col gap-2">
              {rows.map((e) => (
                <CatalogRow
                  key={e.key}
                  e={e}
                  expanded={expanded.has(e.key)}
                  onToggle={() => toggleExpand(e.key)}
                  canWriteSeasonal={canWriteSeasonal}
                  busy={busyKey === e.key}
                  onSeasonal={(seasonal) => void writeSeasonal(e, seasonal)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <PasswordModal
        open={stepUpOpen}
        onConfirm={async () => { if (pendingRef.current) await pendingRef.current(); }}
        onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }}
      />
    </div>
  );
}

function IssueBadge({ issue }: { issue: CatalogIssue }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center rounded-full border border-co-cta/50 bg-co-cta/10 px-2 py-0.5 text-[11px] font-bold text-co-cta">
      {t(tk(`admin.catalog.issue.${issue}`))}
    </span>
  );
}

function EdgeList({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-co-text">{children}</div>
    </div>
  );
}

const linkCls = "text-co-text underline decoration-co-border underline-offset-2 hover:decoration-co-text";

function CatalogRow({
  e, expanded, onToggle, canWriteSeasonal, busy, onSeasonal,
}: {
  e: CatalogEntity;
  expanded: boolean;
  onToggle: () => void;
  canWriteSeasonal: boolean;
  busy: boolean;
  onSeasonal: (seasonal: boolean) => void;
}) {
  const { t } = useTranslation();
  const none = <span className="text-co-text-muted">{t("admin.catalog.edge.none")}</span>;

  return (
    <div className="co-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-co-text">{e.name}</span>
          <span className="rounded bg-co-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text-dim">
            {t(tk(`admin.catalog.kind.${e.kind}`))}
          </span>
          {!e.active && (
            <span className="rounded-full border border-co-border px-2 py-0.5 text-[11px] font-bold text-co-text-muted">
              {t("admin.catalog.badge.inactive")}
            </span>
          )}
          {e.seasonal && (
            <span className="rounded-full border border-co-gold-deep bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold text-co-text">
              {t("admin.catalog.badge.seasonal")}
            </span>
          )}
          {e.flags.cateringOnly && (
            <span className="rounded-full border border-co-border px-2 py-0.5 text-[11px] font-bold text-co-text-muted">
              {t("admin.catalog.badge.catering_only")}
            </span>
          )}
          {e.issues.length > 0 && (
            <span className="rounded-full border border-co-cta/50 bg-co-cta/10 px-2 py-0.5 text-[11px] font-bold text-co-cta">
              {t("admin.catalog.badge.issues", { n: String(e.issues.length) })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="inline-flex min-h-[32px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim hover:text-co-text"
        >
          {expanded ? t("admin.catalog.collapse") : t("admin.catalog.expand")}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 border-t border-co-border/50 pt-3">
          {e.issues.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {e.issues.map((i) => <IssueBadge key={i} issue={i} />)}
            </div>
          )}

          {e.edges.producedBy.length > 0 && (
            <EdgeList label={t("admin.catalog.edge.produced_by")}>
              {e.edges.producedBy.map((r) => (
                <Link key={r.id} href={`/admin/recipes/${r.id}`} className={linkCls}>{r.name}</Link>
              ))}
            </EdgeList>
          )}

          {e.edges.build && (
            <EdgeList label={t("admin.catalog.edge.build")}>
              <Link href={`/admin/recipes/${e.edges.build.id}`} className={linkCls}>{e.edges.build.name}</Link>
            </EdgeList>
          )}

          {e.kind === "item" && (
            <EdgeList label={t("admin.catalog.edge.skus")}>
              {e.edges.skuNames.length > 0
                ? <Link href="/admin/skus" className={linkCls}>{e.edges.skuNames.join(", ")}</Link>
                : none}
            </EdgeList>
          )}

          {e.edges.componentItems.length > 0 && (
            <EdgeList label={t("admin.catalog.edge.components")}>
              {e.edges.componentItems.map((r, i) => (
                <span key={r.id}>{r.name}{i < e.edges.componentItems.length - 1 ? "," : ""}</span>
              ))}
            </EdgeList>
          )}

          {e.edges.usedInMenuItems.length > 0 && (
            <EdgeList label={t("admin.catalog.edge.used_in_menu_items")}>
              {e.edges.usedInMenuItems.map((r, i) => (
                <span key={r.id}>{r.name}{i < e.edges.usedInMenuItems.length - 1 ? "," : ""}</span>
              ))}
            </EdgeList>
          )}

          {e.edges.usedInItems.length > 0 && (
            <EdgeList label={t("admin.catalog.edge.used_in_items")}>
              {e.edges.usedInItems.map((r, i) => (
                <span key={r.id}>{r.name}{i < e.edges.usedInItems.length - 1 ? "," : ""}</span>
              ))}
            </EdgeList>
          )}

          {e.edges.packages.length > 0 && (
            <EdgeList label={t("admin.catalog.edge.packages")}>
              {e.edges.packages.map((r, i) => (
                <Link key={r.id} href="/admin/catering/packages" className={linkCls}>
                  {r.name}{i < e.edges.packages.length - 1 ? "," : ""}
                </Link>
              ))}
            </EdgeList>
          )}

          {e.edges.checklists.length > 0 && (
            <EdgeList label={t("admin.catalog.edge.checklists")}>
              {e.edges.checklists.map((c, i) => (
                <Link key={c.templateId} href="/admin/checklist-templates" className={linkCls}>
                  {c.name}{i < e.edges.checklists.length - 1 ? "," : ""}
                </Link>
              ))}
            </EdgeList>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <EdgeList label={t("admin.catalog.edge.toast")}>
              <Link href="/admin/catering/menu" className={linkCls}>{e.edges.toastGuids}</Link>
            </EdgeList>
            {e.kind === "item" && (
              <EdgeList label={t("admin.catalog.edge.sizes")}>
                <Link href="/admin/catering/menu" className={linkCls}>{e.edges.sizesCount}</Link>
              </EdgeList>
            )}
            {e.serves != null && (
              <EdgeList label={t("admin.catalog.edge.serves")}>
                <span>{e.serves}</span>
              </EdgeList>
            )}
            {e.priceCents != null && (
              <EdgeList label={t("admin.catalog.edge.price")}>
                <span>${(e.priceCents / 100).toFixed(2)}</span>
              </EdgeList>
            )}
          </div>

          {canWriteSeasonal && (
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSeasonal(!e.seasonal)}
                className="inline-flex min-h-[36px] items-center rounded-full border-2 border-co-gold-deep bg-co-surface px-3 text-xs font-bold text-co-text hover:bg-co-gold/15 disabled:opacity-50"
              >
                {busy
                  ? t("admin.catalog.seasonal.working")
                  : e.seasonal ? t("admin.catalog.seasonal.unmark") : t("admin.catalog.seasonal.mark")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
