// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructureEditor } from "@/components/schedule/StructureEditor";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { structureProblemLine, structureSaveRefusal } from "@/lib/scheduling/settings-view-shared";
import { CREW_TYPES, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { FLOOR_POSITION, seededFloors } from "./fixtures/schedule/structure-floors";

const { post, refresh } = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok" }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => post }));
beforeEach(() => { post.mockReset().mockResolvedValue({ ok: true, data: {} }); refresh.mockClear(); });
afterEach(cleanup);

function mount(value = seededFloors(), onDirty = vi.fn(), initialError: string | null = null, language: "en" | "es" = "en") {
  const children = createElement(StructureEditor, {
    locationId: "shop", structure: { id: null, source: "saved", value }, closing: { measuredMinutes: null, samples: 0 },
    positions: { [FLOOR_POSITION]: { name: "Prep/Dishwasher", nameEs: "Prep/Lavaplatos" } }, names: {}, onDirty, initialError,
  });
  const providerProps = { initialLanguage: language, children };
  return render(createElement(TranslationProvider, providerProps));
}
const input = (name: string) => document.getElementsByName(name)[0] as HTMLInputElement;

describe("structure problem lines", () => {
  it.each(CREW_TYPES)("maps %s floors and wave bounds", (type) => {
    expect(structureProblemLine(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`)).toEqual({
      key: "schedule.error.structure_line_floor", params: { position: FLOOR_POSITION, dayType: `schedule.board.day_type.${type}` },
    });
    expect(structureProblemLine(`crews.${type}.waveProfile@10:30`)).toEqual({
      key: "schedule.error.structure_wave", params: { dayType: `schedule.board.day_type.${type}`, time: "10:30" },
    });
  });
  it.each(Object.entries({ role: "role", openQ: "open", trimQ: "trim", closeQ: "close", headsBefore: "heads_before", headsAfter: "heads_after", allowedRoles: "allowed" }))(
    "maps position field %s", (field, label) => {
      expect(structureProblemLine(`positions.${FLOOR_POSITION}.${field}`)).toEqual({
        key: "schedule.error.structure_position", params: { position: FLOOR_POSITION, field: `schedule.settings.positions.${label}` },
      });
    },
  );
  it.each(["limits.minimumShiftQ", "positions.id.unknown", "positions.id.toString", "crews.invalid.lineMinHeads.id", "crews.slow.lineMinHeads", "structure"])("preserves fallback %s", (key) => {
    expect(structureProblemLine(key)).toEqual({ key: "schedule.error.structure_invalid", params: { key } });
  });
  it("new lines have matching en/es parameters", () => {
    for (const key of ["schedule.error.structure_line_floor", "schedule.error.structure_position", "schedule.error.structure_wave"] as const) {
      const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(es[key]).toBeTruthy();
      expect(params(es[key])).toEqual(params(en[key]));
    }
  });
});

describe("structure editor floor edits", () => {
  it("a role change hides all four floors and Save posts a valid structure", async () => {
    const original = seededFloors();
    mount(original);
    for (const type of CREW_TYPES) expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("1");
    fireEvent.change(input(`positions.${FLOOR_POSITION}.role`), { target: { value: "prep_dish" } });
    for (const type of CREW_TYPES) expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`)).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const saved = post.mock.calls[0]![1].structure as ScheduleStructure;
    expect(structureSaveRefusal(saved)).toBeNull();
    for (const type of CREW_TYPES) expect(Object.hasOwn(saved.crews[type].lineMinHeads, FLOOR_POSITION)).toBe(false);
    expect(original.positions[FLOOR_POSITION]!.role).toBe("line_other");
  });
  it("zero heads immediately show zero floors", () => {
    mount();
    fireEvent.change(input(`positions.${FLOOR_POSITION}.headsBefore`), { target: { value: "0" } });
    for (const type of CREW_TYPES) expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("0");
  });
  it("repairs the initial draft without marking it dirty or mutating the prop", async () => {
    const s = seededFloors();
    s.positions[FLOOR_POSITION]!.role = "prep_dish";
    const onDirty = vi.fn();
    mount(s, onDirty);
    expect(onDirty).not.toHaveBeenCalled();
    expect(screen.queryByText(en["schedule.settings.unsaved"])).toBeNull();
    expect(s.crews.slow.lineMinHeads[FLOOR_POSITION]).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(structureSaveRefusal(post.mock.calls[0]![1].structure)).toBeNull();
  });
  it.each(["en", "es"] as const)("renders human position, field and day-type labels in %s", (language) => {
    const dict = language === "en" ? en : es;
    const position = language === "en" ? "Prep/Dishwasher" : "Prep/Lavaplatos";
    const view = mount(seededFloors(), vi.fn(), `crews.slow.lineMinHeads.${FLOOR_POSITION}`, language);
    expect(screen.getByRole("alert").textContent).toBe(dict["schedule.error.structure_line_floor"].replace("{position}", position).replace("{dayType}", dict["schedule.board.day_type.slow"]));
    view.unmount();
    mount(seededFloors(), vi.fn(), `positions.${FLOOR_POSITION}.openQ`, language);
    expect(screen.getByRole("alert").textContent).toBe(dict["schedule.error.structure_position"].replace("{position}", position).replace("{field}", dict["schedule.settings.positions.open"]));
  });
  it("focuses an invalid position input and refuses before posting", () => {
    mount();
    const field = input(`positions.${FLOOR_POSITION}.openQ`);
    fireEvent.change(field, { target: { value: "23:00" } });
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole("alert").textContent).toContain("Prep/Dishwasher");
    expect(post).not.toHaveBeenCalled();
  });
});
