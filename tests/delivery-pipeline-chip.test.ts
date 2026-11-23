/**
 * Catering delivery D3 — the pipeline card's delivery chip, and the wiring pins of the three callers that read the
 * delivery fact outside the day plan (the pipeline page, mid-shift, the pulse).
 *
 *  - The chip shows a lead's state from the one label rule; no provider, no entry for the lead, or `none` = no chip.
 *  - Status only: the chip's props and markup carry a state and a time, never a courier, a reference or money.
 *  - The edit to PipelineClient.tsx is one import and one JSX line (a sibling PR edits the same file).
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DELIVERY_CHIP_TONE, DeliveryStateChip, DeliveryStatesProvider } from "@/components/catering/pipeline/DeliveryStateChip";
import { DELIVERY_TONE_TEXT, DELIVERY_UNKNOWN, type DeliveryRowState } from "@/lib/delivery/day-shared";
import { DELIVERY_STATES } from "@/lib/delivery/types-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { TranslationProvider } from "@/lib/i18n/provider";
import { text } from "./helpers/day-render";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;
const row = (state: DeliveryRowState["state"], over: Partial<DeliveryRowState> = {}): DeliveryRowState => ({ state, at: null, status: null, ...over });
function chip(states: Record<string, DeliveryRowState> | null | undefined, leadId = "lead-1", language: "en" | "es" = "en"): string {
  const inner = createElement(DeliveryStateChip, { leadId });
  const tree: ReactNode = states === undefined ? inner : createElement(DeliveryStatesProvider, { states, children: inner });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: tree }));
}

describe("the delivery chip on a pipeline card", () => {
  it("no chip: no provider, a null map (off or a failed read), no entry for the lead, or the state none", () => {
    expect(chip(undefined)).toBe("");
    expect(chip(null)).toBe("");
    expect(chip({})).toBe("");
    expect(chip({ "another-lead": row("to_book") })).toBe("");
    expect(chip({ "lead-1": row("none") })).toBe("");
  });

  it.each(DELIVERY_STATES.filter((s) => s !== "none"))("%s: one chip, its state in a data attribute, its words in en and es", (state) => {
    for (const language of ["en", "es"] as const) {
      const html = chip({ "lead-1": row(state) }, "lead-1", language);
      expect(html.match(/data-testid="delivery-state-chip"/g)).toHaveLength(1);
      expect(html).toContain(`data-delivery-state="${state}"`);
      expect(text(html).length).toBeGreaterThan(0);
      expect(html).toContain("aria-label=");
    }
  });

  it("the words come from the one label rule: 'Courier booked · pick-up 10:40' with a time, 'Courier booked' without", () => {
    expect(text(chip({ "lead-1": row("booked", { at: "2026-11-18T15:40:00.000Z", status: "accepted" }) }))).toBe("Courier booked · pick-up 10:40 AM");
    expect(text(chip({ "lead-1": row("booked", { status: "accepted" }) }))).toBe(EN["catering.delivery_state.booked"]);
    expect(text(chip({ "lead-1": row("to_book") }, "lead-1", "es"))).toBe(ES["catering.delivery_state.to_book"]);
    expect(text(chip({ "lead-1": row("cancel_needed") }))).toBe(EN["catering.delivery_state.cancel_needed"]);
    expect(text(chip({ "lead-1": DELIVERY_UNKNOWN }))).toBe(EN["catering.delivery_state.unknown"]);
  });

  it("every status colour splits fill from text: a pale surface with its TEXT role; never a status fill as text, never red fill", () => {
    expect(DELIVERY_CHIP_TONE.alert).toBe("bg-co-danger-surface text-co-cta-text");
    expect(DELIVERY_CHIP_TONE.warn).toBe("bg-co-warning-surface text-co-warning-text");
    expect(DELIVERY_CHIP_TONE.ok).toBe("bg-co-success-surface text-co-confirm-text");
    for (const cls of [...Object.values(DELIVERY_CHIP_TONE), ...Object.values(DELIVERY_TONE_TEXT)]) {
      expect(cls).not.toMatch(/text-co-(warning|success|danger|cta)(\s|$)/);
      expect(cls).not.toMatch(/bg-co-(cta|danger|warning|success)(\s|$)/);
      expect(cls).not.toContain("co-card-border");
    }
  });
});

describe("the wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("PipelineClient.tsx: one import and one JSX line, nothing else of delivery", () => {
    const lines = src("components/catering/pipeline/PipelineClient.tsx").split("\n").filter((l) => /delivery/i.test(l) && !/deliveryAddress|delivery_address|isDelivery|is_delivery|\.delivery\b|delivery_fee|catering\.pipeline\./i.test(l));
    expect(lines.map((l) => l.trim())).toEqual(['import { DeliveryStateChip } from "./DeliveryStateChip";', "<DeliveryStateChip leadId={lead.id} />"]);
  });

  it("the pipeline page: ONE batched read for the listed leads, through the gated loader; a failed read is said once; off hands no map", () => {
    const page = src("app/(authed)/catering/pipeline/page.tsx");
    expect(page.match(/loadPipelineDeliveryStates\(/g)).toHaveLength(1);
    expect(page).toContain("loadPipelineDeliveryStates(auth, leads.map((l) => l.id))");
    expect(page).toContain('const deliveryStates = "ok" in delivery && delivery.ok ? delivery.states : null;');
    expect(page).toContain('data-delivery-states="failed"');
    expect(page).not.toMatch(/loadDeliveryStates\(|loadLeadDelivery|delivery_job/);
  });

  it("the chip file is a client component with no fetch and no server import (status props only)", () => {
    const chipSrc = src("components/catering/pipeline/DeliveryStateChip.tsx");
    expect(chipSrc).toMatch(/^"use client";/);
    expect(chipSrc).not.toMatch(/fetch\(|supabase|server-only|lib\/delivery\/(day|jobs|settings)"/);
  });

  it("mid-shift: the delivery read needs the full AuthContext (the gate reads the real role and memberships), and attaches by lead id", () => {
    const lib = src("lib/midshift.ts");
    expect(lib).toContain("attachDelivery(cateringDue, args.authContext");
    expect(lib).toContain("await loadDeliveryDay(service, deliveryActorOf(args.authContext), args.locationId, args.date) : null");
    expect(lib.match(/loadDeliveryDay\(/g)).toHaveLength(1);
  });

  it("the pulse: the lane is gated by the status gate before the dep is called, and wired once in the production deps", () => {
    const sections = src("lib/pulse/sections.ts");
    expect(sections).toContain("deps.cateringDelivery && deliveryStatusReadAllowed(deliveryActorOf(ctx.auth), ctx.locationId)");
    expect(sections).toContain("cateringDelivery: (ctx) => loadDeliveryDay(service, deliveryActorOf(ctx.auth), ctx.locationId, ctx.date),");
    expect(sections.match(/loadDeliveryDay\(/g)).toHaveLength(1);
  });

  it("no D3 surface moves a lead's stage, and none writes: the delivery day module has no rpc, insert, update or delete", () => {
    for (const f of ["lib/delivery/day.ts", "lib/delivery/day-shared.ts", "components/catering/pipeline/DeliveryStateChip.tsx"]) {
      expect(src(f), f).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|moveStage|systemMoveStage/);
    }
  });
});
