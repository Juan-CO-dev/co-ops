"use client";

/**
 * delivery-affordances — shared ordering-transmit affordance components + href-hygiene
 * validators, extracted from ParPassWalker so the PO panel (PoPanel.tsx) reuses the EXACT
 * same rendering (reuse-don't-duplicate law). The draft-card DeliveryRow, the Copy button,
 * and the three conservative validators (email / http(s) URL / tel) live here; both the
 * walker's draft cards and the PO's confirmed-state transmit block import them.
 *
 * Untrusted-content law: a navigable affordance renders ONLY when its value passes the
 * conservative validator; Copy is always the fallback. mailto subject/body are
 * URL-encoded (header-injection guard); portal_url and every URL render via isValidHttpUrl.
 *
 * DISPLAY-STRING contract: these components consume the i18n context (useTranslation)
 * directly for their fixed action labels (Email/Open/Call/Copy) — the surface passes the
 * dynamic subject/body/copy text.
 */

import { useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";

// ── Href hygiene helpers (security-adjacent) ─────────────────────────────────────
/** True when `addr` is a syntactically safe email address for a mailto: href.
 *  encodeURIComponent is wrong for the address part (it encodes @); we validate
 *  with a conservative regex instead and render the link only when it passes. */
export function isValidEmail(addr: string): boolean {
  return /^[^\s@?#&]+@[^\s@?#&]+$/.test(addr);
}
/** True when `raw` is an http/https URL. Render the anchor only when valid. */
export function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
/** True when `raw` is a plausible telephone value (digits/+/parens/dash/space, ≥7 digits). */
export function isValidTel(raw: string): boolean {
  const stripped = raw.replace(/[^\d]/g, "");
  return /^[\d+()\-\s]+$/.test(raw) && stripped.length >= 7;
}

export const linkBtn =
  "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-sm font-bold text-co-text hover:bg-co-gold-deep";

/** One delivery affordance the row can render. `method` = email | url | phone | portal | other. */
export interface DeliveryDetail {
  method: string;
  value: string;
  label: string | null;
}

/**
 * One delivery affordance row (method → navigable link + Copy). Extracted verbatim from
 * ParPassWalker's DeliveryRow. `onUse` (optional) reports which affordance was tapped so a
 * caller can prefill a Mark-placed channel/target from it (the PO panel uses this).
 */
export function DeliveryRow({
  detail,
  subject,
  body,
  copyText,
  onUse,
}: {
  detail: DeliveryDetail;
  subject: string;
  body: string;
  copyText: string;
  /** Called with (channel, target) when a navigable affordance is tapped. */
  onUse?: (channel: "email" | "sms" | "phone" | "portal" | "in_person", target: string | null) => void;
}) {
  const { t } = useTranslation();
  const label = detail.label ?? methodLabel(detail.method, t);

  // Href hygiene: each method renders its action link ONLY when the value passes a
  // conservative validation check. Copy is always available as a fallback. mailto:
  // subject + body are URL-encoded (injection guard); the address is validated with
  // isValidEmail (encodeURIComponent encodes @ and is wrong for the address segment).
  let action: React.ReactNode;
  if (detail.method === "email") {
    if (isValidEmail(detail.value)) {
      const mailtoHref = `mailto:${detail.value}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      action = (
        <a href={mailtoHref} className={linkBtn} onClick={() => onUse?.("email", detail.value)}>
          {t("ordering.deliver.email")}
        </a>
      );
    } else {
      action = null; // invalid address → Copy-only.
    }
  } else if (detail.method === "url" || detail.method === "portal") {
    if (isValidHttpUrl(detail.value)) {
      action = (
        <a
          href={detail.value}
          target="_blank"
          rel="noopener noreferrer"
          className={linkBtn}
          onClick={() => onUse?.("portal", detail.value)}
        >
          {t("ordering.deliver.open")}
        </a>
      );
    } else {
      action = null; // non-http(s) value → Copy-only.
    }
  } else if (detail.method === "phone") {
    if (isValidTel(detail.value)) {
      const telHref = `tel:${detail.value.replace(/[^\d+()\-\s]/g, "")}`;
      action = (
        <a href={telHref} className={linkBtn} onClick={() => onUse?.("phone", detail.value)}>
          {t("ordering.deliver.call")}
        </a>
      );
    } else {
      action = null; // implausible tel → Copy-only.
    }
  } else {
    // other / none → copy only (no navigable affordance).
    action = null;
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2">
      <div className="min-w-0">
        <span className="block text-[13px] font-bold text-co-text">{label}</span>
        <span className="block truncate text-[12px] text-co-text-dim">{detail.value}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {action}
        <CopyButton text={detail.method === "email" ? copyText : detail.value} />
      </div>
    </div>
  );
}

/** Copy-to-clipboard with a textual fallback (older/insecure contexts have no
 *  navigator.clipboard). Shows a transient "Copied" state. */
export function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: a hidden textarea + execCommand (deprecated but the last resort).
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — silently no-op (the link affordances still work).
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-bold text-co-text-dim hover:border-co-text"
    >
      {copied ? t("ordering.deliver.copied") : t("ordering.deliver.copy")}
    </button>
  );
}

/** Fallback method label when a detail carries no explicit label. */
export function methodLabel(method: string, t: (k: TranslationKey) => string): string {
  switch (method) {
    case "email":
      return t("ordering.deliver.method_email");
    case "url":
      return t("ordering.deliver.method_url");
    case "portal":
      return t("ordering.deliver.method_portal");
    case "phone":
      return t("ordering.deliver.method_phone");
    default:
      return t("ordering.deliver.method_other");
  }
}
