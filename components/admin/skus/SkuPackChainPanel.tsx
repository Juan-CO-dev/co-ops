"use client";

/**
 * SkuPackChainPanel — per-SKU pack-hierarchy chain editor (pack-hierarchy PR 1,
 * migration 0159). Rendered below the non-editing catalog row (like SkuCostPanel)
 * because a chain's levels FK to an existing SKU, so it needs the SKU to already
 * exist — the transient add/edit SkuForm is the wrong home.
 *
 * Display: the active chain as an ordered list (case → 4 log ; log → 34 oz),
 * plus a "chain unverified" badge when the server flagged it (a 3-level deli
 * backfill candidate or a malformed hand-edit).
 *
 * Edit (GM+): add/edit/remove levels, each linking DOWN either to another level
 * (pointer) or to a measure unit (leaf). Save replaces the whole chain
 * (supersede-as-a-SET). Levels are index-linked in the payload; the server
 * mints real ids. Step-up Tier A mirrors SKU edits.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { MeasureUnitOption } from "@/lib/admin/skus";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { postJson, resolveErrorKey } from "./shared";

/** One editor row: label, qty, and a link that is EITHER a level index OR a measure unit. */
interface EditorLevel {
  label: string;
  qty: string;
  /** "level:<index>" | "measure:<label>" | "" (unset). */
  link: string;
}

const field =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

function toEditorLevels(levels: PackChainLevel[]): EditorLevel[] {
  const indexById = new Map(levels.map((l, i) => [l.id, i]));
  return levels.map((l) => ({
    label: l.label,
    qty: String(l.containsQty),
    link:
      l.containsLevelId != null && indexById.has(l.containsLevelId)
        ? `level:${indexById.get(l.containsLevelId)}`
        : l.containsMeasureUnit != null
          ? `measure:${l.containsMeasureUnit}`
          : "",
  }));
}

