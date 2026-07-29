"use client";

/**
 * MenuClient — GM+ catering-menu manager (sub-project C). Manages catering flags on BOTH the item
 * registry (`kind:"item"`) and the sub/resale menu (`kind:"menu_item"`, with a catering_portionable
 * "Portions" toggle), plus a full inline editor for a sized item's catering `item_sizes`
 * (add / edit / remove). Every write is Tier-A step-up gated: on a step_up challenge we open the
 * admin PasswordModal and retry the pending action. catering_only implies available (server-enforced;
 * the UI reflects the returned state). Prices are entered in dollars and sent as integer cents.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { AdminMenuItem, AdminSize } from "@/lib/admin/catering/menu";

const KNOWN = new Set(["forbidden", "not_found", "invalid_payload", "invalid_size", "invalid_serves", "size_exists", "step_up_required", "step_up_stale", "generic"]);
function errKey(code: string): TranslationKey {
  return (KNOWN.has(code) ? `admin.catering.menu.error.${code}` : "admin.catering.menu.error.generic") as TranslationKey;
}

type FlagChanges = { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean; serves?: number | null };

export function MenuClient({ items: initial, canWrite }: { items: AdminMenuItem[]; canWrite: boolean }) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<AdminMenuItem[]>(initial);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const money = useCallback(
    (c: number | null) => (c != null ? new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(c / 100) : "—"),
    [language],
  );

  // One write path for every action (flags + sizes). On a step-up challenge, stash the retry + open
  // the modal; on confirm it re-runs. onOk gets the parsed JSON body to patch local state.
  const apiWrite = useCallback(async (url: string, method: string, body: unknown, onOk: (data: Record<string, unknown>) => void) => {
    setErrorKey(null);
    let res: Response;
    try {
      res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
    } catch {
      setErrorKey("admin.catering.menu.error.generic");
      return;
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      onOk(data);
      setStepUpOpen(false);
      pendingRef.current = null;
      return;
    }
    const b = (await res.json().catch(() => ({}))) as { code?: string };
    if (b.code === "step_up_required" || b.code === "step_up_stale") {
      pendingRef.current = () => apiWrite(url, method, body, onOk);
      setStepUpOpen(true);
      return;
    }
    setErrorKey(errKey(b.code ?? "generic"));
  }, []);

  const setFlags = useCallback((it: AdminMenuItem, changes: FlagChanges) =>
    apiWrite(`/api/admin/catering/menu/${it.id}`, "PATCH", { kind: it.kind, ...changes }, (data) => {
      const d = data as { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean | null };
      setItems((prev) => prev.map((x) => (x.id === it.id && x.kind === it.kind
        ? { ...x, cateringAvailable: d.cateringAvailable ?? x.cateringAvailable, cateringOnly: d.cateringOnly ?? x.cateringOnly, cateringPortionable: d.cateringPortionable ?? x.cateringPortionable, serves: "serves" in changes ? (changes.serves ?? null) : x.serves }
        : x)));
    }), [apiWrite]);

  const addSize = useCallback((itemId: string, input: { label: string; priceCents: number; serves: number | null }) =>
    apiWrite(`/api/admin/catering/menu/${itemId}/sizes`, "POST", input, (data) => {
      const s = (data as { size?: AdminSize }).size;
      if (!s) return;
      setItems((prev) => prev.map((x) => (x.id === itemId && x.kind === "item" ? { ...x, sizes: [...x.sizes, s] } : x)));
    }), [apiWrite]);

  const editSize = useCallback((itemId: string, sizeId: string, input: { label: string; priceCents: number; serves: number | null }) =>
    apiWrite(`/api/admin/catering/item-sizes/${sizeId}`, "PATCH", input, (data) => {
      const s = (data as { size?: AdminSize }).size;
      if (!s) return;
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, sizes: x.sizes.map((z) => (z.id === sizeId ? s : z)) } : x)));
    }), [apiWrite]);

  const removeSize = useCallback((itemId: string, sizeId: string) =>
    apiWrite(`/api/admin/catering/item-sizes/${sizeId}`, "DELETE", undefined, () => {
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, sizes: x.sizes.filter((z) => z.id !== sizeId) } : x)));
    }), [apiWrite]);

  const toggleExpand = (id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const bySection = (list: AdminMenuItem[]) => {
    const groups = new Map<string, AdminMenuItem[]>();
    for (const it of list) { const key = it.section ?? ""; const arr = groups.get(key) ?? []; arr.push(it); groups.set(key, arr); }
    return [...groups.entries()];
  };
  const itemSections = bySection(items.filter((i) => i.kind === "item"));
  const subSections = bySection(items.filter((i) => i.kind === "menu_item"));

  return (
    <div className="mt-4 flex flex-col gap-8">
      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}
      {items.length === 0 && <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.empty")}</p>}

      {/* Item registry (with per-item catering sizes). */}
      {itemSections.length > 0 && (
        <div className="flex flex-col gap-5">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text">{t("admin.catering.menu.items_heading")}</h2>
          {itemSections.map(([section, rows]) => (
            <MenuSection key={`item:${section || "_none"}`} idBase={`menu-item-section-${section || "_none"}`} section={section} rows={rows} t={t}>
              <ul className="flex flex-col gap-1.5">
                {rows.map((it) => (
                  <li key={`item:${it.id}`} className="co-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-co-text">{language === "es" ? it.nameEs ?? it.name : it.name}</span>
                        <span className="text-xs text-co-text-dim">{money(it.menuPriceCents)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <ServesBox it={it} canWrite={canWrite} onSave={(x, v) => setFlags(x, { serves: v })} t={t} />
                        <button type="button" onClick={() => toggleExpand(it.id)} className="inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text">
                          {t("admin.catering.menu.sizes")} ({it.sizes.length}){expanded.has(it.id) ? " ▾" : " ▸"}
                        </button>
                        <Toggle label={t("admin.catering.menu.available")} on={it.cateringAvailable} disabled={!canWrite} onClick={() => setFlags(it, { cateringAvailable: !it.cateringAvailable })} />
                        <Toggle label={t("admin.catering.menu.only")} on={it.cateringOnly} disabled={!canWrite} onClick={() => setFlags(it, { cateringOnly: !it.cateringOnly })} />
                      </span>
                    </div>
                    {expanded.has(it.id) && (
                      <SizeEditor item={it} canWrite={canWrite} t={t} money={money} onAdd={addSize} onEdit={editSize} onRemove={removeSize} />
                    )}
                  </li>
                ))}
              </ul>
            </MenuSection>
          ))}
        </div>
      )}

      {/* Subs & sides (menu_items) — available / only / portions. */}
      {subSections.length > 0 && (
        <div className="flex flex-col gap-5">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text">{t("admin.catering.menu.menu_items_heading")}</h2>
          {subSections.map(([section, rows]) => (
            <MenuSection key={`sub:${section || "_none"}`} idBase={`menu-sub-section-${section || "_none"}`} section={section} rows={rows} t={t}>
              <ul className="flex flex-col gap-1.5">
                {rows.map((it) => (
                  <li key={`sub:${it.id}`} className="co-card flex items-center justify-between gap-3 p-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-co-text">{language === "es" ? it.nameEs ?? it.name : it.name}</span>
                      <span className="text-xs text-co-text-dim">{money(it.menuPriceCents)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <ServesBox it={it} canWrite={canWrite} onSave={(x, v) => setFlags(x, { serves: v })} t={t} />
                      <Toggle label={t("admin.catering.menu.available")} on={it.cateringAvailable} disabled={!canWrite} onClick={() => setFlags(it, { cateringAvailable: !it.cateringAvailable })} />
                      <Toggle label={t("admin.catering.menu.only")} on={it.cateringOnly} disabled={!canWrite} onClick={() => setFlags(it, { cateringOnly: !it.cateringOnly })} />
                      <Toggle label={t("admin.catering.menu.portionable")} on={it.cateringPortionable === true} disabled={!canWrite} onClick={() => setFlags(it, { cateringPortionable: !(it.cateringPortionable === true) })} />
                    </span>
                  </li>
                ))}
              </ul>
            </MenuSection>
          ))}
        </div>
      )}

      <a href="/admin/catering/packages" className="co-card inline-flex items-center justify-center p-3 text-sm font-bold text-co-text transition hover:text-co-cta">
        {t("admin.catering.menu.edit_packages")}
      </a>

      <PasswordModal open={stepUpOpen} onConfirm={async () => { if (pendingRef.current) await pendingRef.current(); }} onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }} />
    </div>
  );
}

