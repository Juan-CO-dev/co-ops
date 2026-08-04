import Link from "next/link";
import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadDeliveryDetail, ReceivingError } from "@/lib/receiving";
import { loadCreditsForDelivery, CreditError } from "@/lib/credits";
import {
  loadReceiptForDelivery,
  listUnlinkedReceipts,
  EmailReceiptError,
} from "@/lib/email-receipts";
import { BackLink } from "@/components/nav/BackLink";
import { AlertPill } from "@/components/ui/AlertPill";
import { CreditResolveControls } from "@/components/receiving/CreditResolveControls";
import { VendorClaimPanel } from "@/components/receiving/VendorClaimPanel";
import type { DeliveryDetail } from "@/lib/receiving";
import type { CreditRow } from "@/lib/credits";
import type { DeliveryReceiptView, UnlinkedReceiptView } from "@/lib/email-receipts";
import type { TranslationKey } from "@/lib/i18n/types";

/** Per-line discrepancy flag → its i18n label key (shared with the door form flags). */
const FLAG_KEY: Record<NonNullable<DeliveryDetail["lines"][number]["discrepancyType"]>, TranslationKey> = {
  short: "receiving.flag.short",
  over: "receiving.flag.over",
  damaged: "receiving.flag.damaged",
  substitution: "receiving.flag.sub",
};

