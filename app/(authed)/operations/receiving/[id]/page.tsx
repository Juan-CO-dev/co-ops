import { redirect } from "next/navigation";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { loadDeliveryDetail, ReceivingError } from "@/lib/receiving";
import { BackLink } from "@/components/nav/BackLink";
import type { DeliveryDetail } from "@/lib/receiving";

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

      <h2 className="mt-5 text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{serverT(lang, "receiving.detail.items")}</h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {detail.lines.map((l, i) => (
          <li key={i} className="rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-co-text">{l.skuName}</span>
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
    </main>
  );
}
