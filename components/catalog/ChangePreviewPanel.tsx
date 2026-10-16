"use client";

/**
 * "WHAT THIS CHANGES" (catalog Phase 2b; spec §4; lead decision D4). Renders a preview the server
 * computed for ONE save target: which shops it reaches (each with its own before → after), which it
 * does not, and one row per par lane with what happens to it. A conversion is a CHOICE per row,
 * offered only where the preview offered it; the save button is the save for THIS preview's target
 * — "Save for everyone" exists only on a preview computed for everyone. Nothing is saved before the
 * person has seen what it does.
 */
import { useTranslation } from "@/lib/i18n/provider";
import { useRevealOnOpen } from "@/components/catalog/useRevealOnOpen";
import { formatDateLabel, formatQuantity } from "@/lib/i18n/format";
import { conversionKey, type PackPreview, type ParConversion, type PreviewParRow, type PricePreview } from "@/lib/catalog/change-preview-shared";

const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50";
const choice = (on: boolean) =>
  `inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-3 text-sm font-bold text-co-text disabled:opacity-50 ${on ? "border-co-text bg-co-surface-2" : "border-co-border bg-co-surface hover:border-co-text"}`;
const groupLabel = "text-[12px] font-bold tracking-wide text-co-text-muted";

export function ChangePreviewPanel({
  preview,
  canSave,
  canEditPar,
  chosen,
  onToggleConversion,
  onSave,
  busy,
}: {
  preview: PackPreview | PricePreview;
  /** May this actor save THIS preview's target (its shop, or everyone)? */
  canSave: boolean;
  canEditPar: boolean;
  /** conversionKey(…) of every conversion the person chose; absent = keep. */
  chosen: ReadonlySet<string>;
  onToggleConversion: (key: string, convert: boolean) => void;
  onSave: () => void;
  busy: boolean;
}) {
  const { t, language } = useTranslation();
  const { panelRef, headingRef } = useRevealOnOpen<HTMLElement, HTMLHeadingElement>();
  const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
  const perOz = (n: number | null) => (n == null ? "—" : `$${n.toFixed(4)}/oz`);
  const oz = (n: number | null) => (n == null ? "—" : `${formatQuantity(n, language)} oz`);
  const qty = (n: number) => formatQuantity(n, language);
  const slotName = (s: "weekday" | "weekend") => t(s === "weekday" ? "catalog.preview.slot.weekday" : "catalog.preview.slot.weekend");
  const row = (label: string, before: string, after: string) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-co-border py-2 text-sm">
      <span className="text-co-text-muted">{label}</span>
      <span className="font-bold text-co-text">{`${before} → ${after}`}</span>
    </div>
  );
  const isGlobal = preview.target.kind === "global";
  const targetShopName = preview.target.kind === "shop" ? (preview.shops[0]?.shopName ?? "") : "";
  const nothing = preview.kind === "pack" && !preview.changed;

  // The global conversion the person has chosen, per slot — a restarting machine par on a global
  // save then falls back to the CONVERTED global par (chunk-2 review P3b).
  const chosenGlobal = (slot: "weekday" | "weekend") =>
    preview.kind === "pack" && preview.conversions.some((c) => c.locationId === null && c.slot === slot && chosen.has(conversionKey(c)));

  /** `unit` = the row's CURRENT order unit; `newUnit` = the NEW one (numbers in the new size). */
  const parText = (p: PreviewParRow, unit: string, newUnit: string): string => {
    const base = { slot: slotName(p.slot), n: qty(p.current), unit };
    if (p.inherited && p.status !== "machine_par") {
      return t("catalog.preview.par_question_inherited", { ...base, oz: oz(p.currentOz), newOz: oz(p.keepOz), shop: p.shops[0] ?? "" });
    }
    switch (p.status) {
      case "global_par_shared":
        return t("catalog.preview.par_status.global_par_shared", { ...base, shops: p.shops.join(", ") });
      case "machine_par":
        // Lead decision (chunk-1 review P2-2): the new case retires the machine par (D3); until it
        // recomputes the shop uses the DEFAULT par, read in the new case — or has none, said plainly.
        if (p.fallbackIfConverted && chosenGlobal(p.slot)) {
          return t("catalog.preview.par_machine_restarts", { shop: p.shops[0] ?? "", par: `${qty(p.fallbackIfConverted.par)} ${newUnit}`, amount: oz(p.fallbackIfConverted.oz) });
        }
        return p.fallbackPar != null
          ? t("catalog.preview.par_machine_restarts", { shop: p.shops[0] ?? "", par: `${qty(p.fallbackPar)} ${newUnit}`, amount: oz(p.fallbackOz) })
          : t("catalog.preview.par_machine_no_default", { shop: p.shops[0] ?? "" });
      default:
        return p.locationId === null
          ? t("catalog.preview.par_question_global", { ...base, oz: oz(p.currentOz), newOz: oz(p.keepOz), shops: p.shops.join(", ") })
          : t("catalog.preview.par_question_shop", { ...base, oz: oz(p.currentOz), newOz: oz(p.keepOz), shop: p.shops[0] ?? "" });
    }
  };

  return (
    <section ref={panelRef} aria-label={t("catalog.preview.title")} className="mt-3 rounded-xl border-2 border-co-border-2 bg-co-surface-inset p-3">
      <h3 ref={headingRef} tabIndex={-1} className={groupLabel}>{t("catalog.preview.title")}</h3>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
        {isGlobal ? t("catalog.preview.target_global") : t("catalog.preview.target_shop", { shop: targetShopName })}
      </p>

      {nothing ? (
        <p className="mt-2 text-sm text-co-text">{t("catalog.preview.no_change")}</p>
      ) : (
        <>
          {preview.shops.length === 0 ? <p className="mt-2 text-sm text-co-text">{t("catalog.preview.no_shops")}</p> : null}

          {preview.kind === "pack"
            ? preview.shops.map((s) => (
                <div key={s.shopId} className="mt-3">
                  <p className={groupLabel}>{s.shopName}</p>
                  {row(t("catalog.preview.order_unit"), `${s.orderUnit.before ?? "—"} (${oz(s.orderUnitOz.before)})`, `${s.orderUnit.after ?? "—"} (${oz(s.orderUnitOz.after)})`)}
                  {row(t("catalog.preview.cost_per_oz"), perOz(s.costPerOz.before), perOz(s.costPerOz.after))}
                  <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.preview.menu_items")}</p>
                  {s.menuItems.length === 0 ? (
                    <p className="text-sm text-co-text">{t("catalog.preview.menu_none")}</p>
                  ) : (
                    <ul className="mt-1 flex flex-col">
                      {s.menuItems.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
                          <span className="text-co-text">{language === "es" && m.nameEs ? m.nameEs : m.name}</span>
                          <span className="font-bold text-co-text">{`${money(m.before)} → ${money(m.after)}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.brokenLines.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-sm font-bold text-co-warning-text">{t("catalog.preview.broken_lines")}</p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-co-text">
                        {s.brokenLines.map((l) => (
                          <li key={`${l.recipeId}-${l.unit ?? ""}-${l.quantity}`}>{`${l.recipeName}: ${qty(l.quantity)} ${l.unit ?? ""}`}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {s.openOrders.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("catalog.preview.open_orders")}</p>
                      <ul className="mt-1 list-disc pl-5 text-sm text-co-text">
                        {s.openOrders.map((o) => (
                          <li key={o.poId}>{`${o.displayCode} · ${qty(o.orderQty)} ${o.orderUnitLabel ?? ""}`}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))
            : preview.shops.map((s) => (
                <div key={s.shopId} className="mt-3">
                  <p className={groupLabel}>{s.shopName}</p>
                  {row(t("catalog.preview.price"), money(s.price.before), money(s.price.after))}
                  {!s.becomesCurrent ? (
                    <p className="text-sm text-co-warning-text">{t("catalog.preview.price_not_current", { date: formatDateLabel(preview.effectiveDate, language) })}</p>
                  ) : null}
                  {row(t("catalog.preview.cost_per_oz"), perOz(s.costPerOz.before), perOz(s.costPerOz.after))}
                  {s.menuItems.length === 0 ? (
                    <p className="text-sm text-co-text">{t("catalog.preview.menu_none")}</p>
                  ) : (
                    <ul className="mt-1 flex flex-col">
                      {s.menuItems.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1 text-sm">
                          <span className="text-co-text">{language === "es" && m.nameEs ? m.nameEs : m.name}</span>
                          <span className="font-bold text-co-text">{`${money(m.before)} → ${money(m.after)}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

          {preview.unaffected.length > 0 ? (
            <p className="mt-3 text-sm text-co-text-muted">{t("catalog.preview.unaffected", { shops: preview.unaffected.map((u) => u.shopName).join(", ") })}</p>
          ) : null}

          {preview.kind === "pack" && preview.pars.length > 0 ? (
            <div className="mt-3 flex flex-col gap-3">
              {preview.pars.map((p) => {
                // The row's own units (the global row: the GLOBAL pack's), never another shop's (chunk-2 P3a).
                const unit = p.unit.before ?? "";
                const newUnit = p.unit.after ?? unit;
                // The conversion is the one the SERVER offered for this row — never recomputed here (P3d).
                const conv: ParConversion | null = preview.conversions.find((c) => c.locationId === p.locationId && c.slot === p.slot) ?? null;
                const fromAuto = conv?.from === "auto";
                const key = conv ? conversionKey(conv) : `${p.locationId ?? "global"}|${p.slot}|${p.status}`;
                const on = conv != null && chosen.has(key);
                return (
                  <div key={key} className="flex flex-col gap-2">
                    <p className="text-sm text-co-text">{parText(p, unit, newUnit)}</p>
                    {p.perOrderUnit && p.perOrderUnit.before && p.perOrderUnit.after ? (
                      <p className="text-sm text-co-warning-text">
                        {t("catalog.preview.par_count_changed", {
                          before: `${qty(p.perOrderUnit.before.qty)} ${p.perOrderUnit.before.unit}`,
                          after: `${qty(p.perOrderUnit.after.qty)} ${p.perOrderUnit.after.unit}`,
                        })}
                      </p>
                    ) : null}
                    {conv && canEditPar ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={choice(!on)} aria-pressed={!on} disabled={busy} onClick={() => onToggleConversion(key, false)}>
                          {fromAuto
                            ? t("catalog.preview.par_let_restart")
                            : p.inherited ? t("catalog.preview.par_keep_inherited") : t("catalog.preview.par_keep", { n: qty(p.current), unit })}
                        </button>
                        <button type="button" className={choice(on)} aria-pressed={on} disabled={busy} onClick={() => onToggleConversion(key, true)}>
                          {fromAuto
                            ? t("catalog.preview.par_own_from_auto", { to: `${qty(conv.to)} ${newUnit}` })
                            : p.inherited
                              ? t("catalog.preview.par_set_shop", { shop: p.shops[0] ?? "", n: qty(conv.to), unit: newUnit })
                              : t("catalog.preview.par_convert", { n: qty(conv.to), unit: newUnit })}
                        </button>
                      </div>
                    ) : conv ? (
                      <p className="text-xs text-co-text-dim">{t("catalog.preview.par_gm_only")}</p>
                    ) : p.status === "no_weight" ? (
                      <p className="text-xs text-co-text-dim">{t("catalog.preview.par_cant_convert")}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {canSave ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnPrimary} disabled={busy} onClick={onSave}>
                {isGlobal ? t("catalog.preview.save_everyone") : t("catalog.preview.save_shop", { shop: targetShopName })}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