export function SkuPackChainPanel({
  skuId,
  measureUnits,
  canManage,
}: {
  skuId: string;
  measureUnits: MeasureUnitOption[];
  canManage: boolean; // GM+
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [levels, setLevels] = useState<PackChainLevel[]>([]);
  const [unverified, setUnverified] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EditorLevel[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/skus/${skuId}/pack-chain`, { redirect: "manual" });
      if (res.ok) {
        const body = (await res.json()) as { levels: PackChainLevel[]; unverified: boolean };
        setLevels(body.levels ?? []);
        setUnverified(!!body.unverified);
        setLoaded(true);
      } else {
        setErr(t("admin.skus.error.generic"));
      }
    } catch {
      setErr(t("admin.skus.error.generic"));
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) void load();
  };

  const startEdit = () => {
    setRows(levels.length > 0 ? toEditorLevels(levels) : [{ label: "", qty: "", link: "" }]);
    setEditing(true);
    setErr(null);
  };

  const addRow = () => setRows((r) => [...r, { label: "", qty: "", link: "" }]);
  const removeRow = (i: number) =>
    setRows((r) => {
      const next = r.filter((_, idx) => idx !== i);
      // Any pointer that referenced a now-removed/shifted index becomes stale;
      // clear links that point at the removed row and let the user re-pick.
      return next.map((row) => {
        if (!row.link.startsWith("level:")) return row;
        const idx = Number(row.link.slice("level:".length));
        if (idx === i) return { ...row, link: "" };
        return { ...row, link: idx > i ? `level:${idx - 1}` : row.link };
      });
    });
  const setRow = (i: number, patch: Partial<EditorLevel>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const save = async () => {
    if (busy) return;
    setErr(null);
    // Assemble the payload (index-linked).
    const payload = rows.map((row) => {
      const qty = Number(row.qty);
      if (row.link.startsWith("level:")) {
        return { label: row.label.trim(), containsQty: qty, containsIndex: Number(row.link.slice("level:".length)), containsMeasureUnit: null };
      }
      if (row.link.startsWith("measure:")) {
        return { label: row.label.trim(), containsQty: qty, containsIndex: null, containsMeasureUnit: row.link.slice("measure:".length) };
      }
      return { label: row.label.trim(), containsQty: qty, containsIndex: null, containsMeasureUnit: null };
    });
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const res = await postJson(`/api/admin/skus/${skuId}/pack-chain`, { levels: payload }, "POST");
    setBusy(false);
    if (res.ok) {
      setEditing(false);
      setLoaded(false);
      await load();
      router.refresh();
    } else {
      setErr(t(resolveErrorKey(res.code)));
    }
  };

  return (
    <div className="mt-2 rounded-lg border-2 border-co-border bg-co-surface p-3 text-sm">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1 text-xs font-bold uppercase tracking-[0.08em] text-co-text hover:text-co-gold-text"
      >
        {t("admin.skus.chain.title")}
        {loaded && unverified ? (
          <span className="inline-flex items-center rounded-full bg-co-danger-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-cta-text">
            {t("admin.skus.chain.unverified")}
          </span>
        ) : null}
        <span aria-hidden className="text-co-text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div className="mt-2">
          {loading ? <p className="text-co-text-muted">{t("admin.skus.chain.loading")}</p> : null}

          {loaded && !editing ? (
            levels.length === 0 ? (
              <p className="text-co-text-muted">{t("admin.skus.chain.none")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {orderedForDisplay(levels).map((l) => (
                  <li key={l.id} className="rounded-md border-2 border-co-border-2 px-2 py-1 text-xs text-co-text">
                    <span className="font-bold">{l.label}</span>
                    {" → "}
                    {l.containsMeasureUnit != null
                      ? `${l.containsQty} ${l.containsMeasureUnit}`
                      : `${l.containsQty} ${labelOf(levels, l.containsLevelId)}`}
                  </li>
                ))}
              </ul>
            )
          ) : null}

          {loaded && editing ? (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div key={i} className="rounded-md border-2 border-co-border-2 p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.chain.level_label")}</span>
                      <input
                        className={field}
                        value={row.label}
                        disabled={busy}
                        placeholder={t("admin.skus.chain.level_label_ph")}
                        onChange={(e) => setRow(i, { label: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.chain.contains_qty")}</span>
                      <input
                        className={field}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={row.qty}
                        disabled={busy}
                        onChange={(e) => setRow(i, { qty: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="mt-2 block">
                    <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.chain.contains_link")}</span>
                    <select className={field} value={row.link} disabled={busy} onChange={(e) => setRow(i, { link: e.target.value })}>
                      <option value="">{t("admin.skus.chain.link_placeholder")}</option>
                      <optgroup label={t("admin.skus.chain.link_levels")}>
                        {rows.map((other, j) =>
                          j === i ? null : (
                            <option key={`level:${j}`} value={`level:${j}`}>
                              {other.label.trim() || t("admin.skus.chain.level_n", { n: j + 1 })}
                            </option>
                          ),
                        )}
                      </optgroup>
                      <optgroup label={t("admin.skus.chain.link_measures")}>
                        {measureUnits.map((m) => (
                          <option key={`measure:${m.label}`} value={`measure:${m.label}`}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeRow(i)}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-cta disabled:opacity-50"
                    >
                      {t("admin.skus.chain.remove_level")}
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={addRow}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-dashed border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50"
              >
                {t("admin.skus.chain.add_level")}
              </button>
              {err ? <p className="text-sm text-co-cta-text">{err}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setEditing(false); setErr(null); }}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50"
                >
                  {t("admin.skus.cancel")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
                >
                  {t("admin.skus.chain.save")}
                </button>
              </div>
            </div>
          ) : null}

          {loaded && !editing && canManage ? (
            <button
              type="button"
              onClick={startEdit}
              className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
            >
              {levels.length === 0 ? t("admin.skus.chain.build") : t("admin.skus.chain.edit")}
            </button>
          ) : null}

          {err && !editing ? <p className="mt-2 text-sm text-co-cta-text">{err}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Display order: root first (nobody points at it), following pointers down. */
function orderedForDisplay(levels: PackChainLevel[]): PackChainLevel[] {
  if (levels.length === 0) return [];
  const byId = new Map(levels.map((l) => [l.id, l]));
  const pointedAt = new Set<string>();
  for (const l of levels) if (l.containsLevelId != null) pointedAt.add(l.containsLevelId);
  const root = levels.find((l) => !pointedAt.has(l.id));
  if (!root) return [...levels].sort((a, b) => a.displayOrdinal - b.displayOrdinal);
  const out: PackChainLevel[] = [];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = root;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.containsLevelId != null ? byId.get(cur.containsLevelId) : undefined;
  }
  // Append any unreachable stragglers (a detached/unverified chain) so they're visible.
  for (const l of levels) if (!seen.has(l.id)) out.push(l);
  return out;
}

function labelOf(levels: PackChainLevel[], id: string | null): string {
  if (id == null) return "";
  return levels.find((l) => l.id === id)?.label ?? "?";
}
