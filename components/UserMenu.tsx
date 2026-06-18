"use client";

/**
 * UserMenu — small dropdown affordance in the top-right of authenticated
 * page surfaces. Per SPEC_AMENDMENTS.md C.31's PR 5 design lock:
 *
 *   - Compact trigger using user initial (avatar-style circle), not text
 *     (closing-page header already shows location code + name; another
 *     text affordance would crowd)
 *   - Language toggle (en / es)
 *   - Dashboard link + Sign out (added 2026-06-13 to fix the dead-end-page
 *     class — operations surfaces had no global logout/back-to-dashboard; the
 *     only global chrome was this menu's language toggle). Sign out mirrors
 *     LogoutButton's flow; the Dashboard link auto-hides on /dashboard. The
 *     top-left BackToDashboard pill is the redundant-by-design companion.
 *   - Built as foundation for future expansion (password change,
 *     notification prefs, etc.) — name is UserMenu, not LanguageSelector
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";

interface UserMenuProps {
  /** User's display name — used to derive the initial for the trigger. */
  userName: string;
  /** User's email — shown in the menu header for context. */
  userEmail?: string | null;
  /** Actor's role level — the blurb editor renders only when >= 6 (AGM+). */
  actorLevel: number;
  /** Current saved blurb (null = unset) — seeds the editor. */
  initialBlurb: string | null;
}

export function UserMenu({ userName, userEmail, actorLevel, initialBlurb }: UserMenuProps) {
  const { language, t, setLanguage } = useTranslation();
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initial = (userName.trim()[0] ?? "?").toUpperCase();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [blurb, setBlurb] = useState(initialBlurb ?? "");
  const [savedBlurb, setSavedBlurb] = useState(initialBlurb ?? "");
  const [blurbSaving, setBlurbSaving] = useState(false);
  const [blurbStatus, setBlurbStatus] = useState<"idle" | "saved" | "error">("idle");

  // Mirrors LogoutButton: POST /api/auth/logout (idempotent, public path —
  // server clears the cookie regardless of session state), then navigate to
  // the login surface regardless of outcome (logout is intent-honoring).
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
    } catch {
      // Intent-honoring: navigate regardless.
    }
    router.push("/");
  };

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

  const handleBlurbSave = async () => {
    const next = blurb.trim();
    if (blurbSaving || next === savedBlurb.trim()) return;
    setBlurbSaving(true);
    setBlurbStatus("idle");
    try {
      const res = await fetch("/api/users/me/profile-blurb", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blurb: next }),
        redirect: "manual",
      });
      if (res.ok) {
        const body = (await res.json()) as { blurb: string | null };
        const saved = body.blurb ?? "";
        setSavedBlurb(saved);
        setBlurb(saved);
        setBlurbStatus("saved");
      } else {
        setBlurbStatus("error");
      }
    } catch {
      setBlurbStatus("error");
    } finally {
      setBlurbSaving(false);
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
            absolute right-0 top-12 z-30 w-72 rounded-xl border-2 border-co-border
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

          {actorLevel >= 6 ? (
            <div className="mt-3 border-t border-co-border-2 pt-3">
              <div className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                {t("user_menu.blurb.label")}
              </div>
              <textarea
                value={blurb}
                onChange={(e) => {
                  setBlurb(e.target.value.slice(0, 500));
                  setBlurbStatus("idle");
                }}
                maxLength={500}
                rows={3}
                placeholder={t("user_menu.blurb.placeholder")}
                className="
                  mt-2 w-full resize-none rounded-lg border-2 border-co-border bg-co-surface
                  px-2 py-1.5 text-sm text-co-text
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              />
              <div className="mt-1 flex items-center justify-between px-1">
                <span className="text-[11px] text-co-text-dim">
                  {t("user_menu.blurb.counter", { n: blurb.trim().length })}
                </span>
                <button
                  type="button"
                  onClick={() => void handleBlurbSave()}
                  disabled={blurbSaving || blurb.trim() === savedBlurb.trim()}
                  className="
                    inline-flex min-h-[36px] items-center rounded-lg border-2 border-co-gold-deep
                    bg-co-gold px-3 text-sm font-bold uppercase tracking-[0.1em] text-co-text
                    transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                    disabled:cursor-not-allowed disabled:opacity-50
                  "
                >
                  {blurbSaving ? t("user_menu.blurb.saving") : t("user_menu.blurb.save")}
                </button>
              </div>
              {blurbStatus === "saved" ? (
                <div className="mt-1 px-1 text-[11px] text-co-text-dim">{t("user_menu.blurb.saved")}</div>
              ) : null}
              {blurbStatus === "error" ? (
                <div className="mt-1 px-1 text-[11px] text-co-cta">{t("user_menu.blurb.error")}</div>
              ) : null}
            </div>
          ) : null}

          {/* Navigation + session actions — fixes the dead-end-page class. */}
          <div className="mt-3 flex flex-col gap-1 border-t border-co-border-2 pt-3">
            {pathname !== "/dashboard" ? (
              <Link
                href="/dashboard"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="
                  inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm
                  font-semibold text-co-text transition hover:bg-co-surface-2
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              >
                {t("nav.dashboard")}
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="
                inline-flex min-h-[44px] items-center rounded-lg px-2 text-left
                text-sm font-semibold text-co-text-muted transition
                hover:bg-co-surface-2 hover:text-co-text
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
            >
              {signingOut ? t("user_menu.signing_out") : t("user_menu.sign_out")}
            </button>
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
