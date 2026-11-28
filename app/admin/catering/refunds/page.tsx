/**
 * /admin/catering/refunds — the catering refunds INVENTORY (Part B1 v2, plan 4.2 / DR9 / [T6] / [DR12]): the page CC
 * and Juan sign the observe step off on (runbook step 4). Server component, READ ONLY: no button, no form, no client
 * island, no Stripe call; ONE database read (0359 F15 through lib/catering/refund-inventory.ts). No nav link.
 *
 * Gates, in this order:
 *   1. the session (the admin layout already required one; this names the page's own path);
 *   2. `CATERING_REFUNDS_OBSERVE` unset -> notFound() for EVERYONE, so with the switch off the route is what main
 *      serves (no such page) whoever asks;
 *   3. Owner / CGS BY ROLE (never by level); anyone else gets the house admin refusal (back to the catering hub, as
 *      the sibling catering admin pages do).
 * It shows ids, cents, states, reasons and instants only: no customer or staff data.
 */
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/PageHeader";
import { cateringRefundsObserveOn } from "@/lib/catering/refunds-shared";
import { REFUND_INVENTORY_COUNTS, loadRefundInventory, type RefundInventory, type RefundInventoryResult } from "@/lib/catering/refund-inventory";
import { formatCents, formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import { etCalendarDate } from "@/lib/operational-day";
import type { RoleCode } from "@/lib/roles";
import { requireSessionFromHeaders } from "@/lib/session";

/** The two roles that sign the inventory off. A ROLE list, never a level. */
const INVENTORY_ROLES: readonly RoleCode[] = ["owner", "cgs"];

const LIST_KEYS = ["not_complete", "never_read", "dirty", "open_reads", "disagreements", "unresolved_requests", "claims"] as const;

export default async function CateringRefundsInventoryPage() {
  const auth = await requireSessionFromHeaders("/admin/catering/refunds");
  if (!cateringRefundsObserveOn(process.env)) notFound();
  if (!INVENTORY_ROLES.includes(auth.role)) redirect("/admin/catering");

  const lang = auth.user.language;
  const t = (key: TranslationKey, params?: TranslationParams) => serverT(lang, key, params);
  let result: RefundInventoryResult | null = null;
  try {
    result = await loadRefundInventory();
  } catch {
    // A failed read is said, never shown as an empty inventory.
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("admin.cateringRefunds.title")} subtitle={t("admin.cateringRefunds.subtitle")} />
      {result === null ? (
        <p role="alert" className="text-sm font-semibold text-co-cta-text">{t("admin.cateringRefunds.unavailable")}</p>
      ) : result.state === "not_installed" ? (
        <p role="status" className="text-sm font-semibold text-co-warning-text">{t("admin.cateringRefunds.not_installed")}</p>
      ) : (
        <InventoryView inv={result.inventory} lang={lang} />
      )}
    </div>
  );
}

