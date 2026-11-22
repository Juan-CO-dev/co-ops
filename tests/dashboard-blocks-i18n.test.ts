/**
 * Nav PR 8 (plan r2 section 6; lead rulings r2 B1): every new key of the role blocks, in English and Spanish, non-empty,
 * with the same {params}, in operational tú-form. Every dashboard.strip / needs_you / catering_block / toggle key is one
 * of them. `not_tracked` reaches no "out" key; the universal "every order is in Toast" wording is nowhere.
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

export const DASHBOARD_BLOCK_KEYS = {
  "dashboard.strip.aria": [], "dashboard.strip.link_aria": ["name", "shop"], "dashboard.strip.sales": [], "dashboard.strip.sales_at_least": ["amount"],
  "dashboard.strip.sales_none": [], "dashboard.strip.sales_not_captured": [], "dashboard.strip.labor_day": ["day"], "dashboard.strip.labor_loaded": [],
  "dashboard.strip.labor_pure": [], "dashboard.strip.catering": [], "dashboard.strip.catering_count_one": [], "dashboard.strip.catering_count_other": ["n"],
  "dashboard.strip.catering_booked": ["amount"], "dashboard.strip.catering_estimated": ["n"], "dashboard.strip.catering_no_price": ["n"],
  "dashboard.strip.catering_ezcater_unvalued": ["n"],
  "dashboard.needs_you.aria": [], "dashboard.needs_you.summary": ["n"], "dashboard.needs_you.summary_at_least": ["n"], "dashboard.needs_you.none": [],
  "dashboard.needs_you.tasks_one": [], "dashboard.needs_you.tasks_other": ["n"], "dashboard.needs_you.recipes_one": [], "dashboard.needs_you.recipes_other": ["n"],
  "dashboard.needs_you.inbox_one": [], "dashboard.needs_you.inbox_other": ["n"], "dashboard.needs_you.inbox_unplaced": ["n"], "dashboard.needs_you.unavailable": ["name"],
  "dashboard.catering_block.aria": [], "dashboard.catering_block.guests_one": [], "dashboard.catering_block.guests_other": ["n"],
  "dashboard.catering_block.state.to_go_out": [], "dashboard.catering_block.state.out": ["time"], "dashboard.catering_block.state.out_no_time": [],
  "dashboard.catering_block.state.completed": [], "dashboard.catering_block.state.not_tracked": [], "dashboard.catering_block.no_time": [],
  "dashboard.catering_block.no_count": [], "dashboard.catering_block.next": ["time"], "dashboard.catering_block.tomorrow": [],
  "dashboard.catering_block.tomorrow_one": ["guests"], "dashboard.catering_block.tomorrow_other": ["guests", "n"], "dashboard.catering_block.tomorrow_none": [],
  "dashboard.catering_block.inbox_one": [], "dashboard.catering_block.inbox_other": ["n"], "dashboard.catering_block.inbox_unplaced": ["n"],
  "dashboard.catering_block.inbox_none": [], "dashboard.catering_block.not_rung_one": [], "dashboard.catering_block.not_rung_other": ["n"],
  "dashboard.catering_block.not_rung_none": [], "dashboard.catering_block.not_rung_none_ezcater": [], "dashboard.catering_block.house_not_checked": [],
  "dashboard.toggle.aria": [], "dashboard.toggle.my_shift": [],
} as const satisfies Record<string, readonly string[]>;
const KEYS = Object.keys(DASHBOARD_BLOCK_KEYS) as (keyof typeof DASHBOARD_BLOCK_KEYS)[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("the role blocks' keys", () => {
  it("every dashboard.strip / needs_you / catering_block / toggle key is pinned here, in both languages", () => {
    const family = (d: Record<string, string>) => Object.keys(d).filter((k) => /^dashboard\.(strip|needs_you|catering_block|toggle)\./.test(k)).sort();
    expect(family(EN)).toEqual([...KEYS].sort());
    expect(family(ES)).toEqual([...KEYS].sort());
  });

  it.each(KEYS)("%s: present, non-empty, its {params} in both", (k) => {
    expect(EN[k]?.trim(), k).toBeTruthy();
    expect(ES[k]?.trim(), k).toBeTruthy();
    expect(placeholders(EN[k]!), k).toEqual([...DASHBOARD_BLOCK_KEYS[k]].sort());
    expect(placeholders(ES[k]!), k).toEqual([...DASHBOARD_BLOCK_KEYS[k]].sort());
  });

  it("Spanish is tú-form", () => {
    for (const k of KEYS) {
      expect(ES[k], k).not.toMatch(/\busted(es)?\b/i);
      expect(ES[k], k).not.toMatch(/\b(Abra|Revise|Vea|Haga|Asigne|Registre)\b/);
    }
    expect(ES["dashboard.strip.link_aria"]).toMatch(/^Abre /);
    expect(ES["dashboard.needs_you.summary"]).toMatch(/^Te necesita/);
  });

  it("not_tracked reaches no out key", () => {
    for (const d of [EN, ES]) {
      expect(d["dashboard.catering_block.state.not_tracked"]).not.toBe(d["dashboard.catering_block.state.out_no_time"]);
      expect(d["dashboard.catering_block.state.not_tracked"]).not.toMatch(/\bOut\b|Salió/);
    }
  });

  it("the strip's catering keys are all present; the reused keys exist in both", () => {
    for (const k of ["dashboard.tile.unavailable", "pulse.sales.synced", "pulse.sales.synced_none", "day.reason.catering.none", "day.reason.catering.unavailable",
      "day.task.catering_today", "dashboard.day.next_up", "dashboard.day.holder_unknown", "admin.backoffice.attention.vendor_mail_one",
      "admin.backoffice.attention.vendor_mail_other", "catalog.notices.title", "nav.mid_shift", "catering.inbox.title", "vendorMail.title",
      "reports.business.title", "catering.toast_link.status.not_rung_in_toast"]) {
      expect(EN[k], k).toBeTruthy();
      expect(ES[k], k).toBeTruthy();
    }
  });

  it("B1: no key says every order is in Toast", () => {
    for (const d of [EN, ES]) expect(Object.values(d).filter((v) => /every order is in toast|todos los pedidos están en toast/i.test(v))).toEqual([]);
  });
});
