import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeName, parseToastEmployees, planLinks, suggestUsers, toastDisplayName, toastFullNames, type ToastEmployee,
} from "@/lib/toast/employee-links-shared";

const fixture = JSON.parse(readFileSync("tests/fixtures/toast/labor-employees-sample.json", "utf8")) as unknown;
const emp = (guid: string, firstName: string | null, lastName: string | null, extra: Partial<ToastEmployee> = {}): ToastEmployee =>
  ({ guid, firstName, chosenName: null, lastName, deleted: false, ...extra });

describe("Toast employees: what is read", () => {
  it("reads guid, first, chosen, last and deleted from the contract-shaped fixture, nothing else", () => {
    const parsed = parseToastEmployees(fixture);
    expect(parsed).toEqual([
      { guid: "emp-ana", firstName: "Ana María", chosenName: null, lastName: "López", deleted: false },
      { guid: "emp-luis", firstName: "Luis", chosenName: "Lu", lastName: "Pérez", deleted: false },
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/@|2025550100|wage/i);
  });
  it("refuses a non-array payload and drops guid-less rows", () => {
    expect(() => parseToastEmployees({ employees: [] })).toThrow("toast_employees_bad_payload");
    expect(parseToastEmployees([{ firstName: "No guid" }])).toEqual([]);
  });
  it("full names are legal first + last and chosen + last; no last name means no full name", () => {
    expect(toastFullNames(emp("g", "Luis", "Pérez", { chosenName: "Lu" }))).toEqual(["luis pérez", "lu pérez"]);
    expect(toastFullNames(emp("g", "Maya", null))).toEqual([]);
    expect(normalizeName("  ANA   María  López ")).toBe("ana maría lópez");
    expect(toastDisplayName(emp("g", "Luis", "Pérez", { chosenName: "Lu" }))).toBe("Lu Pérez");
  });
});

describe("auto links: exact full name at the same shop, unique both ways", () => {
  const users = [
    { id: "u-ana", name: "Ana María López" },
    { id: "u-luis", name: "luis  PÉREZ" },
    { id: "u-maya", name: "Maya" },
  ];
  it("auto-links exact full-name matches (case/whitespace only) and reviews the rest", () => {
    const plan = planLinks([...parseToastEmployees(fixture), emp("emp-maya", "Maya", "Stone")], users, []);
    expect(plan.auto).toEqual([{ employeeGuid: "emp-ana", userId: "u-ana" }, { employeeGuid: "emp-luis", userId: "u-luis" }]);
    // "Maya" alone is a first name: never an auto link, only a suggestion.
    expect(plan.review).toEqual([{ employee: emp("emp-maya", "Maya", "Stone"), suggestions: [{ userId: "u-maya", kind: "first_name" }] }]);
  });
  it("NEVER links on a first name alone, even when it is the only candidate", () => {
    const plan = planLinks([emp("e1", "Maya", null)], [{ id: "u-maya", name: "Maya" }], []);
    expect(plan.auto).toEqual([]);
    expect(plan.review[0]!.suggestions).toEqual([{ userId: "u-maya", kind: "first_name" }]);
  });
  it("accents are not folded: Jose Perez vs José Pérez is a suggestion, not a link", () => {
    const plan = planLinks([emp("e1", "José", "Pérez")], [{ id: "u1", name: "Jose Perez" }], []);
    expect(plan.auto).toEqual([]);
    expect(plan.review[0]!.suggestions).toEqual([]);
    const near = planLinks([emp("e1", "José", "Pérez")], [{ id: "u1", name: "José A Pérez" }], []);
    expect(near.auto).toEqual([]);
    expect(near.review[0]!.suggestions).toEqual([{ userId: "u1", kind: "last_name" }]);
  });
  it("two CO-OPS users with the same full name: review, both suggested", () => {
    const plan = planLinks([emp("e1", "Sam", "Lee")], [{ id: "u1", name: "Sam Lee" }, { id: "u2", name: "Sam Lee" }], []);
    expect(plan.auto).toEqual([]);
    expect(plan.review[0]!.suggestions).toEqual([{ userId: "u1", kind: "full_name" }, { userId: "u2", kind: "full_name" }]);
  });
  it("two Toast employees answering to one user's full name: review, not a link", () => {
    const plan = planLinks([emp("e1", "Sam", "Lee"), emp("e2", "Samuel", "Lee", { chosenName: "Sam" })], [{ id: "u1", name: "Sam Lee" }], []);
    expect(plan.auto).toEqual([]);
    expect(plan.review.map((r) => r.employee.guid)).toEqual(["e1", "e2"]);
  });
  it("matches the chosen name + last name", () => {
    expect(planLinks([emp("e1", "Luis", "Pérez", { chosenName: "Lu" })], [{ id: "u1", name: "Lu Pérez" }], []).auto)
      .toEqual([{ employeeGuid: "e1", userId: "u1" }]);
  });
  it("already-linked employees and users are out of both lists; inactive links do not count", () => {
    const links = [{ id: "l1", employeeGuid: "emp-ana", userId: "u-ana", active: true, source: "manual" as const },
      { id: "l0", employeeGuid: "emp-luis", userId: "u-other", active: false, source: "auto" as const }];
    const plan = planLinks(parseToastEmployees(fixture), users, links);
    expect(plan.auto).toEqual([{ employeeGuid: "emp-luis", userId: "u-luis" }]);
    expect(plan.review).toEqual([]);
    // A user already linked to another employee is not offered again.
    const taken = planLinks([emp("e9", "Ana María", "López")], users, links);
    expect(taken.auto).toEqual([]);
    expect(taken.review[0]!.suggestions.some((s) => s.userId === "u-ana")).toBe(false);
  });
  it("archived (deleted) Toast employees are never auto-linked and sort last in review", () => {
    const plan = planLinks([emp("e1", "Ana María", "López", { deleted: true }), emp("e2", "Zed", "Q")], users, []);
    expect(plan.auto).toEqual([]);
    expect(plan.review.map((r) => r.employee.guid)).toEqual(["e2", "e1"]);
  });
  it("suggestion ranking: full, then last name + initial, then first name", () => {
    expect(suggestUsers(emp("e", "Ana", "Ruiz"), [{ id: "c", name: "Ana" }, { id: "b", name: "A. Ruiz" }, { id: "a", name: "Ana Ruiz" }]))
      .toEqual([{ userId: "a", kind: "full_name" }, { userId: "b", kind: "last_name" }, { userId: "c", kind: "first_name" }]);
  });
});
