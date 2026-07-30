"use client";

/**
 * LanguageSettingCard — the language preference control on the Settings page.
 *
 * Reuses the existing self-only `PATCH /api/users/me/language` route (RLS
 * users_update_self; no audit — routine preference) and the TranslationProvider
 * context's setLanguage so the UI updates app-wide without a reload. Pessimistic:
 * only flips local state after the server confirms 200. Mirrors the UserMenu
 * language toggle idiom; phone-first (44px targets, gold focus ring), i18n'd.
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

export function LanguageSettingCard() {
  const { language, t, setLanguage } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const select = async (next: Language) => {
    if (next === language || updating) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/users/me/language", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: next }),
        redirect: "manual",
      });
      if (res.ok) {
        setLanguage(next);
      } else {
        setError(t("written_reports.error.generic"));
      }
    } catch {
      setError(t("written_reports.error.generic"));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section className="co-card p-4">
      <h2 className="text-base font-extrabold text-co-text">{t("settings.language.title")}</h2>
      <p className="mt-0.5 text-sm text-co-text-muted">{t("settings.language.sub")}</p>
      <div
        className="mt-3 flex gap-2"
        role="radiogroup"
        aria-label={t("settings.language.title")}
      >
        <LanguageButton
          label={t("user_menu.language.en")}
          active={language === "en"}
          disabled={updating}
          onClick={() => void select("en")}
          ariaLabel={t("user_menu.language.aria_select", { language: t("user_menu.language.en") })}
        />
        <LanguageButton
          label={t("user_menu.language.es")}
          active={language === "es"}
          disabled={updating}
          onClick={() => void select("es")}
          ariaLabel={t("user_menu.language.aria_select", { language: t("user_menu.language.es") })}
        />
      </div>
      {updating ? (
        <p className="mt-2 text-[11px] text-co-text-dim">{t("settings.language.saving")}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm text-co-cta">{error}</p> : null}
    </section>
  );
}

function LanguageButton({
  label,
  active,
  disabled,
  onClick,
  ariaLabel,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex min-h-[44px] items-center rounded-lg border-2 px-4 text-sm font-bold uppercase tracking-[0.1em] transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? "border-co-text bg-co-gold text-co-text"
          : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
