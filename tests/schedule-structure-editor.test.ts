// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructureEditor } from "@/components/schedule/StructureEditor";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { structureProblemLine, structureSaveRefusal } from "@/lib/scheduling/settings-view-shared";
import { CREW_TYPES, POSITION_ROLE_DEFAULTS, type PositionTimeProvenance, type ScheduleStructure } from "@/lib/scheduling/structure-shared";
import { FLOOR_POSITION, OTHER_POSITION, seededFloors, PSTREET_ROLES, pStreetSeed } from "./fixtures/schedule/structure-floors";

const { post, refresh } = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: async () => "ok" }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => post }));
beforeEach(() => { post.mockReset().mockResolvedValue({ ok: true, data: {} }); refresh.mockClear(); });
afterEach(cleanup);

function mount(value = seededFloors(), onDirty = vi.fn(), initialError: string | null = null, language: "en" | "es" = "en", timeProvenance: Record<string, PositionTimeProvenance> = {}, source: "saved" | "defaults" = "saved") {
  const children = createElement(StructureEditor, {
    locationId: "shop", structure: { id: null, source, value }, closing: { measuredMinutes: null, samples: 0 },
    positions: { [FLOOR_POSITION]: { name: "Prep/Dishwasher", nameEs: "Prep/Lavaplatos" } }, names: {}, onDirty, initialError, timeProvenance,
  });
  const providerProps = { initialLanguage: language, children };
  return render(createElement(StrictMode, null, createElement(TranslationProvider, providerProps)));
}
const input = (name: string) => document.getElementsByName(name)[0] as HTMLInputElement;

