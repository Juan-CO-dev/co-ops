"use client";

/**
 * UserMenu — small dropdown affordance in the top-right of authenticated
 * page surfaces. Per SPEC_AMENDMENTS.md C.31's PR 5 design lock:
 *
 *   - Compact trigger using user initial (avatar-style circle), not text
 *     (closing-page header already shows location code + name; another
 *     text affordance would crowd)
 *   - First section in PR 5 scope: Language toggle (en / es)
 *   - Built as foundation for future expansion (password change,
 *     notification prefs, etc.) — name is UserMenu, not LanguageSelector,
 *     so future PRs don't refactor
 *   - PR 5 ships ONLY the language section; sign-out is intentionally NOT
 *     rebuilt here (existing affordances stay where they are, no
 *     unrelated UI reorganization in this PR per Juan's scope guidance)
 */

import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

interface UserMenuProps {
  /** User's display name — used to derive the initial for the trigger. */
  userName: string;
  /** User's email — shown in the menu header for context. */
  userEmail?: string | null;
}

export function UserMenu({ userName, userEmail }: UserMenuProps) {
  const { language, t, setLanguage } = useTranslation();
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initial = (userName.trim()[0] ?? "?").toUpperCase();

  // Click-outside-to-close. Pointerdown rather than click so it fires before
  // any in-menu button receives the click event (avoids losing taps).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleLanguageSelect = async (next: Language) => {
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
        // Server confirmed; update local Context. Pessimistic — wait for 200
        // before updating so we don't flicker on an error response.
        setLanguage(next);
      } else {
        let body: { error?: string; message?: string } = {};
        try {
          body = (await res.json()) as { error?: string; message?: string };
        } catch {
          // ignore JSON parse failure; we'll surface a generic message
        }
        setError(body.message ?? body.error ?? "Update failed.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("user_menu.aria_label")}
        className="
          inline-flex h-10 w-10 items-center justify-center rounded-full
          border-2 border-co-border bg-co-surface
          text-sm font-bold text-co-text
          transition hover:border-co-gold-deep active:bg-co-surface-2
          focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        "
      >
        {initial}
      </button>

      {open ? (
        <div
          role="menu"
          className="
            absolute right-0 top-12 z-30 w-64 rounded-xl border-2 border-co-border
            bg-co-surface p-3 shadow-lg
          "
        >
          <div className="px-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
              {t("user_menu.signed_in_as")}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-co-text">{userName}</div>
            {userEmail ? (
              <div className="text-[11px] text-co-text-dim truncate">{userEmail}</div>
            ) : null}
          </div>

          <div className="mt-3 border-t border-co-border-2 pt-3">
            <div className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
              {t("user_menu.language")}
            </div>
            <div className="mt-2 flex gap-2 px-1" role="radiogroup" aria-label={t("user_menu.language")}>
              <LanguageButton
                code="en"
                label={t("user_menu.language.en")}
                active={language === "en"}
                disabled={updating}
                onClick={() => void handleLanguageSelect("en")}
                ariaLabel={t("user_menu.language.aria_select", { language: t("user_menu.language.en") })}
              />
              <LanguageButton
                code="es"
                label={t("user_menu.language.es")}
                active={language === "es"}
                disabled={updating}
                onClick={() => void handleLanguageSelect("es")}
                ariaLabel={t("user_menu.language.aria_select", { language: t("user_menu.language.es") })}
              />
            </div>
            {updating ? (
              <div className="mt-2 px-1 text-[11px] text-co-text-dim">
                {t("user_menu.language.updating")}
              </div>
            ) : null}
            {error ? (
              <div className="mt-2 px-1 text-[11px] text-co-cta">{error}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LanguageButton({
  code,
  label,
  active,
  disabled,
  onClick,
  ariaLabel,
}: {
  code: Language;
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
      onClick={onClick}
      disabled={disabled || active}
      className={[
        "flex-1 inline-flex min-h-[44px] items-center justify-center rounded-lg",
        "border-2 px-3 text-sm font-bold uppercase tracking-[0.12em]",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        active
          ? "border-co-gold-deep bg-co-gold text-co-text cursor-default"
          : "border-co-border bg-co-surface text-co-text-muted hover:border-co-gold-deep hover:text-co-text",
        disabled && !active ? "cursor-not-allowed opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {code.toUpperCase()} · {label}
    </button>
  );
}
