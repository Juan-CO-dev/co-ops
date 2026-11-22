/**
 * The numbers strip (nav PR 8, plan r2 2.4; spec r5 3.6). Server component. MoO, Owner and CGS only: the page renders it
 * only when `numbersStripFor(auth.role)`; a GM and the social media manager never get it (nor its reads).
 *
 * One row per shop the page can open, in the page's order, never blended across shops. Three cells, each a full-row link
 * to its page, each failing on its own ("Couldn't load right now", never $0):
 *   - sales so far today: an amount ("At least" when partial), a covered zero, or "not captured from Toast yet";
 *   - labor % (StripLaborCell, the only strip file under the figure census); absent while the switch is off. Streamed in
 *     its own Suspense boundary (StripLaborStream; lead rulings r3, P1): the rest of the page never waits for it, and
 *     until it settles the cell says "Loading labor…", never a number;
 *   - catering today: the order count, the PIPELINE value, and every gap named (estimates, no price, ezCater not valued).
 * This file holds no business-report figure (it imports no `@/lib/business-*` module).
 */
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { StripShop } from "@/lib/dashboard-blocks";
import { salesStripCell, stripLinks } from "@/lib/dashboard-blocks-shared";
import { formatCents, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { StripLaborStream } from "./StripLaborStream";

const CELL = "flex min-h-[44px] min-w-0 items-center rounded-lg border border-co-border bg-co-surface-inset p-3 text-co-text hover:border-co-text";

function Cell({ href, kind, name, shopLabel, language, children }: { href: string; kind: string; name: string; shopLabel: string; language: Language; children: ReactNode }) {
  return (
    <Link href={href} data-strip-cell={kind} aria-label={serverT(language, "dashboard.strip.link_aria", { name, shop: shopLabel })} className={CELL}>
      <span className="flex min-w-0 flex-col gap-1">{children}</span>
    </Link>
  );
}
const Label = ({ children }: { children: ReactNode }) => <span className="text-xs font-bold uppercase tracking-wide text-co-text-muted">{children}</span>;
const Line = ({ children, muted = false }: { children: ReactNode; muted?: boolean }) =>
  <span className={muted ? "text-xs text-co-text-muted" : "text-xs text-co-warning-text"}>{children}</span>;

function SalesCell({ row, language }: { row: StripShop; language: Language }) {
  const t = (k: Parameters<typeof serverT>[1], v?: Record<string, string | number>) => serverT(language, k, v);
  let body: ReactNode;
  if (row.sales.kind !== "ok") {
    body = <span className="text-sm text-co-text-muted">{t("dashboard.tile.unavailable")}</span>;
  } else {
    const c = salesStripCell(row.sales.value);
    const synced = c.kind !== "not_captured" && c.capturedAt ? t("pulse.sales.synced", { time: formatTime(c.capturedAt, language) }) : t("pulse.sales.synced_none");
    body = (
      <>
        {c.kind === "amount" ? (
          <span className="text-lg font-bold tabular-nums" data-sales={c.partial ? "at_least" : "amount"}>
            {c.partial ? t("dashboard.strip.sales_at_least", { amount: formatCents(c.cents, language) }) : formatCents(c.cents, language)}
          </span>
        ) : c.kind === "covered_zero" ? (
          <span className="text-sm font-semibold" data-sales="covered_zero">{t("dashboard.strip.sales_none")}</span>
        ) : (
          <span className="text-sm font-semibold" data-sales="not_captured">{t("dashboard.strip.sales_not_captured")}</span>
        )}
        <Line muted>{synced}</Line>
      </>
    );
  }
  const name = t("dashboard.strip.sales");
  return (
    <Cell href={stripLinks(row.shop.id, null).sales} kind="sales" name={name} shopLabel={`${row.shop.code} · ${row.shop.name}`} language={language}>
      <Label>{name}</Label>
      {body}
    </Cell>
  );
}

function CateringCell({ row, language }: { row: StripShop; language: Language }) {
  const t = (k: Parameters<typeof serverT>[1], v?: Record<string, string | number>) => serverT(language, k, v);
  let body: ReactNode;
  if (row.catering.kind !== "ok") {
    body = <span className="text-sm text-co-text-muted">{t("dashboard.tile.unavailable")}</span>;
  } else {
    const c = row.catering.value;
    body = c.orders === 0 ? (
      <span className="text-sm font-semibold" data-catering="none">{t("day.reason.catering.none")}</span>
    ) : (
      <>
        <span className="text-lg font-bold tabular-nums" data-catering="count">
          {c.orders === 1 ? t("dashboard.strip.catering_count_one") : t("dashboard.strip.catering_count_other", { n: c.orders })}
        </span>
        {c.valuedCents !== null ? <span className="text-sm" data-catering="booked">{t("dashboard.strip.catering_booked", { amount: formatCents(c.valuedCents, language) })}</span> : null}
        {c.estimated > 0 ? <Line>{t("dashboard.strip.catering_estimated", { n: c.estimated })}</Line> : null}
        {c.missing > 0 ? <Line>{t("dashboard.strip.catering_no_price", { n: c.missing })}</Line> : null}
        {c.unlinkedEzcater > 0 ? <Line>{t("dashboard.strip.catering_ezcater_unvalued", { n: c.unlinkedEzcater })}</Line> : null}
      </>
    );
  }
  const name = t("dashboard.strip.catering");
  return (
    <Cell href={stripLinks(row.shop.id, null).catering} kind="catering" name={name} shopLabel={`${row.shop.code} · ${row.shop.name}`} language={language}>
      <Label>{name}</Label>
      {body}
    </Cell>
  );
}

/** The labor cell while its read is in flight: the same box, at least 44 px, words only (never a number). */
function LaborLoading({ language }: { language: Language }) {
  return (
    <div data-strip-cell="labor-loading" role="status" className={CELL.replace(" hover:border-co-text", "")}>
      <span className="text-sm text-co-text-muted">{serverT(language, "dashboard.strip.labor_loading")}</span>
    </div>
  );
}

export function NumbersStrip({ rows, language }: { rows: readonly StripShop[]; language: Language }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={serverT(language, "dashboard.strip.aria")} data-numbers-strip className="flex flex-col gap-3">
      {rows.map((row) => {
        const shopLabel = `${row.shop.code} · ${row.shop.name}`;
        return (
          <div key={row.shop.id} data-strip-shop={row.shop.code} className="co-card flex min-w-0 flex-col gap-2 p-4">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-co-text-muted">{shopLabel}</h3>
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
              <SalesCell row={row} language={language} />
              {row.labor === "off" ? null : (
                <Suspense fallback={<LaborLoading language={language} />}>
                  <StripLaborStream labor={row.labor} shopId={row.shop.id} shopLabel={shopLabel} language={language} />
                </Suspense>
              )}
              <CateringCell row={row} language={language} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