describe("crew structure editor", () => {
  it.each(["en", "es"] as const)("refuses selecting crew without shift types before posting (%s)", (language) => {
    mount(seededFloors(), vi.fn(), null, language);
    const dict = language === "en" ? en : es;
    fireEvent.change(input("engine"), { target: { value: "crew" } });
    fireEvent.click(screen.getByRole("button", { name: dict["schedule.settings.save"] }));
    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    const invalid = seededFloors(); invalid.engine = "crew"; invalid.shiftTypes = [];
    expect(structureSaveRefusal(invalid)).not.toBeNull();
  });
  it("exposes the engine, places shift types below Shop day, and preserves a saved engine", async () => {
    const structure = seededFloors();
    structure.engine = "crew";
    structure.shiftTypes = [{ id: "morning", name: "Morning", fromQ: 28, toQ: 60, startFlexQ: 0, minLengthQ: 16,
      headcount: { slow: 0, normal: 0, busy: 0, weekend: 0 }, stations: [], countsTowardMod: true }];
    mount(structure);
    expect(input("engine").value).toBe("crew");
    expect(Array.from(document.querySelectorAll("[data-structure-section]")).slice(0, 2).map((el) => el.getAttribute("data-structure-section"))).toEqual(["shop_day", "shift_types"]);
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]![1].structure.engine).toBe("crew");
  });
  it("adds distinct identities without randomUUID", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      mount();
      for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.shift_types.add"] }));
      const ids = Array.from(document.querySelectorAll("[data-shift-type]")).map((el) => el.getAttribute("data-shift-type"));
      expect(new Set(ids).size).toBe(2);
      expect(ids.every(Boolean)).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(globalThis.crypto, "randomUUID", descriptor);
      else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    }
  });
  it.each(["en", "es"] as const)("focuses the card name for an invalid identity in %s", (language) => {
    const structure = seededFloors();
    structure.shiftTypes = [{ id: "", name: "Morning", fromQ: 28, toQ: 60, startFlexQ: 0, minLengthQ: 16,
      headcount: { slow: 0, normal: 0, busy: 0, weekend: 0 }, stations: [], countsTowardMod: true }];
    mount(structure, vi.fn(), null, language);
    const dict = language === "en" ? en : es;
    fireEvent.click(screen.getByRole("button", { name: dict["schedule.settings.save"] }));
    expect(document.activeElement).toBe(input("shiftTypes.0.name"));
    expect(screen.getByRole("alert").textContent).toContain(dict["schedule.error.structure_shift_identity"].replace("{number}", "1"));
    expect(post).not.toHaveBeenCalled();
  });

  it("represents and saves the end-of-day quarter without clamping it", async () => {
    const structure = seededFloors();
    structure.shopDay.outLatestQ = 96;
    mount(structure);
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.shift_types.add"] }));
    expect(input("shiftTypes.0.toQ").value).toBe("24:00");
    expect(screen.getByRole("option", { name: en["schedule.settings.shift_types.end_of_day"] })).toBeTruthy();
    fireEvent.change(input("shiftTypes.0.toQ"), { target: { value: "23:45" } });
    fireEvent.change(input("shiftTypes.0.toQ"), { target: { value: "24:00" } });
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(post.mock.calls[0]![1].structure.shiftTypes[0].toQ).toBe(96);
  });
  it.each(["en", "es"] as const)("edits whole shift types and catering and saves stable IDs in %s", async (language) => {
    const dict = language === "en" ? en : es;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount(seededFloors(), vi.fn(), null, language);
    fireEvent.click(screen.getByRole("button", { name: dict["schedule.settings.shift_types.add"] }));
    const id = document.querySelector("[data-shift-type]")!.getAttribute("data-shift-type");
    fireEvent.change(input("shiftTypes.0.name"), { target: { value: "Morning" } });
    fireEvent.change(input("shiftTypes.0.fromQ"), { target: { value: "08:00" } });
    fireEvent.change(input("shiftTypes.0.toQ"), { target: { value: "16:00" } });
    fireEvent.change(input("shiftTypes.0.startFlexQ"), { target: { value: "60" } });
    fireEvent.change(input("shiftTypes.0.minLengthQ"), { target: { value: "240" } });
    fireEvent.change(input("shiftTypes.0.headcount.busy"), { target: { value: "4" } });
    fireEvent.change(input("shiftTypes.0.stations"), { target: { value: FLOOR_POSITION } });
    fireEvent.click(input("shiftTypes.0.countsTowardMod"));
    expect(input("engine").value).toBe("stations");
    fireEvent.change(input("engine"), { target: { value: "crew" } });
    fireEvent.click(input("catering.crewShift.enabled"));
    fireEvent.change(input("catering.crewShift.typeId"), { target: { value: id } });
    fireEvent.change(input("catering.crewShift.extraHeads"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: dict["schedule.settings.save"] }));
    expect(confirm).toHaveBeenCalledWith(dict["schedule.settings.shift_types.engine_confirm"]);
    expect(post).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: dict["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    confirm.mockRestore();
    const saved = post.mock.calls[0]![1].structure as ScheduleStructure;
    expect(saved.shiftTypes).toEqual([{ id, name: "Morning", fromQ: 32, toQ: 64, startFlexQ: 4, minLengthQ: 16, headcount: { slow: 0, normal: 0, busy: 4, weekend: 0 }, stations: [FLOOR_POSITION], countsTowardMod: false }]);
    expect(saved.engine).toBe("crew");
    expect(saved.catering.crewShift).toEqual({ enabled: true, typeId: id, extraHeads: 2 });
    expect(structureSaveRefusal(saved)).toBeNull();
  });
  it("reorders types and stations without changing IDs and removes a type", async () => {
    mount();
    const add = () => fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.shift_types.add"] }));
    add();
    fireEvent.change(input("shiftTypes.0.name"), { target: { value: "Morning" } });
    const id = document.querySelector("[data-shift-type]")!.getAttribute("data-shift-type");
    fireEvent.change(input("shiftTypes.0.stations"), { target: { value: FLOOR_POSITION } });
    fireEvent.change(input("shiftTypes.0.stations"), { target: { value: OTHER_POSITION } });
    const stationDown = document.querySelector("[data-shift-type] ol button[aria-label^='Move'][aria-label$='down']")!;
    fireEvent.click(stationDown);
    add();
    fireEvent.change(input("shiftTypes.1.name"), { target: { value: "Evening" } });
    fireEvent.click(screen.getByRole("button", { name: "Move Evening up" }));
    expect(document.querySelectorAll("[data-shift-type]")[1]!.getAttribute("data-shift-type")).toBe(id);
    fireEvent.click(screen.getByRole("button", { name: "Remove Evening" }));
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const saved = post.mock.calls[0]![1].structure as ScheduleStructure;
    expect(saved.shiftTypes).toHaveLength(1);
    expect(saved.shiftTypes![0]!.id).toBe(id);
    expect(saved.shiftTypes![0]!.stations).toEqual([OTHER_POSITION, FLOOR_POSITION]);
  });
  it("keeps a removed catering reference visible for correction", () => {
    mount();
    expect(input("engine").value).toBe("stations");
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.shift_types.add"] }));
    const id = document.querySelector("[data-shift-type]")!.getAttribute("data-shift-type");
    fireEvent.change(input("catering.crewShift.typeId"), { target: { value: id } });
    fireEvent.click(screen.getByRole("button", { name: `Remove ${en["schedule.settings.shift_types.unnamed"]}` }));
    expect(input("catering.crewShift.typeId").value).toBe(id);
    expect(screen.getByRole("option", { name: en["schedule.settings.shift_types.removed_type"] })).toBeTruthy();

    fireEvent.click(input("catering.crewShift.enabled"));
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    expect(screen.getByRole("alert").textContent).toContain(en["schedule.settings.shift_types.catering_type"]);
    expect(document.activeElement).toBe(input("catering.crewShift.typeId"));
    expect(post).not.toHaveBeenCalled();
  });
});

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
  it.each([0, undefined])("swaps floor intent and presence across all crews (secondary %s), then restores it", async (secondaryFloor) => {
    const s = seededFloors();
    s.positions[FLOOR_POSITION]!.role = "register";
    s.positions[OTHER_POSITION]!.role = "expo";
    s.priority = [{ pair: [FLOOR_POSITION, OTHER_POSITION], primary: FLOOR_POSITION }];
    for (const type of CREW_TYPES) {
      if (secondaryFloor === undefined) delete s.crews[type].lineMinHeads[OTHER_POSITION];
      else s.crews[type].lineMinHeads[OTHER_POSITION] = secondaryFloor;
    }
    mount(s);
    const swap = () => fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.positions.swap"] }));
    swap();
    for (const type of CREW_TYPES) {
      expect(input(`crews.${type}.lineMinHeads.${OTHER_POSITION}`).value).toBe("1");
      expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("0");
    }
    swap();
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const saved = post.mock.calls[0]![1].structure as ScheduleStructure;
    for (const type of CREW_TYPES) expect(saved.crews[type].lineMinHeads).toEqual(s.crews[type].lineMinHeads);
  });
  it("clamps floor intent when typed, so raising heads cannot resurrect it", () => {
    mount();
    const floor = input(`crews.slow.lineMinHeads.${FLOOR_POSITION}`);
    expect(floor.max).toBe("1");
    fireEvent.change(floor, { target: { value: "3" } });
    expect(floor.value).toBe("1");
    fireEvent.change(input(`positions.${FLOOR_POSITION}.headsBefore`), { target: { value: "3" } });
    expect(floor.value).toBe("1");
  });
  it("leaves an unchanged saved structure clean", () => {
    const onDirty = vi.fn();
    mount(seededFloors(), onDirty);
    expect(onDirty).not.toHaveBeenCalled();
    expect(screen.queryByText(en["schedule.settings.structure_adjusted"])).toBeNull();
  });

  it("maps the unmapped seed, swaps a newly derived pair and saves its effective floors", async () => {
    mount(pStreetSeed());
    for (const [id, role] of Object.entries(PSTREET_ROLES)) {
      fireEvent.change(input(`positions.${id}.role`), { target: { value: role } });
    }
    const register = Object.keys(PSTREET_ROLES).find((id) => PSTREET_ROLES[id] === "register")!;
    const expo = Object.keys(PSTREET_ROLES).find((id) => PSTREET_ROLES[id] === "expo")!;
    const swaps = () => screen.getAllByRole("button", { name: en["schedule.settings.positions.swap"] });
    expect(swaps()).toHaveLength(3);
    for (const type of CREW_TYPES) {
      expect(input(`crews.${type}.lineMinHeads.${expo}`).value).toBe("0");
      expect(input(`crews.${type}.lineMinHeads.${expo}`).max).toBe("0");
    }
    fireEvent.click(swaps()[1]!);
    // Remove an earlier pair: the next swap must still target the displayed pair, not its draft index.
    const prep = Object.keys(PSTREET_ROLES).find((id) => PSTREET_ROLES[id] === "prep")!;
    fireEvent.change(input(`positions.${prep}.role`), { target: { value: "line_other" } });
    fireEvent.click(swaps()[0]!);
    fireEvent.click(swaps()[0]!);
    fireEvent.change(input(`positions.${expo}.role`), { target: { value: "line_other" } });
    expect(input(`crews.slow.lineMinHeads.${register}`).value).toBe("1");
    fireEvent.change(input(`positions.${expo}.role`), { target: { value: "expo" } });
    for (const type of CREW_TYPES) {
      expect(input(`crews.${type}.lineMinHeads.${register}`).value).toBe("0");
      expect(input(`crews.${type}.lineMinHeads.${expo}`).value).toBe("1");
    }
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const saved = post.mock.calls[0]![1].structure as ScheduleStructure;
    expect(saved.priority.find((p) => p.pair.includes(register))?.primary).toBe(expo);
    expect(structureSaveRefusal(saved)).toBeNull();
  });
  it("uses station provenance when changing a role with default-valued times", () => {
    mount(seededFloors(), vi.fn(), null, "en", { [FLOOR_POSITION]: { closeFromStation: true, trimFromStation: true } });
    fireEvent.change(input(`positions.${FLOOR_POSITION}.role`), { target: { value: "register" } });
    expect(input(`positions.${FLOOR_POSITION}.closeQ`).value).toBe("15:30");
    expect(input(`positions.${FLOOR_POSITION}.trimQ`).value).toBe("15:30");
  });
  it("restores floor intent when a time edit temporarily empties the window", () => {
    mount();
    const open = input(`positions.${FLOOR_POSITION}.openQ`);
    fireEvent.change(open, { target: { value: "15:30" } });
    expect(input(`crews.slow.lineMinHeads.${FLOOR_POSITION}`).value).toBe("0");
    fireEvent.change(open, { target: { value: "09:30" } });
    expect(input(`crews.slow.lineMinHeads.${FLOOR_POSITION}`).value).toBe("1");
  });
  it("preserves intent through an empty heads input and posts effective floors", async () => {
    mount();
    const heads = input(`positions.${FLOOR_POSITION}.headsBefore`);
    fireEvent.change(heads, { target: { value: "" } });
    for (const type of CREW_TYPES) expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("0");
    fireEvent.change(heads, { target: { value: "2" } });
    for (const type of CREW_TYPES) {
      expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("1");
      expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).max).toBe("2");
    }
    fireEvent.change(heads, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: en["schedule.settings.save"] }));
    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    const saved = post.mock.calls[0]![1].structure as ScheduleStructure;
    for (const type of CREW_TYPES) expect(saved.crews[type].lineMinHeads[FLOOR_POSITION]).toBe(0);
    expect(structureSaveRefusal(saved)).toBeNull();
  });
  it("restores floor intent after changing to prep and back", () => {
    mount();
    const role = input(`positions.${FLOOR_POSITION}.role`);
    fireEvent.change(role, { target: { value: "prep" } });
    fireEvent.change(role, { target: { value: "line_other" } });
    for (const type of CREW_TYPES) expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("1");
  });
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
    expect(saved.positions[FLOOR_POSITION]).toEqual(POSITION_ROLE_DEFAULTS.prep_dish);
    for (const type of CREW_TYPES) expect(Object.hasOwn(saved.crews[type].lineMinHeads, FLOOR_POSITION)).toBe(false);
    expect(original.positions[FLOOR_POSITION]!.role).toBe("line_other");
  });
  it("zero heads immediately show zero floors", () => {
    mount();
    fireEvent.change(input(`positions.${FLOOR_POSITION}.headsBefore`), { target: { value: "0" } });
    for (const type of CREW_TYPES) expect(input(`crews.${type}.lineMinHeads.${FLOOR_POSITION}`).value).toBe("0");
  });
  it.each(["saved", "defaults"] as const)("makes initial normalization visible only for %s structures", async (source) => {
    const s = seededFloors();
    s.positions[FLOOR_POSITION]!.role = "prep_dish";
    const onDirty = vi.fn();
    mount(s, onDirty, null, "en", {}, source);
    expect(onDirty).toHaveBeenCalledTimes(source === "saved" ? 1 : 0);
    if (source === "saved") expect(onDirty).toHaveBeenCalledWith(true);
    expect(Boolean(screen.queryByText(en["schedule.settings.unsaved"]))).toBe(source === "saved");
    expect(Boolean(screen.queryByText(en["schedule.settings.structure_adjusted"]))).toBe(source === "saved");
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
