import Link from "next/link";
import { notFound } from "next/navigation";
import { SourcesClient, type SourcesView } from "@/components/admin/demand-signals/SourcesClient";
import { canMarkSource } from "@/lib/demand-signals/access-shared";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { DemandSignalError, loadSourceRegister } from "@/lib/demand-signals/signal-store";
import { serverT } from "@/lib/i18n/server";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * Item 4 PR 5: the source verification page (the screen on PR 2's mark route). MoO / Owner / CGS only, by trusted
 * role; everyone else 404. DARK behind DEMAND_SIGNALS. It lists every registered source at its CURRENT
 * definition with what the register holds about it (where the data is, the terms page, the quoted sentence, the
 * conditions), and lets a person mark the definition THEY READ verified or revoked (Tier B, a note required).
 * Nothing is taken from a source, and nothing stored from it is used, until that mark.
 */
export default async function DemandSourcesPage() {
  const auth = await requireSessionFromHeaders("/admin/demand-signals/sources");
  if (!canMarkSource(auth.role) || !demandSignalsEnabled(process.env.DEMAND_SIGNALS)) notFound();
  const language = auth.user.language;
  const sb = getServiceRoleClient();
  let view: SourcesView | "unavailable" | "unreadable";
  try {
    const sources = await loadSourceRegister(sb);
    const markers = [...new Set(sources.map((s) => s.markedBy).filter((id): id is string => id !== null))];
    const names: Record<string, string> = {};
    // A name is a label only; a failed lookup shows the mark without a name, never a wrong one. Ids go in chunks
    // (a long id list does not fit a request line).
    for (let i = 0; i < markers.length; i += 50) {
      const { data } = await sb.from("users").select("id,name").in("id", markers.slice(i, i + 50));
      for (const u of (data ?? []) as { id: string; name: string }[]) names[u.id] = u.name;
    }
    view = { sources: sources.map((s) => ({ sourceId: s.sourceId, definitionHash: s.definitionHash, name: s.name, category: s.category, gate: s.gate,
      adapter: s.adapter, status: s.status, termsStatus: s.termsStatus, termsUrl: s.termsUrl, markedAt: s.markedAt,
      markedByName: s.markedBy ? names[s.markedBy] ?? null : null, definition: s.definition })) };
  } catch (e) {
    view = e instanceof DemandSignalError && e.code === "demand_signals_unavailable" ? "unavailable" : "unreadable";
  }
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "signals.sources.title")}</h1>
    <p className="text-co-text-muted">{serverT(language, "signals.sources.intro")}</p>
    <Link href="/admin/demand-signals" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{serverT(language, "signals.sources.back")}</Link>
    {view === "unavailable" && <p className="co-card p-4 text-co-text-muted">{serverT(language, "signals.state.unavailable")}</p>}
    {view === "unreadable" && <p role="alert" className="co-card p-4 font-bold text-co-cta-text">{serverT(language, "signals.state.unreadable")}</p>}
    {typeof view === "object" && <SourcesClient view={view} />}
  </div>;
}
