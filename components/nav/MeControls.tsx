"use client";

/**
 * Go to's "Me" controls (nav PR 9, plan r2 3.1; spec 4.2 "language and sign out"): extracted from the user menu,
 * which it replaces. "Signed in as", the language choice, the profile note for level 6+ and Sign out.
 *
 * - Language: PATCH /api/users/me/language, then `setLanguage(next); router.refresh();` (server strings and the Go to
 *   model only change on a refetch). Pessimistic: the context changes after the 200.
 * - Every request has a deadline (audit W06 round 8): the language and profile-note saves run the request AND the body
 *   they read under SAVE_TIMEOUT_MS (lib/bounded-fetch.ts), so a stalled one releases its button with the error.
 * - Sign out goes through signOutAndBroadcast(sessionId, "logout") (lib/logout-client.ts) behind SigningOutOverlay (which
 *   portals itself to the body, outside the sheet), naming the session this page was served for, then to sign in.
 * - Both saves' session paths are step-up NEUTRAL (lib/session.ts): changing the language on an admin page keeps the
 *   unlock.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/ActionButton";
import { SigningOutOverlay } from "@/components/auth/SigningOutOverlay";
import { withDeadline } from "@/lib/bounded-fetch";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import { signOutAndBroadcast } from "@/lib/logout-client";

/** A language or blurb save that has not answered (headers and body) by then has failed (round 8). */
const SAVE_TIMEOUT_MS = 10_000;

export interface MeProps {
  /** The user's display name. */
  userName: string;
  /** The user's email: shown under the name for context. */
  userEmail?: string | null;
  /** The blurb editor renders only when >= 6 (AGM+). */
  actorLevel: number;
  /** Current saved blurb (null = unset): seeds the editor. */
  initialBlurb: string | null;
  /** The session this page was served for: a retried sign-out names it, so it can never end a newer one. */
  sessionId: string;
}

export function MeControls({ userName, userEmail, actorLevel, initialBlurb, sessionId }: MeProps) {
  const { language, t, setLanguage } = useTranslation();
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<"failed" | "network" | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [blurb, setBlurb] = useState(initialBlurb ?? "");
  const [savedBlurb, setSavedBlurb] = useState(initialBlurb ?? "");
  const [blurbSaving, setBlurbSaving] = useState(false);
  const [blurbStatus, setBlurbStatus] = useState<"idle" | "saved" | "error">("idle");

  // An end the server cannot confirm is retried briefly behind an opaque cover; the other tabs of this session are told
  // once it settles (round 9); then sign in, regardless (intent-honoring).
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    await signOutAndBroadcast(sessionId, "logout");
    router.push("/");
  };

  const handleLanguageSelect = async (next: Language) => {
    if (next === language || updating) return;
    setUpdating(true);
    setError(null);
    try {
      // The request and its error body under one deadline; the state is set after it.
      const answer = await withDeadline(SAVE_TIMEOUT_MS, async (signal) => {
        const res = await fetch("/api/users/me/language", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: next }),
          redirect: "manual",
          signal,
        });
        if (res.ok) return { ok: true as const };
        try { await res.json(); } catch { /* the body is not needed: the message is ours, in the viewer's language */ }
        return { ok: false as const };
      });
      if (answer.ok) {
        setLanguage(next);
        // Server-rendered (serverT) strings, and the Go to model, only change on a refetch (#54).
        router.refresh();
      } else {
        setError("failed");
      }
    } catch {
      setError("network"); // a network failure, or no answer by the deadline
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
      // The request and its success body under one deadline; the state is set after it.
      const answer = await withDeadline(SAVE_TIMEOUT_MS, async (signal) => {
        const res = await fetch("/api/users/me/profile-blurb", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blurb: next }),
          redirect: "manual",
          signal,
        });
        return res.ok ? { ok: true as const, body: (await res.json()) as { blurb: string | null } } : { ok: false as const };
      });
      if (answer.ok) {
        const saved = answer.body.blurb ?? "";
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
    <section aria-labelledby="co-nav-me-heading" data-co-me-controls="" className="border-t-2 border-co-border px-4 py-4">
      {signingOut ? <SigningOutOverlay /> : null}
      <h3 id="co-nav-me-heading" className="text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{t("nav.room.me")}</h3>
      <div className="mt-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("user_menu.signed_in_as")}</div>
        <div className="mt-0.5 text-sm font-semibold text-co-text">{userName}</div>
        {userEmail ? <div className="truncate text-[11px] text-co-text-dim">{userEmail}</div> : null}
      </div>

      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("user_menu.language")}</div>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label={t("user_menu.language")}>
          {(["en", "es"] as const).map((code) => (
            <LanguageButton
              key={code}
              code={code}
              label={t(code === "en" ? "user_menu.language.en" : "user_menu.language.es")}
              active={language === code}
              disabled={updating}
              onClick={() => void handleLanguageSelect(code)}
              ariaLabel={t("user_menu.language.aria_select", { language: t(code === "en" ? "user_menu.language.en" : "user_menu.language.es") })}
            />
          ))}
        </div>
        {updating ? <div className="mt-2 text-[11px] text-co-text-dim">{t("user_menu.language.updating")}</div> : null}
        {error ? (
          <div role="alert" className="mt-2 text-[11px] text-co-cta-text">
            {t(error === "network" ? "user_menu.language.network_error" : "user_menu.language.error")}
          </div>
        ) : null}
      </div>

      {actorLevel >= 6 ? (
        <div className="mt-3">
          <label htmlFor="co-nav-me-blurb" className="text-[10px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
            {t("user_menu.blurb.label")}
          </label>
          <textarea
            id="co-nav-me-blurb"
            aria-label={t("user_menu.blurb.label")}
            value={blurb}
            onChange={(e) => {
              setBlurb(e.target.value.slice(0, 500));
              setBlurbStatus("idle");
            }}
            maxLength={500}
            rows={3}
            placeholder={t("user_menu.blurb.placeholder")}
            className="
              mt-2 w-full resize-none rounded-lg border-2 border-co-border bg-co-surface px-2 py-1.5 text-sm text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-co-text-dim">{t("user_menu.blurb.counter", { n: blurb.trim().length })}</span>
            <ActionButton onClick={() => void handleBlurbSave()} disabled={blurbSaving || blurb.trim() === savedBlurb.trim()}>
              {blurbSaving ? t("user_menu.blurb.saving") : t("user_menu.blurb.save")}
            </ActionButton>
          </div>
          {blurbStatus === "saved" ? <div className="mt-1 text-[11px] text-co-text-dim">{t("user_menu.blurb.saved")}</div> : null}
          {blurbStatus === "error" ? <div className="mt-1 text-[11px] text-co-cta-text">{t("user_menu.blurb.error")}</div> : null}
        </div>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="
            inline-flex min-h-[44px] w-full items-center rounded-lg px-2 text-left text-sm font-semibold text-co-text-muted transition
            hover:bg-co-surface-2 hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          {signingOut ? t("user_menu.signing_out") : t("user_menu.sign_out")}
        </button>
      </div>
    </section>
  );
}

function LanguageButton({ code, label, active, disabled, onClick, ariaLabel }: {
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
        "border-2 px-3 text-sm font-bold uppercase tracking-[0.1em]",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        active
          ? "border-co-gold-deep bg-co-gold text-co-text cursor-default"
          : "border-co-border bg-co-surface text-co-text-muted hover:border-co-gold-deep hover:text-co-text",
        disabled && !active ? "cursor-not-allowed opacity-50" : "",
      ].filter(Boolean).join(" ")}
    >
      {code.toUpperCase()} · {label}
    </button>
  );
}
