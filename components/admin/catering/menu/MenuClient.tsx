"use client";

/**
 * MenuClient — GM+ catering-menu flag editor. Toggles catering_available / catering_only
 * on the shared item registry. Writes are Tier-A step-up gated; on a step-up challenge we
 * open the admin PasswordModal and retry the pending toggle (same pattern as quote-send).
 * catering_only implies available (the server enforces it; the UI reflects the returned state).
 */

import { useCallback, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { AdminMenuItem } from "@/lib/admin/catering/menu";

const KNOWN = new Set(["forbidden", "not_found", "invalid_payload", "step_up_required", "step_up_stale", "generic"]);
function errKey(code: string): TranslationKey {
  return (KNOWN.has(code) ? `admin.catering.menu.error.${code}` : "admin.catering.menu.error.generic") as TranslationKey;
}

type Change = { cateringAvailable?: boolean; cateringOnly?: boolean };

export function MenuClient({ items: initial, canWrite }: { items: AdminMenuItem[]; canWrite: boolean }) {
  const { t, language } = useTranslation();
  const [items, setItems] = useState<AdminMenuItem[]>(initial);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [pending, setPending] = useState<{ id: string; changes: Change } | null>(null);

  const apply = useCallback(async (id: string, changes: Change) => {
    setErrorKey(null);
    let res: Response;
    try {
      res = await fetch(`/api/admin/catering/menu/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
        redirect: "manual",
      });
    } catch {
      setErrorKey("admin.catering.menu.error.generic");
      return;
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { cateringAvailable?: boolean; cateringOnly?: boolean };
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, cateringAvailable: data.cateringAvailable ?? it.cateringAvailable, cateringOnly: data.cateringOnly ?? it.cateringOnly } : it)));
      setStepUpOpen(false);
      setPending(null);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === "step_up_required" || body.code === "step_up_stale") {
      setPending({ id, changes });
      setStepUpOpen(true);
      return;
    }
    setErrorKey(errKey(body.code ?? "generic"));
  }, []);

  const groups = new Map<string, AdminMenuItem[]>();
  for (const it of items) {
    const key = it.section ?? "";
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const sections = [...groups.entries()];

  const money = (c: number | null) => (c != null ? new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(c / 100) : "—");

  return (
    <div className="mt-4 flex flex-col gap-5">
      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}
      {items.length === 0 && <p className="co-card p-6 text-sm text-co-text-muted">{t("admin.catering.menu.empty")}</p>}

      {sections.map(([section, rows]) => (
        <section key={section || "_none"}>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
            {section || t("admin.catering.menu.no_section")}
          </h2>
          <ul className="flex flex-col gap-1.5">
            {rows.map((it) => (
              <li key={it.id} className="co-card flex items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-co-text">{language === "es" ? it.nameEs ?? it.name : it.name}</span>
                  <span className="text-xs text-co-text-dim">{money(it.menuPriceCents)}</span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Toggle label={t("admin.catering.menu.available")} on={it.cateringAvailable} disabled={!canWrite} onClick={() => apply(it.id, { cateringAvailable: !it.cateringAvailable })} />
                  <Toggle label={t("admin.catering.menu.only")} on={it.cateringOnly} disabled={!canWrite} onClick={() => apply(it.id, { cateringOnly: !it.cateringOnly })} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <PasswordModal open={stepUpOpen} onConfirm={async () => { if (pending) await apply(pending.id, pending.changes); }} onCancel={() => { setStepUpOpen(false); setPending(null); }} />
    </div>
  );
}

function Toggle({ label, on, disabled, onClick }: { label: string; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex min-h-[36px] items-center rounded-full border-2 px-3 text-xs font-bold uppercase tracking-wide transition disabled:opacity-50 ${
        on ? "border-co-gold bg-co-gold/20 text-co-text" : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
      }`}
    >
      {label}
    </button>
  );
}