export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSessionFromHeaders("/operations/receiving");
  const { id } = await params;
  if (auth.level < 4) redirect("/dashboard");
  const lang = auth.user.language;

  let detail: DeliveryDetail;
  try {
    detail = await loadDeliveryDetail(auth, id);
  } catch (e) {
    if (e instanceof ReceivingError) redirect("/dashboard");
    throw e;
  }

  // Credits filed against this delivery + the linked email receipt (vendor claim). Both
  // are KH+ read gates in their libs; a CreditError/EmailReceiptError here is the same
  // 404/location-bind failure as the delivery load → dashboard.
  let credits: CreditRow[] = [];
  let receipt: DeliveryReceiptView | null = null;
  try {
    [credits, receipt] = await Promise.all([
      loadCreditsForDelivery(auth, id),
      loadReceiptForDelivery(auth, id),
    ]);
  } catch (e) {
    if (e instanceof CreditError || e instanceof EmailReceiptError) redirect("/dashboard");
    throw e;
  }

  // The two-way-match compare panel. When NO receipt is linked, load the location's
  // unlinked-receipt triage queue server-side so the manager can link an existing one
  // (the panel keeps that list default-collapsed per the disclosure doctrine). When a
  // receipt IS linked, the queue is irrelevant → don't spend the query.
  let unlinked: UnlinkedReceiptView[] = [];
  if (receipt === null) {
    try {
      unlinked = await listUnlinkedReceipts(auth, detail.locationId);
    } catch (e) {
      if (e instanceof EmailReceiptError) redirect("/dashboard");
      throw e;
    }
  }

  // "What we counted" summary for the compare panel — the already-loaded detail lines,
  // shaped to the panel's contract (server builds it; the client only displays).
  const countedSummary = detail.lines.map((l) => ({
    skuName: l.skuName,
    qty: l.qtyReceived,
    level: l.receivedLevelLabel,
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <BackLink />
      <h1 className="text-lg font-bold text-co-text">{detail.vendorName}</h1>
      <p className="mt-1 text-sm text-co-text-muted">
        {detail.deliveryDate}
        {detail.invoiceNumber ? ` · #${detail.invoiceNumber}` : ""}
        {detail.receivedByName ? ` · ${serverT(lang, "receiving.detail.received_by")} ${detail.receivedByName}` : ""}
      </p>
      {detail.invoiceTotal != null ? (
        <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "receiving.detail.invoice_total")}: ${detail.invoiceTotal.toFixed(2)}</p>
      ) : null}
      {detail.notes ? <p className="mt-2 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm text-co-text">{detail.notes}</p> : null}
      {detail.receiptUrl ? (
        <p className="mt-2 text-[11px] text-co-text-dim">
          <a
            href={detail.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-co-text-muted underline underline-offset-2 hover:text-co-text"
          >
            {serverT(lang, "receiving.detail.receipt_attached")}
          </a>
        </p>
      ) : null}

      {/* Header alert badges (D2 — always visible): match discrepancy, missing
          receipt photo, in-progress door. */}
      {detail.matchState === "discrepant" || detail.receiptUrl === null || detail.deliveryStatus === "in_progress" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {detail.matchState === "discrepant" ? (
            <AlertPill tone="warn">{serverT(lang, "receiving.badge.discrepant")}</AlertPill>
          ) : null}
          {detail.receiptUrl === null ? (
            <AlertPill tone="warn">{serverT(lang, "receiving.badge.photo_missing")}</AlertPill>
          ) : null}
          {detail.deliveryStatus === "in_progress" ? (
            <AlertPill tone="info">{serverT(lang, "receiving.badge.in_progress")}</AlertPill>
          ) : null}
        </div>
      ) : null}

      {/* Continue-intake affordance (decision 3 — link + note only). Full continue-
          mode hydration (seeding the door form with this in-progress delivery's lines)
          is DEFERRED: this ships the note + a Link back to the receiving form for the
          same location, where the manager re-opens the delivery. */}
      {detail.deliveryStatus === "in_progress" ? (
        <div className="mt-3 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2">
          <p className="text-[13px] text-co-text">{serverT(lang, "receiving.detail.continue_note")}</p>
          <Link
            href={`/operations/receiving?location=${encodeURIComponent(detail.locationId)}`}
            className="mt-1 inline-flex min-h-[44px] items-center font-bold text-co-cta underline"
          >
            {serverT(lang, "receiving.detail.continue_intake")}
          </Link>
        </div>
      ) : null}

      {/* Vendor-claim two-way-match compare + link/attest (client island). Server-fed
          receipt + counted summary + unlinked queue; the island drives the API. */}
      <VendorClaimPanel
        deliveryId={detail.id}
        locationId={detail.locationId}
        actorLevel={auth.level}
        receipt={receipt}
        countedSummary={countedSummary}
        matchState={detail.matchState}
        unlinked={unlinked}
        lang={lang}
      />

      <h2 className="mt-5 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "receiving.detail.items")}</h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {detail.lines.map((l, i) => (
          <li key={i} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-co-text">{l.skuName}</span>
                {/* Per-line discrepancy chip (D2 — always visible). */}
                {l.discrepancyType ? (
                  <AlertPill tone="warn">{serverT(lang, FLAG_KEY[l.discrepancyType])}</AlertPill>
                ) : null}
              </span>
              <span className="text-xs text-co-text-muted">
                {l.receivedLevelLabel
                  ? `${l.qtyReceived} ${l.receivedLevelLabel}`
                  : `${l.qtyReceived} ${serverT(lang, "receiving.detail.packs")}`}
              </span>
            </div>
            <div className="text-[11px] text-co-text-dim">
              {l.unitPrice != null ? `$${l.unitPrice.toFixed(2)}/pack` : serverT(lang, "receiving.detail.no_price")}
              {l.resolvedOz != null ? ` · ${serverT(lang, "receiving.detail.resolved_oz", { oz: l.resolvedOz.toFixed(1) })}` : ""}
              {l.observedOzPerEach != null ? ` · ${l.observedOzPerEach} oz/each` : ""}
              {l.photoUrl ? (
                <>
                  {" · "}
                  <a
                    href={l.photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold underline underline-offset-2 hover:text-co-text"
                  >
                    {serverT(lang, "receiving.detail.has_photo")}
                  </a>
                </>
              ) : null}
              {l.notes ? ` · ${l.notes}` : ""}
            </div>
          </li>
        ))}
      </ul>

      {/* Vendor credits for this delivery + AGM+ resolve controls (client island). */}
      <CreditResolveControls credits={credits} actorLevel={auth.level} />
    </main>
  );
}