/**
 * MenuSection — Disclosure Doctrine W4: wraps a menu section's rows in a
 * CollapsibleSection. Header = section name + i18n'd total count (D5) + an
 * i18n'd "N available" count (D2 badge slot, catering_available among the rows).
 * defaultOpen when the section has 6 or fewer items (larger sections collapse to
 * cut first-paint scroll). Row internals are untouched — pure relocation.
 */
function MenuSection({ idBase, section, rows, t, children }: {
  idBase: string;
  section: string;
  rows: AdminMenuItem[];
  t: (k: TranslationKey, params?: Record<string, string | number>) => string;
  children: ReactNode;
}) {
  const availableCount = rows.reduce((n, r) => n + (r.cateringAvailable ? 1 : 0), 0);
  return (
    <CollapsibleSection
      idBase={idBase}
      title={section || t("admin.catering.menu.no_section")}
      count={t("admin.catering.menu.section_count", { n: rows.length })}
      defaultOpen={rows.length <= 6}
      badge={
        <span className="inline-flex items-center rounded-full bg-co-gold/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text">
          {t("admin.catering.menu.section_available", { n: availableCount })}
        </span>
      }
    >
      {children}
    </CollapsibleSection>
  );
}

function ServesBox({ it, canWrite, onSave, t }: { it: AdminMenuItem; canWrite: boolean; onSave: (it: AdminMenuItem, serves: number | null) => void; t: (k: TranslationKey) => string }) {
  const [draft, setDraft] = useState(it.serves != null ? String(it.serves) : "");
  const dirty = draft !== (it.serves != null ? String(it.serves) : "");
  const save = () => {
    const v = draft.trim() === "" ? null : Number(draft);
    if (v !== null && (!Number.isFinite(v) || v <= 0)) return;
    onSave(it, v);
  };
  return (
    <label className="flex items-center gap-1 text-xs text-co-text-dim" title={t("admin.catering.menu.serves_hint")}>
      {t("admin.catering.menu.serves")}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (dirty) save(); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        inputMode="decimal"
        placeholder="1"
        disabled={!canWrite}
        aria-label={t("admin.catering.menu.serves_hint")}
        className="w-12 rounded-md border border-co-border-2 bg-co-surface px-1.5 py-0.5 text-xs font-bold text-co-text"
      />
    </label>
  );
}

function Toggle({ label, on, disabled, onClick }: { label: string; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
        on ? "border-co-gold bg-co-gold/20 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
      }`}
    >
      {label}
    </button>
  );
}

/** Inline catering-size editor for a sized item: list + edit + remove + add. Prices in dollars → cents. */
function SizeEditor({ item, canWrite, t, money, onAdd, onEdit, onRemove }: {
  item: AdminMenuItem;
  canWrite: boolean;
  t: (k: TranslationKey) => string;
  money: (c: number | null) => string;
  onAdd: (itemId: string, input: { label: string; priceCents: number; serves: number | null }) => void;
  onEdit: (itemId: string, sizeId: string, input: { label: string; priceCents: number; serves: number | null }) => void;
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

  const inputCls = "min-h-[34px] rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text";
  const btnCls = "inline-flex min-h-[34px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text disabled:opacity-50";

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
                <span className="text-sm text-co-text">{s.label} · {money(s.priceCents)}{s.serves != null ? ` · serves ${s.serves}` : ""}</span>
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
