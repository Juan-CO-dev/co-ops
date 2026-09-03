"use client";

/**
 * MenuRow — one catering-menu row: name, badges (what this row IS), the Toast section it came
 * from, plain-English controls, and the sizes disclosure for registry items. Hosts Toggle /
 * ServesBox / SizeEditor (moved verbatim from MenuClient). Behavior of every control is unchanged;
 * the words and the arrangement are the redesign (Juan, 2026-09-03).
 */

import { useState } from "react";

import type { TranslationKey } from "@/lib/i18n/types";
import type { AdminMenuItem, AdminSize } from "@/lib/admin/catering/menu";
import { rowBadges, type RowBadge } from "@/lib/admin/catering/menu-view-shared";

export type FlagChanges = { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean; serves?: number | null };
export type SizeInput = { label: string; priceCents: number; serves: number | null };
export type T = (k: TranslationKey, params?: Record<string, string | number>) => string;

const BADGE_KEY: Record<RowBadge, TranslationKey> = {
  toast_item: "admin.catering.menu.badge_toast_item",
  catering_item: "admin.catering.menu.badge_catering_item",
  catering_only: "admin.catering.menu.badge_catering_only",
  seasonal: "admin.catering.menu.badge_seasonal",
  hidden: "admin.catering.menu.badge_hidden",
};
const BADGE_CLS: Record<RowBadge, string> = {
  toast_item: "bg-co-surface-inset text-co-text-muted",
  catering_item: "bg-co-gold/20 text-co-text",
  catering_only: "bg-co-gold/20 text-co-text",
  seasonal: "bg-co-surface-inset text-co-text-muted",
  hidden: "bg-co-warning-surface text-co-warning-text",
};

export function MenuRow({ item, canWrite, language, money, t, expanded, onToggleExpand, onFlags, onAddSize, onEditSize, onRemoveSize }: {
  item: AdminMenuItem;
  canWrite: boolean;
  language: string;
  money: (c: number | null) => string;
  t: T;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onFlags: (it: AdminMenuItem, changes: FlagChanges) => void;
  onAddSize: (itemId: string, input: SizeInput) => void;
  onEditSize: (itemId: string, sizeId: string, input: SizeInput) => void;
  onRemoveSize: (itemId: string, sizeId: string) => void;
}) {
  const badges = rowBadges(item);
  const hidden = !item.cateringAvailable;
  return (
    <li className={`co-card p-3 ${hidden ? "opacity-70" : ""}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-co-text">{language === "es" ? item.nameEs ?? item.name : item.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {badges.map((b) => (
              <span key={b} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${BADGE_CLS[b]}`}>{t(BADGE_KEY[b])}</span>
            ))}
            <span className="text-xs text-co-text-dim">{money(item.menuPriceCents)}</span>
          </span>
          {item.section && item.section.trim() && (
            <span className="mt-0.5 block text-[11px] text-co-text-dim">{t("admin.catering.menu.source_line", { section: item.section.trim() })}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          <ServesBox it={item} canWrite={canWrite} onSave={(x, v) => onFlags(x, { serves: v })} t={t} />
          {item.kind === "item" && (
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              title={t("admin.catering.menu.hint_sizes")}
              aria-expanded={expanded}
              className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text"
            >
              {t("admin.catering.menu.sizes")} ({item.sizes.length}){expanded ? " ▾" : " ▸"}
            </button>
          )}
          <Toggle label={t("admin.catering.menu.label_on_menu")} hint={t("admin.catering.menu.hint_on_menu")} on={item.cateringAvailable} disabled={!canWrite} onClick={() => onFlags(item, { cateringAvailable: !item.cateringAvailable })} />
          <Toggle label={t("admin.catering.menu.label_catering_only")} hint={t("admin.catering.menu.hint_catering_only")} on={item.cateringOnly} disabled={!canWrite} onClick={() => onFlags(item, { cateringOnly: !item.cateringOnly })} />
          {item.kind === "menu_item" && (
            <Toggle label={t("admin.catering.menu.label_portion")} hint={t("admin.catering.menu.hint_portion")} on={item.cateringPortionable === true} disabled={!canWrite} onClick={() => onFlags(item, { cateringPortionable: !(item.cateringPortionable === true) })} />
          )}
        </span>
      </div>
      {item.kind === "item" && expanded && (
        <SizeEditor item={item} canWrite={canWrite} t={t} money={money} onAdd={onAddSize} onEdit={onEditSize} onRemove={onRemoveSize} />
      )}
    </li>
  );
}

