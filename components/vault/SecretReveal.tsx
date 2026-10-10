"use client";

/**
 * SecretReveal — the only place a vault secret is ever on screen.
 *
 * Spec (Reveal flow): banner "This view is recorded. Management has been notified." (shared),
 * the secret with Copy, auto-hide after 30 s or on navigation, never cached client-side.
 *
 * VaultClient owns the secret and its expiry; row visibility cannot cancel auto-hide.
 * This component only displays the countdown and requests early dismissal.
 * Nothing here logs, stores, or sends the secret anywhere.
 */

import { useCallback, useEffect, useState } from "react";

import { ActionButton } from "@/components/ActionButton";
import { useTranslation } from "@/lib/i18n/provider";
import { VAULT_AUTO_HIDE_SECONDS } from "@/lib/vault-shared";

export type RevealMode = "shared" | "personal" | "recovery";

export interface SecretRevealProps {
  entryName: string;
  secret: string;
  version: number;
  mode: RevealMode;
  /** True when this is a PREVIOUS secret (label says so). */
  previous?: boolean;
  onHide: () => void;
}

export function SecretReveal({ entryName, secret, version, mode, previous = false, onHide }: SecretRevealProps) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(VAULT_AUTO_HIDE_SECONDS);
  const [copied, setCopied] = useState(false);

  // Display-only countdown; the parent lifetime controls actual plaintext expiry.
  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = VAULT_AUTO_HIDE_SECONDS - Math.floor((Date.now() - started) / 1000);
      setSecondsLeft(left > 0 ? left : 0);
    }, 250);
    return () => {
      window.clearInterval(tick);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [secret]);

  const bannerKey = mode === "shared" ? "vault.reveal.recorded_banner" : mode === "personal" ? "vault.reveal.personal_banner" : "vault.reveal.recovery_banner";

  return (
    <section
      role="status"
      aria-live="polite"
      className="rounded-xl border-2 border-co-gold-deep bg-co-surface p-4 shadow-lg"
    >
      <p className={`rounded-md px-3 py-2 text-sm font-semibold ${mode === "personal" ? "bg-co-surface-inset text-co-text" : "bg-co-warning-surface text-co-warning-text"}`}>
        {t(bannerKey)}
      </p>
      <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {previous ? t("vault.reveal.previous_label", { version }) : entryName}
      </p>
      <output
        aria-label={t("vault.reveal.secret_aria")}
        className="mt-1 block break-all rounded-md border-2 border-co-border bg-co-surface-inset px-3 py-3 font-mono text-base text-co-text"
      >
        {secret}
      </output>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionButton type="button" variant="primary" onClick={copy} aria-label={t("vault.reveal.copy_aria")} className="min-h-[44px] items-center">
          {copied ? t("vault.reveal.copied") : t("vault.reveal.copy")}
        </ActionButton>
        <ActionButton type="button" variant="secondary" onClick={onHide} className="min-h-[44px] items-center">
          {t("vault.reveal.hide")}
        </ActionButton>
        <span className="ml-auto text-sm font-semibold text-co-text-muted" aria-live="off">
          {t("vault.reveal.hides_in", { seconds: secondsLeft })}
        </span>
      </div>
    </section>
  );
}
