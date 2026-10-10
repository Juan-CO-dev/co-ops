"use client";

/**
 * The 2D shop-floor map — an SVG of the same stations the 3D scene draws, and the fallback on low-end
 * devices / reduced motion / no WebGL. Each station is a rounded tile: status fill (reinforcement),
 * the station name, the first names covering it and the STATUS WORD. GM+ may drag tiles in
 * arrange mode; positions snap to half grid units.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { FLOOR_MAX_COORD } from "@/lib/pulse/floor-shared";
import type { FloorLayout, FloorStation } from "@/lib/pulse/types";
import { STATUS_FILL, STATUS_KEY } from "@/components/pulse/shared";

const CELL = 100;
const TILE_W = 88;
const TILE_H = 64;

export function Floor2D({ stations, layout, selectedId, onSelect, arranging, onMove, showNames }: {
  stations: FloorStation[];
  layout: FloorLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  arranging: boolean;
  onMove: (id: string, x: number, y: number) => void;
  showNames: boolean;
}) {
  const { t, language } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);

  const xs = stations.map((s) => layout[s.id]?.x ?? 0);
  const ys = stations.map((s) => layout[s.id]?.y ?? 0);
  const cols = Math.max(1, Math.ceil(Math.max(0, ...xs) + 1));
  const rows = Math.max(1, Math.ceil(Math.max(0, ...ys) + 1));
  const width = cols * CELL;
  const height = rows * CELL;

  const toGrid = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * width / CELL, y: ((e.clientY - rect.top) / rect.height) * height / CELL };
  };
  const clamp = (v: number) => Math.max(0, Math.min(FLOOR_MAX_COORD, Math.round(v * 2) / 2));

  const onDown = (e: ReactPointerEvent, id: string) => {
    if (!arranging) return;
    const g = toGrid(e);
    const p = layout[id];
    if (!g || !p) return;
    drag.current = { id, dx: g.x - p.x, dy: g.y - p.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMovePointer = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const g = toGrid(e);
    if (!g) return;
    setLive({ id: d.id, x: Math.max(0, Math.min(FLOOR_MAX_COORD, g.x - d.dx)), y: Math.max(0, Math.min(FLOOR_MAX_COORD, g.y - d.dy)) });
  };
  const onUp = () => {
    const d = drag.current;
    if (d && live && live.id === d.id) onMove(d.id, clamp(live.x), clamp(live.y));
    drag.current = null;
    setLive(null);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={t("pulse.floor.aria_map", { count: stations.length })}
      className="h-auto w-full max-w-full select-none touch-none"
      style={{ maxHeight: 420 }}
      onPointerMove={onMovePointer}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <rect x={0} y={0} width={width} height={height} fill="var(--co-surface-inset)" rx={12} />
      {stations.map((s) => {
        const p = live?.id === s.id ? live : layout[s.id] ?? { x: 0, y: 0 };
        const x = p.x * CELL + (CELL - TILE_W) / 2;
        const y = p.y * CELL + (CELL - TILE_H) / 2;
        const name = language === "es" ? s.nameEs || s.name : s.name;
        const selected = s.id === selectedId;
        const label = t("pulse.floor.aria_station", { station: name, status: t(STATUS_KEY[s.status]) });
        return (
          <g
            key={s.id}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            className={arranging ? "cursor-move" : "cursor-pointer"}
            onClick={() => { if (!arranging) onSelect(selected ? null : s.id); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(selected ? null : s.id); } }}
            onPointerDown={(e) => onDown(e, s.id)}
            style={{ transition: live?.id === s.id ? "none" : "transform 300ms ease" }}
            transform={`translate(${x} ${y})`}
          >
            <rect width={TILE_W} height={TILE_H} rx={10} fill="var(--co-surface)" stroke={selected ? "var(--co-text)" : "var(--co-border-2)"} strokeWidth={selected ? 3 : 1.5} />
            <rect width={TILE_W} height={8} rx={4} y={0} fill={STATUS_FILL[s.status]} />
            <text x={TILE_W / 2} y={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--co-text)">{name.length > 13 ? `${name.slice(0, 12)}…` : name}</text>
            <text x={TILE_W / 2} y={41} textAnchor="middle" fontSize={9} fill="var(--co-text-muted)">
              {showNames || s.people.length > 0 ? s.people.slice(0, 3).join(" · ").slice(0, 20) : s.filled > 0 ? "•".repeat(Math.min(3, s.filled)) : ""}
            </text>
            <text x={TILE_W / 2} y={56} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--co-text-dim)" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{t(STATUS_KEY[s.status])}</text>
          </g>
        );
      })}
    </svg>
  );
}
