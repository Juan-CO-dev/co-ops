"use client";

/**
 * Live shop floor — the hero visual. Decides 3D vs 2D ONCE per mount from the device
 * (WebGL · reduced motion · low power · save-data) through the pure `choose3D`, loads the three.js
 * scene lazily with next/dynamic (ssr:false, 2D map as the loading fallback), and never blocks the
 * rest of the pulse: it is one card with its own data and its own clock. GM+ can arrange the tiles
 * and save the layout (POST /api/pulse/layout, audited server-side).
 */
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ActionButton } from "@/components/ActionButton";
import { useTranslation } from "@/lib/i18n/provider";
import { choose3D } from "@/lib/pulse/floor-shared";
import type { FloorData, FloorLayout, FloorStation } from "@/lib/pulse/types";
import { Floor2D } from "@/components/pulse/floor/Floor2D";
import { StationDrawer } from "@/components/pulse/floor/StationDrawer";
import { STATUS_KEY } from "@/components/pulse/shared";

const Floor3D = dynamic(() => import("@/components/pulse/floor/Floor3D"), {
  ssr: false,
  loading: () => <div className="h-[300px] w-full animate-pulse rounded-lg bg-co-surface-inset sm:h-[340px]" aria-hidden />,
});

/** Device facts → the pure decision. Runs only in the browser. */
export function detect3D(): boolean {
  if (typeof window === "undefined") return false;
  let webgl = false;
  try {
    const c = document.createElement("canvas");
    webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { webgl = false; }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return choose3D({
    webgl,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    lowPower: (nav.hardwareConcurrency ?? 4) <= 2 || (nav.deviceMemory ?? 4) < 2,
    saveData: nav.connection?.saveData === true,
  });
}

// The device decision is an EXTERNAL fact, read once per page: null on the server (the 2D map renders
// first), the real answer on the client. useSyncExternalStore keeps it out of an effect.
let detected: boolean | null = null;
const subscribeNever = () => () => {};
const readDetected = () => { if (detected === null) detected = detect3D(); return detected; };
const serverSnapshot = () => null;

export function FloorCard({ data, mode, onSaved }: { data: FloorData; mode: "card" | "detail"; onSaved: () => Promise<void> }) {
  const { t } = useTranslation();
  const deviceWants3D = useSyncExternalStore(subscribeNever, readDetected, serverSnapshot);
  const [override, setOverride] = useState<boolean | null>(null);
  const use3D: boolean | null = override ?? deviceWants3D;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [draft, setDraft] = useState<FloorLayout | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const layout = useMemo(() => draft ?? data.layout ?? {}, [draft, data.layout]);
  const selected = data.stations.find((s) => s.id === selectedId) ?? null;
  const statusLabel = useCallback((s: FloorStation) => t(STATUS_KEY[s.status]), [t]);
  const onMove = useCallback((id: string, x: number, y: number) => setDraft((prev) => ({ ...(prev ?? data.layout ?? {}), [id]: { x, y } })), [data.layout]);
  const save = async () => {
    if (!draft) { setArranging(false); return; }
    setSaveState("saving");
    try {
      const res = await fetch("/api/pulse/layout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId: data.locationId, layout: draft }) });
      if (!res.ok) { setSaveState("failed"); return; }
      setSaveState("saved"); setArranging(false); setDraft(null);
      await onSaved();
    } catch { setSaveState("failed"); }
  };
  const common = useMemo(() => ({ stations: data.stations, layout, selectedId, onSelect: setSelectedId, arranging, onMove }), [data.stations, layout, selectedId, arranging, onMove]);

  if (data.stations.length === 0) return <p className="text-sm text-co-text-muted">{t("pulse.floor.empty")}</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-co-text-muted">{arranging ? t("pulse.floor.arrange_hint") : t("pulse.floor.tap_hint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {use3D !== null && (
            <button type="button" onClick={() => setOverride(!use3D)} className="inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text" aria-pressed={use3D}>
              {t(use3D ? "pulse.floor.mode_2d" : "pulse.floor.mode_3d")}
            </button>
          )}
          {data.canArrange && !arranging && <ActionButton variant="secondary" onClick={() => { setArranging(true); setSaveState("idle"); setSelectedId(null); }}>{t("pulse.floor.arrange")}</ActionButton>}
          {arranging && <>
            <ActionButton variant="secondary" onClick={() => { setArranging(false); setDraft(null); }}>{t("pulse.floor.arrange_cancel")}</ActionButton>
            <ActionButton onClick={() => void save()} disabled={saveState === "saving"}>{t("pulse.floor.arrange_done")}</ActionButton>
          </>}
        </div>
      </div>
      {use3D === true ? <Floor3D {...common} statusLabel={statusLabel} /> : <Floor2D {...common} showNames={data.showNames} />}
      {use3D === false && <p className="mt-1 text-[11px] text-co-text-dim">{t("pulse.floor.fallback_note")}</p>}
      <p className="mt-1 text-[11px] text-co-text-dim">{t("pulse.floor.legend")}</p>
      {saveState === "saved" && <p role="status" className="mt-1 text-xs text-co-confirm-text">{t("pulse.floor.arrange_saved")}</p>}
      {saveState === "failed" && <p role="alert" className="mt-1 text-xs text-co-cta-text">{t("pulse.floor.arrange_failed")}</p>}
      {selected && <StationDrawer station={selected} locationId={data.locationId} canAct={data.showNames} onClose={() => setSelectedId(null)} />}
      {mode === "detail" && (
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
          {data.stations.map((s) => <li key={s.id} className="flex min-h-[28px] items-center justify-between gap-2"><span className="font-semibold text-co-text">{s.name}</span><span className="text-co-text-muted">{statusLabel(s)}{s.people.length ? ` · ${s.people.join(", ")}` : ""}</span></li>)}
        </ul>
      )}
    </div>
  );
}
