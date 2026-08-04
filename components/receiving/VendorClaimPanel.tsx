"use client";

/**
 * VendorClaimPanel — the manager-facing two-way-match compare surface (delivery-intake
 * P2, Task 5). Mounts on the delivery-detail page between continue-intake and Items.
 *
 * TWO SHAPES, driven by whether a receipt is linked:
 *   LINKED   → a side-by-side compare: "What we counted" (the door count) vs "Vendor
 *              claim" (the emailed/uploaded receipt), plus an attestation bar (Matches /
 *              Discrepancy / AGM+ Override). The current match_state shows as an AlertPill.
 *   UNLINKED → an attach affordance (file upload → POST multipart) + a default-collapsed
 *              "Link an existing receipt" disclosure (D3/D4) listing the location's
 *              unlinked receipts with a per-row Link action.
 *
 * UNTRUSTED-CONTENT LAW (house): vendor receipts are external input and NEVER render via
 * dangerouslySetInnerHTML. Rendering by content type (the panel only ever holds SIGNED
 * URLs, never raw bytes):
 *   - application/pdf → <object data> with an open-in-new-tab fallback link.
 *   - image/*         → <img> (a signed URL to a private image is inert markup).
 *   - everything else (text/plain, text/html, message/rfc822 .eml) → an open-in-new-tab
 *     LINK only. We deliberately do NOT inline html/eml: mounting vendor html — even in a
 *     sandboxed iframe — is more attack surface than a link, and the private-bucket signed
 *     URL opens it in the browser's own isolated tab. Link > inline for untrusted markup.
 *
 * SERVER LOADS / CLIENT INTERACTS: every prop is server-fed (loadReceiptForDelivery /
 * listUnlinkedReceipts / the detail lines). This island only shapes display + drives the
 * route (POST upload, PATCH link/attest/override) then router.refresh()es. No business
 * logic; no i18n resolver work beyond t(); no raw-byte handling.
 *
 * GATE: RECEIPT_MIN (4, KH+) mounts the panel; RECEIPT_OVERRIDE_MIN (6, AGM+) sees the
 * Override affordance. Both are mirrored from lib/email-receipts.ts (server-only module)
 * — the API re-checks; these inlined thresholds are convenience-only. Keep in sync.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import type { TranslationKey } from "@/lib/i18n/types";
import type { DeliveryReceiptView, UnlinkedReceiptView, ReceiptAsset } from "@/lib/email-receipts";
import type { DeliveryMatchState } from "@/lib/receiving";

/** Mirror of lib/email-receipts.ts RECEIPT_OVERRIDE_MIN (server-only module). */
const RECEIPT_OVERRIDE_MIN = 6;
/** 15 MB — mirrors the route's MAX_RECEIPT_BYTES; a client-side pre-check for a friendly
 *  error before we spend the upload. The route re-checks (413). */
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
/** File-picker accept list — the receipts bucket allow-list (0170) minus the exotic
 *  image types the OS picker names for us via image/*. */
const RECEIPT_ACCEPT = ".pdf,.eml,image/*,.txt,.html";

const API = "/api/operations/receiving/email-receipts";

export interface CountedSummaryLine {
  skuName: string;
  qty: number;
  level: string | null;
}

/** match_state → its pill tone + label key. counted_only is neutral (info) — no verdict
 *  yet; matched = ok; discrepant = warn; override = info (a manager forced a resolution). */
function matchTone(state: DeliveryMatchState): AlertPillTone {
  switch (state) {
    case "matched": return "ok";
    case "discrepant": return "warn";
    case "override": return "info";
    default: return "info";
  }
}
function matchKey(state: DeliveryMatchState): TranslationKey {
  switch (state) {
    case "matched": return "receiving.claim.state.matched";
    case "discrepant": return "receiving.claim.state.discrepant";
    case "override": return "receiving.claim.state.override";
    default: return "receiving.claim.state.counted_only";
  }
}

/**
 * Render one vendor-claim asset by content type. Untrusted-content law: images inline as
 * inert <img>; PDFs via <object> + fallback link; everything else (text/html/eml) is a
 * link ONLY — vendor markup is never mounted in our DOM. A null signedUrl (omitted or
 * sign-failed) renders an honest "unavailable" line rather than a broken frame.
 */
