/** Page resolution: the shop gate (bind + listed), the both-shops default for 8+, and the section-page access decision. */
import { describe, expect, it } from "vitest";
import { BOTH, resolvePulsePanels, resolveRequestedLocation } from "@/lib/pulse/page-shared";
import { sectionAccess } from "@/lib/pulse/scope-shared";
import { resolveBackLink } from "@/lib/nav-parents";

const A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MEP", name: "Capitol Hill" };
const B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "EM", name: "P Street" };
const gm = { role: "gm" as const, locations: [A.id], level: 7 };
const owner = { role: "owner" as const, locations: [] as string[], level: 9 };
const moo = { role: "moo" as const, locations: [A.id], level: 8 };

describe("resolveRequestedLocation", () => {
  it("defaults to the first accessible shop; refuses a shop outside the bind or the listed set", () => {
    expect(resolveRequestedLocation({ requested: undefined, accessible: [A], actor: gm })).toBe(A.id);
    expect(resolveRequestedLocation({ requested: B.id, accessible: [A], actor: gm })).toBeNull();
    expect(resolveRequestedLocation({ requested: B.id, accessible: [A, B], actor: gm })).toBeNull(); // listed but not bound
    expect(resolveRequestedLocation({ requested: B.id, accessible: [A, B], actor: owner })).toBe(B.id); // 9+ grant
    expect(resolveRequestedLocation({ requested: undefined, accessible: [], actor: owner })).toBeNull();
    // Astra #5: a level-8 moo assigned to A may read B through the PULSE read grant.
    expect(resolveRequestedLocation({ requested: B.id, accessible: [A, B], actor: moo })).toBe(B.id);
  });
});

describe("resolvePulsePanels", () => {
  it("GM: always one panel, their shop", () => {
    expect(resolvePulsePanels({ requested: undefined, accessible: [A], actor: gm })).toEqual([A]);
    expect(resolvePulsePanels({ requested: BOTH, accessible: [A], actor: gm })).toEqual([A]);
  });
  it("8+ with two shops: both by default or on ?location=both; one shop when a shop is named", () => {
    expect(resolvePulsePanels({ requested: undefined, accessible: [A, B], actor: owner })).toEqual([A, B]);
    expect(resolvePulsePanels({ requested: BOTH, accessible: [A, B], actor: owner })).toEqual([A, B]);
    expect(resolvePulsePanels({ requested: B.id, accessible: [A, B], actor: owner })).toEqual([B]);
    expect(resolvePulsePanels({ requested: undefined, accessible: [A], actor: owner })).toEqual([A]);
    // Astra #5: level 8 (Dir. of Ops) with one membership still gets BOTH shops side by side.
    expect(resolvePulsePanels({ requested: undefined, accessible: [A, B], actor: moo })).toEqual([A, B]);
    expect(resolvePulsePanels({ requested: B.id, accessible: [A, B], actor: moo })).toEqual([B]);
  });
});

describe("section pages", () => {
  it("decide with the same matrix as the API", () => {
    expect(sectionAccess({ flagOn: false, level: 9, section: "people" })).toBe("not_found");
    expect(sectionAccess({ flagOn: true, level: 3, section: "people" })).toBe("denied");
    expect(sectionAccess({ flagOn: true, level: 4, section: "people" })).toBe("ok");
  });
  it("back from a section page lands on the pulse, carrying the shop", () => {
    const back = resolveBackLink("/mid-shift/sales", { search: "?location=x" });
    expect(back.href).toBe("/mid-shift?location=x");
    expect(back.labelKey).toBe("pulse.page.back");
  });
});
