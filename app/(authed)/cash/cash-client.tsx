"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  computeCashTotals,
  DEFAULT_FLOAT_CENTS,
  sumDenominations,
  type Denominations,
  type OnShiftEntry,
} from "@/lib/cash";
import { formatCents } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";
import { ActionButton } from "@/components/ActionButton";
import { PinKeypad, type PinKeypadError } from "@/components/auth/PinKeypad";
import { DenominationCounter } from "@/components/cash/DenominationCounter";

/** dollars string → integer cents (>=0; junk → 0). */
const toCents = (dollars: string): number => {
  const n = Number(dollars.trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
};

export function CashClient({
  locationId,
  date,
  users,
  closerName,
  closerRole,
  language,
}: {
  locationId: string;
  date: string;
  users: { id: string; name: string }[];
  closerName: string;
  closerRole: RoleCode;
  language: Language;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [projected, setProjected] = useState("");
  const [mode, setMode] = useState<"hand" | "denomination">("hand");
  const [handTotal, setHandTotal] = useState("");
  const [denoms, setDenoms] = useState<Denominations>({});
  const [tips, setTips] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extraNames, setExtraNames] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [pinOpen, setPinOpen] = useState(false);

  const projectedCents = toCents(projected);
  const drawerTotalCents = mode === "denomination" ? sumDenominations(denoms) : toCents(handTotal);
  const { overShortCents, depositCents } = useMemo(
    () => computeCashTotals({ projectedCents, drawerTotalCents, floatCents: DEFAULT_FLOAT_CENTS }),
    [projectedCents, drawerTotalCents],
  );

  const onShift: OnShiftEntry[] = [
    ...users.filter((u) => picked.has(u.id)).map((u) => ({ userId: u.id, name: u.name })),
    ...extraNames.map((n) => n.trim()).filter((n) => n !== "").map((n) => ({ userId: null, name: n })),
  ];

  const submitWithPin = async (
    pin: string,
  ): Promise<{ ok: true } | { ok: false; error: PinKeypadError }> => {
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "manual",
        body: JSON.stringify({
          locationId,
          date,
          pin,
          projectedCents,
          countMethod: mode,
          drawerTotalCents: mode === "hand" ? drawerTotalCents : undefined,
          denominations: mode === "denomination" ? denoms : undefined,
          floatCents: DEFAULT_FLOAT_CENTS,
          cashTipsCents: toCents(tips),
          onShift,
          overShortNote: note.trim() || null,
        }),
      });
      if (res.ok) {
        router.refresh(); // page re-renders into the read-only view (report now exists)
        return { ok: true };
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "pin_invalid") return { ok: false, error: { kind: "invalid", message: t("cash.error.pin_invalid") } };
      if (body.error === "closing_finalized") return { ok: false, error: { kind: "invalid", message: t("cash.error.closing_finalized") } };
      return { ok: false, error: { kind: "network", message: t("cash.error.generic") } };
    } catch {
      return { ok: false, error: { kind: "network", message: t("cash.error.generic") } };
    }
  };

  const overShortLine =
    overShortCents === 0
      ? t("cash.readout.even")
      : overShortCents > 0
        ? t("cash.readout.over", { amount: formatCents(overShortCents, language) })
        : t("cash.readout.short", { amount: formatCents(Math.abs(overShortCents), language) });

  return (
    <div className="flex flex-col gap-6">
      {/* === CASH SECTION === */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
          {t("cash.section.cash")}
        </h2>

        <div className="mt-3 flex flex-col gap-3">
          {/* Projected field */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-co-text">{t("cash.field.projected")}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={projected}
              onChange={(e) => setProjected(e.target.value)}
              placeholder="0.00"
              className="
                h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface
                px-3 text-sm text-co-text focus:border-co-text focus:outline-none
                focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            />
          </label>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("hand")}
              className={`
                flex-1 rounded-md border-2 px-3 py-2 text-sm font-semibold transition
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                ${mode === "hand"
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}
              `}
            >
              {t("cash.count.toggle_hand")}
            </button>
            <button
              type="button"
              onClick={() => setMode("denomination")}
              className={`
                flex-1 rounded-md border-2 px-3 py-2 text-sm font-semibold transition
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                ${mode === "denomination"
                  ? "border-co-text bg-co-gold text-co-text"
                  : "border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text"}
              `}
            >
              {t("cash.count.toggle_denomination")}
            </button>
          </div>

          {/* Count input — hand or denomination */}
          {mode === "hand" ? (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-co-text">{t("cash.field.drawer_total")}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={handTotal}
                onChange={(e) => setHandTotal(e.target.value)}
                placeholder="0.00"
                className="
                  h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface
                  px-3 text-sm text-co-text focus:border-co-text focus:outline-none
                  focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              />
            </label>
          ) : (
            <DenominationCounter
              value={denoms}
              onChange={setDenoms}
              language={language}
            />
          )}
          {/* Muted reminder: $200 float stays in the register */}
          <p className="text-xs text-co-text-muted">{t("cash.hint.float")}</p>

          {/* Live deposit readout */}
          <p className="text-sm font-semibold text-co-text">
            {t("cash.readout.deposit", { amount: formatCents(depositCents, language) })}
            {" · "}
            <span
              className={
                overShortCents === 0
                  ? "text-co-text-muted"
                  : overShortCents > 0
                    ? "text-co-success"
                    : "text-co-cta"
              }
            >
              {overShortLine}
            </span>
          </p>

          {/* Over/short note */}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-co-text">{t("cash.field.over_short_note")}</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="
                h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface
                px-3 text-sm text-co-text focus:border-co-text focus:outline-none
                focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            />
          </label>
        </div>
      </section>

      {/* === TIPS SECTION === */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
          {t("cash.section.tips")}
        </h2>

        <div className="mt-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-co-text">{t("cash.field.cash_tips")}</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={tips}
              onChange={(e) => setTips(e.target.value)}
              placeholder="0.00"
              className="
                h-10 w-full rounded-md border-2 border-co-border-2 bg-co-surface
                px-3 text-sm text-co-text focus:border-co-text focus:outline-none
                focus-visible:ring-4 focus-visible:ring-co-gold/60
              "
            />
          </label>
        </div>
      </section>

      {/* === ON SHIFT SECTION === */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
          {t("cash.section.on_shift")}
        </h2>

        <div className="mt-3 flex flex-col gap-2">
          {/* Known users as checkboxes */}
          {users.map((u) => (
            <label
              key={u.id}
              className="flex cursor-pointer items-center gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2"
            >
              <input
                type="checkbox"
                checked={picked.has(u.id)}
                onChange={() => {
                  const next = new Set(picked);
                  if (next.has(u.id)) {
                    next.delete(u.id);
                  } else {
                    next.add(u.id);
                  }
                  setPicked(next);
                }}
                className="h-4 w-4 shrink-0 accent-co-gold"
              />
              <span className="text-sm font-semibold text-co-text">{u.name}</span>
            </label>
          ))}

          {/* Extra freeform name rows */}
          {extraNames.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                placeholder={t("cash.staff.add_placeholder")}
                onChange={(e) => {
                  const next = [...extraNames];
                  next[i] = e.target.value;
                  setExtraNames(next);
                }}
                className="
                  h-10 flex-1 rounded-md border-2 border-co-border-2 bg-co-surface
                  px-3 text-sm text-co-text focus:border-co-text focus:outline-none
                  focus-visible:ring-4 focus-visible:ring-co-gold/60
                "
              />
              <button
                type="button"
                onClick={() => setExtraNames(extraNames.filter((_, j) => j !== i))}
                className="shrink-0 rounded-md border-2 border-co-border-2 bg-co-surface px-2 py-1 text-sm font-bold text-co-cta hover:border-co-cta focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add extra name */}
          <button
            type="button"
            onClick={() => setExtraNames([...extraNames, ""])}
            className="self-start rounded-md border-2 border-co-border-2 bg-co-surface px-3 py-1.5 text-sm font-semibold text-co-text-muted hover:border-co-text hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            + add
          </button>
        </div>
      </section>

      <ActionButton size="lg" className="w-full" onClick={() => setPinOpen(true)}>
        {t("cash.submit.button")}
      </ActionButton>

      {pinOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-co-text/60 px-4 py-6 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
            <PinKeypad
              userName={closerName}
              role={closerRole}
              onSubmit={submitWithPin}
              onBack={() => setPinOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
