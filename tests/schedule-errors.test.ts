/**
 * Scheduling Phase 2, Task 1 — the closed refusal vocabulary (plan "Permissions": every refusal is a
 * named code with its own en + es key, `schedule.error.<code>`, compiler-enforced as ScheduleErrorCode).
 */
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { SCHEDULE_ERROR_CODES, ScheduleError, isScheduleErrorCode } from "@/lib/scheduling/errors-shared";

const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

describe("ScheduleErrorCode", () => {
  it("is exactly the plan's closed list", () => {
    expect([...SCHEDULE_ERROR_CODES].sort()).toEqual([
      "schedule_forbidden", "schedule_role_refused", "shop_not_enabled", "shop_not_allowed", "week_not_found", "past_week",
      "day_locked", "head_moved", "edited_week_unconfirmed", "preview_stale", "rules_failing", "generator_invalid_output",
      "structure_invalid", "structure_moved", "budget_invalid", "person_not_at_shop", "position_not_at_shop", "position_retired",
      "horizon_invalid", "horizon_too_long", "edit_off_grid", "edit_overlap", "edit_segments_malformed", "edit_below_segment_min",
      "pin_invalid", "inputs_unavailable", "wage_estimate_invalid", "demand_unavailable", "history_changed", "suggestion_unavailable",
      "unresolved_gaps",
      // CC chunk B ruling 3: the daily maximum shift is a HARD rule
      "shift_over_maximum",
      // chunk D (0274): the SQL writers' payload refusal and the R6 roster rule
      "invalid_payload", "roster_include_refused",
      // chunk D (0275): a certificate that is not the shape of its cause
      "gap_certificate_invalid",
      // CC chunk D ruling 3: the stored context past the lib's safe ceiling (well under 0275's CHECK)
      "context_too_large",
      // Juan 2026-10-20: a primary / secondary position the person's work type does not allow
      "position_rank_not_allowed",
    ].sort());
  });

  it("every code has an en AND an es message, and they differ (es is a real translation)", () => {
    for (const code of SCHEDULE_ERROR_CODES) {
      const k = `schedule.error.${code}`;
      expect(EN[k], k).toBeTruthy();
      expect(ES[k], k).toBeTruthy();
      expect(ES[k]).not.toBe(EN[k]);
    }
  });

  it("the es copy is operational tú, never usted", () => {
    for (const code of SCHEDULE_ERROR_CODES) expect(ES[`schedule.error.${code}`]).not.toMatch(/\busted\b|\bsu contraseña\b/i);
  });

  it("ScheduleError carries its code and an optional key; isScheduleErrorCode guards strings", () => {
    const e = new ScheduleError("structure_invalid", { key: "limits.flexMinimumQ" });
    expect(e.code).toBe("structure_invalid");
    expect(e.key).toBe("limits.flexMinimumQ");
    expect(e.message).toBe("structure_invalid");
    expect(isScheduleErrorCode("past_week")).toBe(true);
    expect(isScheduleErrorCode("nope")).toBe(false);
  });
});
