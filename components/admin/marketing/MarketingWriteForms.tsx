"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { Language } from "@/lib/i18n/types";
import { formatDateLabel } from "@/lib/i18n/format";
import { marketingWriteCopy, marketingRefusalCopy } from "@/lib/marketing/write-copy";
import { dollarsToCents } from "@/lib/marketing/spend-shared";
import { etYmdMinusDays } from "@/lib/operational-day";
import type { Milestone, ManualEntry } from "@/lib/marketing/scorecard";

type Mode = "milestone" | "entry" | "baseline";
const control = "min-h-11 w-full min-w-0 rounded border border-input bg-background px-3 py-2";
export function MarketingWriteForms({ lang, locations, milestones, entries, snapshotId, weeks, canCorrectBaseline }: {
  lang: Language; locations: { id: string; name: string }[]; milestones: Milestone[]; entries: ManualEntry[]; snapshotId?: string; weeks: { from: string; to: string }[]; canCorrectBaseline: boolean;
}) {
  const c = marketingWriteCopy(lang), router = useRouter(), send = useStepUpPost();
  const { requestStepUp } = useStepUp();
  const [mode, setMode] = useState<Mode | null>(null), [target, setTarget] = useState("");
  const [kind, setKind] = useState("first_ad_spend"), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const newKinds = ["first_ad_spend", "landing_live", "counter_on", "capi_on"].filter(kind => !milestones.some(row => row.kind === kind));
  const correctableMilestones = milestones.filter(row => canCorrectBaseline || row.kind !== "first_ad_spend");
  const milestone = milestones.find(row => row.id === target), entry = entries.find(row => row.id === target);
  const correction = mode === "baseline" ? !!snapshotId : !!target;
  function open(next: Mode) { setMode(next); setTarget(""); setKind(next === "entry" ? "meta_spend" : newKinds[0] ?? ""); setMessage(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !mode) return;
    const data = new FormData(event.currentTarget);
    const amountCents = mode === "entry" && kind !== "email_list_size" ? dollarsToCents(String(data.get("amount") ?? "")) : null;
    if (mode === "entry" && kind !== "email_list_size" && (amountCents === null || !weeks.some(week => week.from === data.get("from")))) { setMessage(c.entry_invalid); return; }
    setBusy(true); setMessage("");
    try {
      const unlocked = mode === "entry" ? await requestStepUp("A") : await requestStepUp("B");
      if (unlocked !== "ok") return;
      const reason = String(data.get("reason") ?? "") || null;
      const endpoint = mode === "baseline" ? "baseline-snapshot" : `${mode === "entry" ? "entries" : "milestones"}${target ? `/${target}/correct` : ""}`;
      const body = mode === "baseline" ? { correctsId: snapshotId ?? null, reason }
        : mode === "milestone" ? { kind: milestone?.kind ?? kind, date: data.get("date"), reason }
        : { kind: entry?.kind ?? kind, locationId: data.get("locationId") || null, platform: kind === "promo_spend" ? data.get("platform") : null,
          from: data.get("from"), to: kind === "email_list_size" ? data.get("from") : etYmdMinusDays(String(data.get("from")), -6),
          amountCents: kind === "email_list_size" ? null : amountCents, listCount: kind === "email_list_size" ? Number(data.get("count")) : null,
          note: String(data.get("note") ?? "") || null, reason };
      const result = await send(`/api/admin/marketing/${endpoint}`, body);
      if (!result.ok) { setMessage(marketingRefusalCopy(lang, result.code)); return; }
      setMessage(c.saved); setMode(null); router.refresh();
    } catch { setMessage(c.failed); } finally { setBusy(false); }
  }
  return <section className="min-w-0 space-y-3" aria-label={c.edit}>
    <div className="flex flex-wrap gap-2">{(["milestone", "entry", "baseline"] as const).filter(value => value !== "baseline" || !snapshotId || canCorrectBaseline).map(value => <button key={value} type="button" className="inline-flex min-h-11 items-center rounded border px-3" disabled={busy} onClick={() => open(value)}>{c[value]}</button>)}</div>
    {mode && <form className="grid min-w-0 gap-3 rounded border p-3" onSubmit={submit}>
      {mode !== "baseline" && <label>{c.correct}<select className={control} value={target} onChange={event => {
        const id = event.target.value; setTarget(id);
        setKind((mode === "milestone" ? milestones : entries).find(row => row.id === id)?.kind ?? (mode === "milestone" ? newKinds[0] ?? "" : "meta_spend"));
      }}><option value="">{c.new}</option>{(mode === "milestone" ? correctableMilestones : entries).map(row => <option key={row.id} value={row.id}>{c[row.kind as keyof typeof c] ?? row.kind} · {formatDateLabel("milestone_date" in row ? row.milestone_date : row.period_start, lang)}</option>)}</select></label>}
      {mode !== "baseline" && <label>{c.kind}<select className={control} value={kind} disabled={!!target} onChange={event => setKind(event.target.value)}>{(mode === "milestone" ? (target ? [milestone!.kind] : newKinds) : ["meta_spend", "promo_spend", "email_list_size"]).map(value => <option key={value} value={value}>{c[value as keyof typeof c]}</option>)}</select></label>}
      {mode === "milestone" && <label>{c.date}<input key={target} className={control} name="date" type="date" defaultValue={milestone?.milestone_date} required /></label>}
      {mode === "entry" && <div key={`${target}:${kind}`} className="grid min-w-0 gap-3">
        {kind !== "meta_spend" && <label>{c.location}<select className={control} name="locationId" defaultValue={entry?.location_id ?? ""}><option value="">{c.all}</option>{locations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>}
        {kind === "promo_spend" && <label>{c.platform}<select className={control} name="platform" defaultValue={entry?.platform ?? "uber_eats"}>{["uber_eats", "doordash", "grubhub", "other"].map(value => <option key={value} value={value}>{c[value as keyof typeof c]}</option>)}</select></label>}
        {kind === "email_list_size" ? <label>{c.from}<input className={control} type="date" name="from" defaultValue={entry?.period_start} required /></label>
          : <label>{c.week}<select className={control} name="from" defaultValue={entry?.period_start ?? weeks.at(-1)?.from} required>{weeks.map(week => <option key={week.from} value={week.from}>{formatDateLabel(week.from, lang)} {"\u2013"} {formatDateLabel(week.to, lang)}</option>)}</select></label>}
        <label>{kind === "email_list_size" ? c.count : c.amount}<input className={control} type="number" min="0" step={kind === "email_list_size" ? "1" : "0.01"} max={kind === "email_list_size" ? 2147483647 : 1000000} name={kind === "email_list_size" ? "count" : "amount"} defaultValue={(kind === "email_list_size" ? entry?.list_count : entry?.amount_cents == null ? undefined : (entry.amount_cents / 100).toFixed(2)) ?? undefined} required /></label>
        <label>{c.note}<input className={control} name="note" maxLength={200} defaultValue={entry?.note ?? ""} /></label>
      </div>}
      {correction && <label>{c.reason}<input className={control} name="reason" maxLength={300} required /></label>}
      <div className="flex flex-wrap gap-2"><button className="inline-flex min-h-11 items-center rounded border px-3" disabled={busy || (mode === "milestone" && !kind)}>{c.save}</button><button type="button" className="inline-flex min-h-11 items-center rounded border px-3" disabled={busy} onClick={() => setMode(null)}>{c.cancel}</button></div>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