function InventoryView({ inv, lang }: { inv: RefundInventory; lang: Language }) {
  const t = (key: TranslationKey, params?: TranslationParams) => serverT(lang, key, params);
  const when = (iso: string | null) => (iso ? `${formatDateLabel(etCalendarDate(iso), lang)} ${formatTime(iso, lang)}` : t("admin.cateringRefunds.never"));
  const cents = (c: number | null) => (c === null ? "" : formatCents(c, lang));
  const yn = (b: boolean | null) => (b === null ? "" : t(b ? "admin.cateringRefunds.yes" : "admin.cateringRefunds.no"));
  const f = (k: string) => t(`admin.cateringRefunds.field.${k}` as TranslationKey);
  const o = inv.observation;
  const row = (parts: Array<[string, string | null]>) =>
    parts.filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${f(k)} ${v}`).join(" · ");
  const lists: Record<(typeof LIST_KEYS)[number], string[]> = {
    not_complete: inv.lists.notComplete.map((x) => row([["payment", x.paymentId], ["reason", x.reason], ["conflict_with", x.conflictWith], ["attempted_at", x.attemptedAt ? when(x.attemptedAt) : null]])),
    never_read: inv.lists.neverRead.map((id) => row([["payment", id]])),
    dirty: inv.lists.dirty.map((id) => row([["payment", id]])),
    open_reads: inv.lists.openReads.map((x) => row([["payment", x.paymentId], ["started_at", x.startedAt ? when(x.startedAt) : null], ["abandoned", yn(x.abandoned)]])),
    disagreements: inv.lists.disagreements.map((x) => row([["payment", x.paymentId], ["status", x.status], ["captured", cents(x.capturedCents)], ["counted", cents(x.countedCents)], ["stripe_whole", yn(x.stripeWhole)]])),
    unresolved_requests: inv.lists.unresolvedRequests.map((x) => row([
      ["request", x.requestId], ["payment", x.paymentId], ["amount", cents(x.amountCents)], ["armed", yn(x.armed)],
      ["armed_at", x.armedAt ? when(x.armedAt) : null], ["releasable_at", x.releasableAt ? when(x.releasableAt) : null],
      ["requested_at", x.requestedAt ? when(x.requestedAt) : null], ["legacy", x.legacy ? yn(true) : null], ["last_error", x.lastErrorCode],
    ])),
    claims: inv.lists.claims.map((x) => row([["refund", x.refundId], ["payment", x.paymentId], ["kind", x.kind], ["amount", cents(x.amountCents)], ["status", x.status], ["attachable_to", x.attachableTo]])),
  };
  const section = "co-card flex flex-col gap-2 p-4";
  const h = "text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim";

  return (
    <div className="flex flex-col gap-4" data-testid="refund-inventory">
      <p className="text-xs text-co-text-dim">{t("admin.cateringRefunds.generated", { when: when(inv.generatedAt) })}</p>

      <section className={section} data-testid="inventory-observation">
        <h2 className={h}>{t("admin.cateringRefunds.observation.heading")}</h2>
        <p className={`text-sm font-semibold ${o.observeOn ? "text-co-text" : "text-co-cta-text"}`}>
          {t(o.observeOn ? "admin.cateringRefunds.observation.recorded_on" : "admin.cateringRefunds.observation.recorded_off")}
        </p>
        <p className="text-sm text-co-text">{t("admin.cateringRefunds.observation.transitions", { n: o.transitions ?? 0, when: when(o.transitionedAt) })}</p>
        <p className={`text-sm font-semibold ${o.live ? "text-co-confirm-text" : "text-co-cta-text"}`}>
          {t(o.live ? "admin.cateringRefunds.observation.live" : "admin.cateringRefunds.observation.not_live")}
        </p>
        {o.resumedAt && <p className="text-xs text-co-text-muted">{t("admin.cateringRefunds.observation.resumed", { when: when(o.resumedAt) })}</p>}
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2" data-testid="inventory-claim-and-pass">
          <div className="flex flex-col">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("admin.cateringRefunds.observation.last_claim")}</dt>
            <dd className="text-co-text" data-testid="inventory-last-claim">{when(o.lastClaimAt)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("admin.cateringRefunds.observation.last_pass")}</dt>
            <dd className="text-co-text" data-testid="inventory-last-pass">
              {when(o.lastPassEndedAt)}
              {o.lastPassEndedAt && ` (${t("admin.cateringRefunds.observation.pass_reads", { reads: o.lastPassReads ?? 0, complete: o.lastPassComplete ?? 0 })})`}
            </dd>
          </div>
        </dl>
        {o.claimNewerThanPass && (
          <p role="alert" className="rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2 text-sm font-semibold text-co-warning-text" data-testid="inventory-claim-newer">
            {t("admin.cateringRefunds.observation.claim_newer")}
          </p>
        )}
        <p className="text-sm text-co-text" data-testid="inventory-oldest-unchecked">
          {inv.oldestUncheckedAt ? t("admin.cateringRefunds.observation.oldest_unchecked", { when: when(inv.oldestUncheckedAt) }) : t("admin.cateringRefunds.observation.oldest_unchecked_none")}
        </p>
        {inv.oldestReadStartedAt && <p className="text-xs text-co-text-muted">{t("admin.cateringRefunds.observation.oldest_read", { when: when(inv.oldestReadStartedAt) })}</p>}
      </section>

      <section className={section} data-testid="inventory-counts">
        <h2 className={h}>{t("admin.cateringRefunds.counts.heading")}</h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {REFUND_INVENTORY_COUNTS.map((k) => (
            <div key={k} className="contents">
              <dt className="text-co-text-muted">{t(`admin.cateringRefunds.counts.${k}` as TranslationKey)}</dt>
              <dd className="text-right tabular-nums text-co-text" data-count={k}>{inv.counts[k]}</dd>
            </div>
          ))}
        </dl>
        {Object.keys(inv.notCompleteByReason).length > 0 && (
          <p className="text-xs text-co-text-muted">
            {t("admin.cateringRefunds.by_reason")}: {Object.entries(inv.notCompleteByReason).map(([k, n]) => `${k} ${n}`).join(" · ")}
          </p>
        )}
        {Object.keys(inv.claimsByKind).length > 0 && (
          <p className="text-xs text-co-text-muted">
            {t("admin.cateringRefunds.by_kind")}: {Object.entries(inv.claimsByKind).map(([k, n]) => `${k} ${n}`).join(" · ")}
          </p>
        )}
        <p className="text-sm font-semibold text-co-warning-text" data-testid="inventory-unsettled">{t("admin.cateringRefunds.unsettled", { n: inv.unsettledCheckouts })}</p>
      </section>

      {LIST_KEYS.map((k) => (
        <section key={k} className={section} data-testid={`inventory-list-${k}`}>
          <h2 className={h}>{t(`admin.cateringRefunds.lists.heading.${k}` as TranslationKey)}</h2>
          {lists[k].length === 0 ? (
            <p className="text-sm text-co-text-muted">{t("admin.cateringRefunds.lists.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1 font-mono text-xs text-co-text">
              {lists[k].map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="text-xs text-co-text-dim">{t("admin.cateringRefunds.lists.capped")}</p>

      <section className={section} data-testid="inventory-signoff">
        <h2 className={h}>{t("admin.cateringRefunds.signoff.heading")}</h2>
        <p className="text-sm text-co-text">{t("admin.cateringRefunds.signoff.rule")}</p>
      </section>
    </div>
  );
}