function ServesBox({ it, canWrite, onSave, t }: { it: AdminMenuItem; canWrite: boolean; onSave: (it: AdminMenuItem, serves: number | null) => void; t: T }) {
  const [draft, setDraft] = useState(it.serves != null ? String(it.serves) : "");
  const dirty = draft !== (it.serves != null ? String(it.serves) : "");
  const save = () => {
    const v = draft.trim() === "" ? null : Number(draft);
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
    onSave(it, v);
  };
  return (
    <label className="flex items-center gap-1 text-xs text-co-text-dim" title={t("admin.catering.menu.hint_feeds")}>
      {t("admin.catering.menu.label_feeds")}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (dirty) save(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal"
        placeholder="1"
        disabled={!canWrite}
        aria-label={t("admin.catering.menu.hint_feeds")}
        className="min-h-[44px] w-12 rounded-md border border-co-border-2 bg-co-surface px-1.5 py-0.5 text-xs font-bold text-co-text"
      />
      {t("admin.catering.menu.label_feeds_suffix")}
    </label>
  );
}

function Toggle({ label, hint, on, disabled, onClick }: { label: string; hint: string; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={hint}
      className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
        on ? "border-co-gold bg-co-surface-2 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
      }`}
    >
      {label}
    </button>
  );
}

/** Inline catering-size editor for a sized item: list + edit + remove + add. Prices in dollars → cents. (Moved verbatim from MenuClient.) */
function SizeEditor({ item, canWrite, t, money, onAdd, onEdit, onRemove }: {
  item: AdminMenuItem;
  canWrite: boolean;
  t: T;
  money: (c: number | null) => string;
  onAdd: (itemId: string, input: SizeInput) => void;
  onEdit: (itemId: string, sizeId: string, input: SizeInput) => void;
  onRemove: (itemId: string, sizeId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [eLabel, setELabel] = useState("");
  const [ePrice, setEPrice] = useState("");
  const [eServes, setEServes] = useState("");
  const [aLabel, setALabel] = useState("");
  const [aPrice, setAPrice] = useState("");
  const [aServes, setAServes] = useState("");

  const toCents = (dollars: string) => Math.round(parseFloat(dollars) * 100);
  const parseServes = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : null; };
  const validPrice = (dollars: string) => { const c = toCents(dollars); return Number.isFinite(c) && c >= 0; };

  const startEdit = (s: AdminSize) => { setEditing(s.id); setELabel(s.label); setEPrice((s.priceCents / 100).toFixed(2)); setEServes(s.serves != null ? String(s.serves) : ""); };
  const saveEdit = (sizeId: string) => { if (!eLabel.trim() || !validPrice(ePrice)) return; onEdit(item.id, sizeId, { label: eLabel.trim(), priceCents: toCents(ePrice), serves: parseServes(eServes) }); setEditing(null); };
  const add = () => { if (!aLabel.trim() || !validPrice(aPrice)) return; onAdd(item.id, { label: aLabel.trim(), priceCents: toCents(aPrice), serves: parseServes(aServes) }); setALabel(""); setAPrice(""); setAServes(""); };

  const inputCls = "min-h-[44px] rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text";
  const btnCls = "inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text disabled:opacity-50";

  return (
    <div className="mt-2 rounded-xl border border-co-border/60 bg-co-bg/40 p-3">
      <ul className="flex flex-col gap-1.5">
        {item.sizes.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
            {editing === s.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <input aria-label={t("admin.catering.menu.size_label")} value={eLabel} onChange={(e) => setELabel(e.target.value)} placeholder={t("admin.catering.menu.size_label")} className={`${inputCls} w-28`} />
                <input aria-label={t("admin.catering.menu.size_price")} value={ePrice} onChange={(e) => setEPrice(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_price")} className={`${inputCls} w-20`} />
                <input aria-label={t("admin.catering.menu.size_serves")} value={eServes} onChange={(e) => setEServes(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_serves")} className={`${inputCls} w-16`} />
                <button type="button" onClick={() => saveEdit(s.id)} className={btnCls}>{t("admin.catering.menu.size_save")}</button>
                <button type="button" onClick={() => setEditing(null)} className={btnCls}>{t("admin.catering.menu.size_cancel")}</button>
              </div>
            ) : (
              <>
                <span className="text-sm text-co-text">{s.label} · {money(s.priceCents)}{s.serves != null ? ` · ${t("admin.catering.menu.preview_feeds", { n: s.serves })}` : ""}</span>
                {canWrite && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => startEdit(s)} className={btnCls}>{t("admin.catering.menu.size_edit")}</button>
                    <button type="button" onClick={() => onRemove(item.id, s.id)} className={btnCls}>{t("admin.catering.menu.size_remove")}</button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-co-border/50 pt-2">
          <input aria-label={t("admin.catering.menu.size_label")} value={aLabel} onChange={(e) => setALabel(e.target.value)} placeholder={t("admin.catering.menu.size_label")} className={`${inputCls} w-28`} />
          <input aria-label={t("admin.catering.menu.size_price")} value={aPrice} onChange={(e) => setAPrice(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_price")} className={`${inputCls} w-20`} />
          <input aria-label={t("admin.catering.menu.size_serves")} value={aServes} onChange={(e) => setAServes(e.target.value)} inputMode="decimal" placeholder={t("admin.catering.menu.size_serves")} className={`${inputCls} w-16`} />
          <button type="button" onClick={add} className={btnCls}>+ {t("admin.catering.menu.add_size")}</button>
        </div>
      )}
    </div>
  );
}
