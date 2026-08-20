"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { ActionButton } from "@/components/ActionButton";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { CountSkuOption } from "@/lib/counts";
import { twinVendorLabels } from "@/lib/counts-shared";

interface LineDraft {
  skuId: string;
  level: string;
  qty: string;
  isLoose: boolean;
  partial: string; // "" = whole container; "0.5" = half, etc.
}
const emptyLine = (): LineDraft => ({ skuId: "", level: "", qty: "", isLoose: false, partial: "" });
const field = "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

export function CountForm({ skus, locationId }: { skus: CountSkuOption[]; locationId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Tier-A step-up (council A4): the counts POST asserts it server-side, but this
  // form lives outside /admin's StepUpProvider — it carries its own modal (the
  // SalesTab idiom: stash the pending submit, prompt, replay on confirm). Found
  // live 2026-08-10: the route demanded a password confirm the UI never offered.
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);

  const skuById = new Map(skus.map((s) => [s.id, s]));
  // P8: only names that exist under 2+ vendors get a vendor suffix. Computed ONCE for the
  // whole option set, not per row — and empty for the ~95% single-vendor catalog, so the
  // common case renders exactly as before.
  const twinLabels = twinVendorLabels(skus);
  const optionLabel = (s: CountSkuOption) => {
    const v = twinLabels.get(s.id);
    return v ? `${s.name} — ${v}` : s.name;
  };
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const canSubmit =
    !busy &&
    lines.some((l) => l.skuId !== "" && l.level.trim() !== "" && l.qty.trim() !== "");

  // Council P2: submit() silently drops any line that's only partially filled (started
  // but not finished) — the operator got a clean success having lost lines. A line with
  // ALL THREE fields blank is an untouched spare row, never counted/warned about; a line
  // with SOME but not all of skuId/level/qty filled is what gets silently dropped below.
  const incompleteCount = lines.filter((l) => {
    const isEmpty = l.skuId === "" && l.level.trim() === "" && l.qty.trim() === "";
    const isComplete = l.skuId !== "" && l.level.trim() !== "" && l.qty.trim() !== "";
    return !isEmpty && !isComplete;
  }).length;

  const submit = async () => {
    if (!canSubmit) return;
    setErr(null); setBusy(true);
    const payload = {
      locationId,
      note: note.trim() || null,
      lines: lines
        .filter((l) => l.skuId !== "" && l.level.trim() !== "" && l.qty.trim() !== "")
        .map((l) => ({
          skuId: l.skuId,
          levelLabel: l.level.trim(),
          qty: Number(l.qty),
          isLoose: l.isLoose,
          partialFraction: l.partial.trim() === "" ? null : Number(l.partial),
        })),
    };
    const res = await fetch("/api/operations/counts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (res.ok) { setStepUpOpen(false); pendingRef.current = null; router.refresh(); setNote(""); setLines([emptyLine()]); return; }
    const j = await res.json().catch(() => ({} as { code?: string }));
    if (j?.code === "step_up_required" || j?.code === "step_up_stale") {
      pendingRef.current = () => void submit();
      setStepUpOpen(true);
      return;
    }
    setErr(t(("counts.error." + (j?.code ?? "generic")) as never));
  };

  return (
    <div className="rounded-2xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">{t("counts.form.title")}</h2>
      {/* Disjoint-by-law guidance (council L5): full containers + loose-below,
          never double-counted. */}
      <p className="mt-2 rounded-lg border-2 border-co-border-2 bg-white px-3 py-2 text-[11px] text-co-text-dim">{t("counts.form.disjoint_hint")}</p>

      <div className="mt-3 flex flex-col gap-3">
        {lines.map((l, i) => {
          const sku = l.skuId ? skuById.get(l.skuId) : undefined;
          const levels = sku?.chainLabels ?? [];
          return (
            <div key={i} className="rounded-lg border-2 border-co-border-2 p-3">
              <select className={field} value={l.skuId} disabled={busy} onChange={(e) => setLine(i, { skuId: e.target.value, level: "" })} aria-label={t("counts.form.pick_sku")}>
                <option value="">{t("counts.form.pick_sku")}</option>
                {skus.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
              </select>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("counts.form.level")}</span>
                  {levels.length > 0 ? (
                    <select className={field} value={l.level} disabled={busy} onChange={(e) => setLine(i, { level: e.target.value })} aria-label={t("counts.form.level")}>
                      <option value="">{t("counts.form.pick_level")}</option>
                      {levels.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                    </select>
                  ) : (
                    <input className={field} value={l.level} disabled={busy} onChange={(e) => setLine(i, { level: e.target.value })} placeholder={t("counts.form.level_freeform")} aria-label={t("counts.form.level")} />
                  )}
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("counts.form.qty")}</span>
                  <input className={field} type="number" min={0} step="any" inputMode="decimal" value={l.qty} disabled={busy} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label={t("counts.form.qty")} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-[12px] text-co-text">
                  <input type="checkbox" checked={l.isLoose} disabled={busy} onChange={(e) => setLine(i, { isLoose: e.target.checked })} className="h-4 w-4" aria-label={t("counts.form.is_loose")} />
                  {t("counts.form.is_loose")}
                </label>
                <label className="inline-flex items-center gap-2 text-[12px] text-co-text">
                  <span>{t("counts.form.partial")}</span>
                  <input className="min-h-[44px] w-20 rounded-lg border-2 border-co-border bg-co-surface px-2 text-sm text-co-text disabled:opacity-60" type="number" min={0} max={1} step="any" inputMode="decimal" value={l.partial} disabled={busy} onChange={(e) => setLine(i, { partial: e.target.value })} placeholder={t("counts.form.partial_hint")} aria-label={t("counts.form.partial")} />
                </label>
              </div>
              {lines.length > 1 ? (
                <button type="button" disabled={busy} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="mt-2 text-xs font-bold text-co-cta-text">{t("counts.form.remove_line")}</button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])} className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text">{t("counts.form.add_line")}</button>

      <label className="mt-3 block"><span className="text-sm font-bold text-co-text">{t("counts.form.note")}</span>
        <textarea className={`${field} min-h-[60px] py-2`} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder={t("counts.form.note_hint")} aria-label={t("counts.form.note")} /></label>

      {err ? <p className="mt-3 text-sm text-co-cta-text">{err}</p> : null}
      {/* Pre-submit visibility for the drop that submit() still performs (council P2):
          submit stays enabled — an operator may legitimately skip a line they started —
          but the notice surfaces the drop BEFORE they tap Record. */}
      {incompleteCount > 0 ? (
        <div role="status" className="mt-3 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-3 text-sm text-co-text">
          {t("counts.form.incomplete_lines", { n: incompleteCount })}
        </div>
      ) : null}
      <div className="mt-4 flex justify-end">
        <ActionButton disabled={!canSubmit} onClick={() => void submit()}>{t("counts.form.submit")}</ActionButton>
      </div>
      {/* PasswordModal posts /api/auth/step-up itself and confirms only on 200. */}
      <PasswordModal
        open={stepUpOpen}
        onConfirm={() => { setStepUpOpen(false); const p = pendingRef.current; pendingRef.current = null; p?.(); }}
        onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }}
      />
    </div>
  );
}
