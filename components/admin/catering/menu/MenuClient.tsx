"use client";

/**
 * MenuClient — GM+ catering-menu manager. Owns STATE and the ONE WRITE PATH (`apiWrite`, Tier-A
 * step-up retry via PasswordModal) and composes the presentation: legend → toolbar → either the
 * grouped editor (MenuSectionList + MenuRow) or the read-only customer preview (MenuPreview).
 * Grouping/filtering is pure (lib/admin/catering/menu-view-shared.ts) and shared with the order
 * builder, so admin and customer can never disagree about what "Sides" is.
 * catering_only implies available (server-enforced; the UI reflects the returned state).
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { AdminMenuItem, AdminSize } from "@/lib/admin/catering/menu";
import { filterAdminRows, groupAdminRows, type FlagChanges, type MenuFilterChip, type SizeInput } from "@/lib/admin/catering/menu-view-shared";
import { MenuLegend } from "./MenuLegend";
import { MenuToolbar } from "./MenuToolbar";
import { MenuSectionList, PackagesCard } from "./MenuSectionList";
import { MenuPreview } from "./MenuPreview";
import { MenuRow } from "./MenuRow";

const KNOWN = new Set(["forbidden", "not_found", "invalid_payload", "invalid_size", "invalid_serves", "size_exists", "step_up_required", "step_up_stale", "generic"]);
function errKey(code: string): TranslationKey {
  return (KNOWN.has(code) ? `admin.catering.menu.error.${code}` : "admin.catering.menu.error.generic") as TranslationKey;
}

export function MenuClient({ items: initial, canWrite, packageCount }: { items: AdminMenuItem[]; canWrite: boolean; packageCount: number }) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<AdminMenuItem[]>(initial);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chip, setChip] = useState<MenuFilterChip>("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);

  const money = useCallback(
    (c: number | null) => (c != null ? new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(c / 100) : "—"),
    [language],
  );

  // One write path for every action (flags + sizes). On a step-up challenge, stash the retry + open
  // the modal; on confirm it re-runs. onOk gets the parsed JSON body to patch local state.
  // Not wrapped in useCallback: the retry closure below calls `apiWrite` by name, and a memoized
  // self-reference trips eslint-plugin-react-hooks' immutability check (it cannot prove the
  // captured binding never changes). A plain function avoids that without changing behavior —
  // every caller only fires it from an event handler, so referential stability isn't load-bearing.
  const apiWrite = async (url: string, method: string, body: unknown, onOk: (data: Record<string, unknown>) => void) => {
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
  };

  // Not wrapped in useCallback (same reason as apiWrite): each closes over the non-memoized
  // apiWrite above, so memoizing here would still redefine on every render — eslint's
  // exhaustive-deps flags that as "wrap apiWrite too" and around we'd go. Referential
  // stability isn't load-bearing: these fire only from user clicks passed down as props.
  const setFlags = (it: AdminMenuItem, changes: FlagChanges) =>
    apiWrite(`/api/admin/catering/menu/${it.id}`, "PATCH", { kind: it.kind, ...changes }, (data) => {
      const d = data as { cateringAvailable?: boolean; cateringOnly?: boolean; cateringPortionable?: boolean | null };
      setItems((prev) => prev.map((x) => (x.id === it.id && x.kind === it.kind
        ? { ...x, cateringAvailable: d.cateringAvailable ?? x.cateringAvailable, cateringOnly: d.cateringOnly ?? x.cateringOnly, cateringPortionable: d.cateringPortionable ?? x.cateringPortionable, serves: "serves" in changes ? (changes.serves ?? null) : x.serves }
        : x)));
    });

  const addSize = (itemId: string, input: SizeInput) =>
    apiWrite(`/api/admin/catering/menu/${itemId}/sizes`, "POST", input, (data) => {
      const s = (data as { size?: AdminSize }).size;
      if (!s) return;
      setItems((prev) => prev.map((x) => (x.id === itemId && x.kind === "item" ? { ...x, sizes: [...x.sizes, s] } : x)));
    });

  const editSize = (itemId: string, sizeId: string, input: SizeInput) =>
    apiWrite(`/api/admin/catering/item-sizes/${sizeId}`, "PATCH", input, (data) => {
      const s = (data as { size?: AdminSize }).size;
      if (!s) return;
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, sizes: x.sizes.map((z) => (z.id === sizeId ? s : z)) } : x)));
    });

  const removeSize = (itemId: string, sizeId: string) =>
    apiWrite(`/api/admin/catering/item-sizes/${sizeId}`, "DELETE", undefined, () => {
      setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, sizes: x.sizes.filter((z) => z.id !== sizeId) } : x)));
    });

  const toggleExpand = useCallback((id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);

  const groups = useMemo(() => groupAdminRows(filterAdminRows(items, { chip, query })), [items, chip, query]);

  return (
    <div className="mt-4 flex flex-col gap-4">
      {errorKey && <p className="text-sm font-semibold text-co-cta-text">{t(errorKey)}</p>}
      <MenuLegend t={t} />
      <MenuToolbar chip={chip} onChip={setChip} query={query} onQuery={setQuery} preview={preview} onPreview={setPreview} t={t} />
      <PackagesCard packageCount={packageCount} t={t} />
      {items.length === 0 ? (
        <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.empty")}</p>
      ) : preview ? (
        <MenuPreview groups={groups} language={language} money={money} t={t} filtered={chip !== "all" || query.trim() !== ""} />
      ) : (
        <MenuSectionList
          groups={groups}
          t={t}
          renderRow={(it) => (
            <MenuRow
              item={it}
              canWrite={canWrite}
              language={language}
              money={money}
              t={t}
              expanded={expanded.has(it.id)}
              onToggleExpand={toggleExpand}
              onFlags={setFlags}
              onAddSize={addSize}
              onEditSize={editSize}
              onRemoveSize={removeSize}
            />
          )}
        />
      )}
      <PasswordModal open={stepUpOpen} onConfirm={async () => { if (pendingRef.current) await pendingRef.current(); }} onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }} />
    </div>
  );
}