function ClaimAsset({ asset, t }: { asset: ReceiptAsset; t: (k: TranslationKey, p?: Record<string, string | number>) => string }) {
  const isPdf = asset.contentType.split(";")[0]?.trim().toLowerCase() === "application/pdf";
  const isImage = asset.contentType.split(";")[0]?.trim().toLowerCase().startsWith("image/");

  if (!asset.signedUrl) {
    return (
      <div className="rounded-lg border-2 border-dashed border-co-border bg-co-surface px-3 py-2 text-[11px] text-co-text-dim">
        {asset.filename} · {t("receiving.claim.asset_unavailable")}
      </div>
    );
  }

  if (isImage) {
    // A signed URL to a private receipts-bucket object — not an app asset, so Next's
    // <Image> optimizer can't fetch it; plain <img> is correct here.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.signedUrl}
        alt={t("receiving.claim.asset_image_alt", { name: asset.filename })}
        className="w-full rounded-lg border-2 border-co-border-2 bg-co-surface"
      />
    );
  }

  if (isPdf) {
    return (
      <object
        data={asset.signedUrl}
        type="application/pdf"
        className="h-[60vh] w-full rounded-lg border-2 border-co-border-2 bg-co-surface"
        aria-label={t("receiving.claim.asset_pdf_label", { name: asset.filename })}
      >
        <a
          href={asset.signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center px-3 font-bold text-co-cta underline"
        >
          {t("receiving.claim.open_new_tab", { name: asset.filename })}
        </a>
      </object>
    );
  }

  // text/plain, text/html, message/rfc822 (.eml), or anything else — link ONLY. Never
  // inline untrusted vendor markup (untrusted-content law).
  return (
    <a
      href={asset.signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm font-bold text-co-text transition hover:border-co-text"
    >
      {t("receiving.claim.open_new_tab", { name: asset.filename })}
    </a>
  );
}

/** The vendor-claim column: subject/from/received meta + the raw .eml (as a link, when
 *  inbound) + every attachment rendered by its content type. */
function VendorClaimColumn({ receipt, t }: { receipt: DeliveryReceiptView; t: (k: TranslationKey, p?: Record<string, string | number>) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-co-text-dim">
        {receipt.subject ? <p className="font-semibold text-co-text-muted">{receipt.subject}</p> : null}
        {receipt.fromAddress ? <p>{t("receiving.claim.from", { addr: receipt.fromAddress })}</p> : null}
        <p>{t("receiving.claim.received", { date: receipt.receivedAt.slice(0, 10) })}</p>
        <p className="uppercase tracking-[0.08em]">
          {receipt.source === "inbound" ? t("receiving.claim.source_inbound") : t("receiving.claim.source_upload")}
        </p>
      </div>

      {/* Raw .eml (inbound only) — link, never inlined. */}
      {receipt.rawUrl ? (
        <a
          href={receipt.rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text"
        >
          {t("receiving.claim.open_raw_email")}
        </a>
      ) : null}

      {receipt.attachments.length > 0 ? (
        <div className="flex flex-col gap-2">
          {receipt.attachments.map((a, i) => (
            <ClaimAsset key={i} asset={a} t={t} />
          ))}
        </div>
      ) : receipt.rawUrl ? null : (
        <p className="text-[11px] italic text-co-text-muted">{t("receiving.claim.no_assets")}</p>
      )}
    </div>
  );
}

export function VendorClaimPanel({
  deliveryId,
  locationId,
  actorLevel,
  receipt,
  countedSummary,
  matchState,
  unlinked,
}: {
  deliveryId: string;
  locationId: string;
  actorLevel: number;
  receipt: DeliveryReceiptView | null;
  countedSummary: CountedSummaryLine[];
  matchState: DeliveryMatchState;
  /** The location's unlinked receipts — only populated (server-side) when this delivery
   *  has NO linked receipt. Empty/undefined otherwise. */
  unlinked?: UnlinkedReceiptView[];
  /** Optional server-passed language; the island reads live via useTranslation (matching
   *  the CreditResolveControls idiom), so this is accepted but unused. */
  lang?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const canOverride = actorLevel >= RECEIPT_OVERRIDE_MIN;

  // Attestation state (linked view).
  const [mode, setMode] = useState<"idle" | "discrepancy" | "override">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Upload state (unlinked view).
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const overridden = matchState === "override";

  const showError = (code: string | undefined) =>
    setErr(t(("receiving.claim.error." + (code ?? "generic")) as TranslationKey));

  const resetAttest = () => {
    setMode("idle");
    setNote("");
    setErr(null);
  };

  // PATCH attest matched / discrepant.
  const attest = async (verdict: "matched" | "discrepant") => {
    if (busy) return;
    if (verdict === "discrepant" && mode !== "discrepancy") {
      setMode("discrepancy");
      setErr(null);
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(API, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveryId,
        action: "attest",
        verdict,
        note: verdict === "discrepant" ? note.trim() || undefined : undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      resetAttest();
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    showError(j?.code);
  };

  // PATCH override (AGM+, note required).
  const override = async () => {
    if (busy) return;
    if (!note.trim()) {
      setErr(t("receiving.claim.error.note_required"));
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(API, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliveryId, action: "override", note: note.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      resetAttest();
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    showError(j?.code);
  };

  // POST multipart upload → link to this delivery.
  const onFile = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploadErr(null);
    if (file.size > MAX_RECEIPT_BYTES) {
      setUploadErr(t("receiving.claim.error.file_too_large"));
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("locationId", locationId);
    fd.append("deliveryId", deliveryId);
    fd.append("file", file);
    const res = await fetch(API, { method: "POST", body: fd });
    setUploading(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    setUploadErr(t(("receiving.claim.error." + (j?.code ?? "generic")) as TranslationKey));
  };

  // PATCH link an existing receipt.
  const linkReceipt = async (receiptId: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(API, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deliveryId, action: "link", receiptId }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    const j = (await res.json().catch(() => ({}))) as { code?: string };
    showError(j?.code);
  };

  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {t("receiving.claim.section_title")}
        </h2>
        {/* match_state is an alert — always visible (D2). */}
        <AlertPill tone={matchTone(matchState)}>{t(matchKey(matchState))}</AlertPill>
      </div>

      {receipt ? (
        // ── LINKED: side-by-side compare + attestation bar ──────────────────────────
        <>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            {/* Left: what we counted at the door. */}
            <div className="rounded-lg border-2 border-co-border-2 bg-co-surface p-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted">
                {t("receiving.claim.counted_title")}
              </h3>
              {countedSummary.length === 0 ? (
                <p className="mt-2 text-[11px] italic text-co-text-muted">{t("receiving.claim.counted_empty")}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {countedSummary.map((l, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-semibold text-co-text">{l.skuName}</span>
                      <span className="shrink-0 text-xs text-co-text-muted">
                        {l.level
                          ? t("receiving.claim.counted_qty_level", { qty: l.qty, level: l.level })
                          : t("receiving.claim.counted_qty", { qty: l.qty })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Right: the vendor's claim (untrusted — rendered per content-type law). */}
            <div className="rounded-lg border-2 border-co-border-2 bg-co-surface p-3">
              <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted">
                {t("receiving.claim.vendor_title")}
              </h3>
              <div className="mt-2">
                <VendorClaimColumn receipt={receipt} t={t} />
              </div>
            </div>
          </div>

          {/* Attestation bar. Hidden once overridden (terminal — the lib rejects re-attest). */}
          {overridden ? (
            <p className="mt-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-[11px] text-co-text-dim">
              {t("receiving.claim.override_locked")}
            </p>
          ) : (
            <div className="mt-3 rounded-lg border-2 border-dashed border-co-border p-2">
              {mode === "override" ? (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-co-text-dim" htmlFor={`claim-override-note-${deliveryId}`}>
                    {t("receiving.claim.override_note_label")}
                  </label>
                  <input
                    id={`claim-override-note-${deliveryId}`}
                    className="min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60"
                    value={note}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("receiving.claim.override_note_placeholder")}
                    aria-label={t("receiving.claim.override_note_label")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void override()}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold text-co-text transition hover:bg-co-gold-deep disabled:opacity-50"
                    >
                      {t("receiving.claim.override_confirm")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={resetAttest}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:border-co-text disabled:opacity-50"
                    >
                      {t("receiving.claim.cancel")}
                    </button>
                  </div>
                </div>
              ) : mode === "discrepancy" ? (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-co-text-dim" htmlFor={`claim-disc-note-${deliveryId}`}>
                    {t("receiving.claim.discrepancy_note_label")}
                  </label>
                  <input
                    id={`claim-disc-note-${deliveryId}`}
                    className="min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60"
                    value={note}
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("receiving.claim.discrepancy_note_placeholder")}
                    aria-label={t("receiving.claim.discrepancy_note_label")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void attest("discrepant")}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold text-co-text transition hover:bg-co-gold-deep disabled:opacity-50"
                    >
                      {t("receiving.claim.discrepancy_confirm")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={resetAttest}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:border-co-text disabled:opacity-50"
                    >
                      {t("receiving.claim.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-co-text-dim">{t("receiving.claim.attest_prompt")}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void attest("matched")}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold text-co-text transition hover:bg-co-gold-deep disabled:opacity-50"
                  >
                    {t("receiving.claim.attest_matches")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void attest("discrepant")}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text disabled:opacity-50"
                  >
                    {t("receiving.claim.attest_discrepancy")}
                  </button>
                  {canOverride ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMode("override");
                        setNote("");
                        setErr(null);
                      }}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-danger bg-co-surface px-3 text-xs font-bold text-co-danger transition hover:bg-co-danger-surface disabled:opacity-50"
                    >
                      {t("receiving.claim.attest_override")}
                    </button>
                  ) : null}
                </div>
              )}
              {err ? <p className="mt-2 text-xs text-co-danger">{err}</p> : null}
            </div>
          )}
        </>
      ) : (
        // ── UNLINKED: attach + link-existing ────────────────────────────────────────
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-[11px] text-co-text-dim">{t("receiving.claim.no_receipt_hint")}</p>

          {/* Attach an emailed/paper receipt (POST multipart). */}
          <div className="rounded-lg border-2 border-co-border-2 bg-co-surface p-3">
            <label className="text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted" htmlFor={`claim-file-${deliveryId}`}>
              {t("receiving.claim.attach_title")}
            </label>
            <input
              id={`claim-file-${deliveryId}`}
              type="file"
              accept={RECEIPT_ACCEPT}
              disabled={uploading}
              onChange={(e) => void onFile(e.target.files?.[0])}
              aria-label={t("receiving.claim.attach_title")}
              className="mt-2 block w-full text-sm text-co-text file:mr-3 file:min-h-[44px] file:rounded-lg file:border-2 file:border-co-gold-deep file:bg-co-gold file:px-3 file:text-xs file:font-bold file:text-co-text disabled:opacity-60"
            />
            {uploading ? <p className="mt-2 text-[11px] text-co-text-dim">{t("receiving.claim.uploading")}</p> : null}
            {uploadErr ? <p className="mt-2 text-xs text-co-danger">{uploadErr}</p> : null}
          </div>

          {/* Link an existing unlinked receipt — SECONDARY, default-collapsed (D3/D4). */}
          <CollapsibleSection
            idBase={`claim-link-existing-${deliveryId}`}
            title={t("receiving.claim.link_existing_title")}
            count={t("receiving.claim.link_existing_count", { n: unlinked?.length ?? 0 })}
          >
            {!unlinked || unlinked.length === 0 ? (
              <p className="text-[11px] italic text-co-text-muted">{t("receiving.claim.link_existing_empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {unlinked.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-co-text">
                        {r.subject || t("receiving.claim.link_no_subject")}
                      </span>
                      <span className="block text-[11px] text-co-text-dim">
                        {r.fromAddress ? `${r.fromAddress} · ` : ""}
                        {r.receivedAt.slice(0, 10)}
                        {r.locationId == null ? ` · ${t("receiving.claim.link_unattributed")}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void linkReceipt(r.id)}
                      className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text disabled:opacity-50"
                    >
                      {t("receiving.claim.link_action")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {err ? <p className="mt-2 text-xs text-co-danger">{err}</p> : null}
          </CollapsibleSection>
        </div>
      )}
    </section>
  );
}
