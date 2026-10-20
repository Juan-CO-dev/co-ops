/**
 * Staff separations — the Users screen, rendered (SSR, en + es): the chip everyone sees, the record only when the server
 * sent it (default-collapsed), the actions by status and authority, the dialogs, the Add user rehire warning. No visible
 * debug text; every control 44 px.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { UserAdminClient } from "@/components/admin/users/UserAdminClient";
import { CreateUserForm } from "@/components/admin/users/CreateUserForm";
import { EmploymentDialog } from "@/components/admin/users/Employment";
import { employmentStateOf, employmentViewFor, type EmploymentEventRow } from "@/lib/admin/employment-shared";
import type { AdminUserListItem } from "@/lib/admin/users";
import type { RehireMatch } from "@/lib/admin/employment";
import type { RoleCode } from "@/lib/roles";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ev = (o: Partial<EmploymentEventRow> & Pick<EmploymentEventRow, "id" | "kind">): EmploymentEventRow => ({ userId: "u", correctsId: null, leaveReason: null,
  expectedBack: null, separationType: null, lastDayWorked: null, reason: null, rehire: null, rehireNote: null, note: null, actorId: "gm", createdAt: "2026-10-16T16:00:00Z", ...o });
const SEP = employmentStateOf([ev({ id: "s1", kind: "separated", separationType: "fired", lastDayWorked: "2026-10-15", reason: "Took cash from the drawer", rehire: "no", rehireNote: "Owner decision" })]);
const LEAVE = employmentStateOf([ev({ id: "l1", kind: "leave_start", leaveReason: "school", expectedBack: "2027-01-05", note: "Fall semester" })]);
const viewFor = (role: RoleCode, state: typeof SEP) => employmentViewFor({ role, locations: [A] }, [A], state);
const person = (id: string, name: string, over: Partial<AdminUserListItem> = {}): AdminUserListItem => ({ id, name, email: null, role: "employee", level: 3, active: true,
  lastLoginAt: null, locationIds: [A], dormantAt: null, dormancy: { dormant: false, reason: null, since: null } as unknown as AdminUserListItem["dormancy"], ...over });

function page(language: "en" | "es", actorRole: RoleCode, users: AdminUserListItem[]) {
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(UserAdminClient, {
    users, allLocations: [{ id: A, name: "Capitol Hill", code: "MEP" }], accessibleLocations: [{ id: A, name: "Capitol Hill", code: "MEP" }], assignableRoles: ["employee"],
    actorRole, actorLevel: 7, actorUserId: "actor", actorLocations: [A], employmentAvailable: true, toastPickerEnabled: false, today: "2026-10-20",
    currentFilters: { role: "", status: "", location: "", q: "" },
  }) }));
}
const users = (role: RoleCode) => [
  person("e1", "Eli"),
  person("s1", "Miguel", { active: false, employment: viewFor(role, SEP) }),
  person("l1", "Danilo", { active: false, employment: viewFor(role, LEAVE) }),
];

describe("the Users list", () => {
  it("the GM of the shop: chips, the collapsed record, End employment / Back from leave / Correct record; no Rehire on `no`", () => {
    const html = page("en", "gm", users("gm"));
    expect(html).toContain("Separated · not eligible for rehire");
    expect(html).toContain("On leave until Tue, Jan 5");
    expect(html).toContain("Separated (1)");
    expect(html).toContain("On leave (1)");
    expect(html).toContain("Employment record");
    expect(html).toContain("Took cash from the drawer");
    expect(html).not.toMatch(/<details[^>]*data-employment-record[^>]* open/);
    expect(html).toContain("End employment");
    expect(html).toContain("Back from leave");
    expect(html).toContain("Correct record");
    expect(html).not.toContain(">Rehire<");
    // Neither on-leave nor separated people are offered the plain Activate.
    const sepRow = html.slice(html.indexOf(">Miguel<"), html.indexOf(">Danilo<"));
    expect(sepRow).not.toContain("Activate");
  });
  it("a viewer the server sent no record to: the chip only, no record panel", () => {
    const html = page("en", "gm", users("agm")); // the views were redacted for a non-GM viewer
    expect(html).toContain("Separated · not eligible for rehire");
    expect(html).not.toContain("Employment record");
    expect(html).not.toContain("Took cash");
    expect(html).not.toContain("Fall semester");
  });
  it("the owner gets Rehire on `no`", () => {
    expect(page("en", "owner", users("owner"))).toContain(">Rehire<");
  });
  it("Spanish, and no debug text", () => {
    const html = page("es", "gm", users("gm"));
    expect(html).toContain("Baja · no se puede recontratar");
    expect(html).toContain("De permiso hasta el");
    expect(html).toContain("Terminar empleo");
    expect(html).toContain("Regresó del permiso");
    for (const h of [html, page("en", "gm", users("gm"))]) expect(h).not.toMatch(/undefined|\[object|NaN|admin\.users\./);
  });
});

function dialog(language: "en" | "es", mode: "end" | "back" | "rehire" | "correct", state = SEP, initialKind?: "leave" | "separated") {
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: createElement(EmploymentDialog, {
    userId: "u", name: "Miguel", view: viewFor("owner", state), mode, onClose: () => {}, today: "2026-10-20", initialKind,
  }) }));
}
describe("from on leave: End employment → Separated, never another leave (Astra BC-036)", () => {
  it("the on-leave row offers End employment beside Back from leave", () => {
    const html = page("en", "gm", users("gm"));
    const leaveRow = html.slice(html.indexOf(">Danilo<"), html.indexOf("data-group=\"separated\""));
    expect(leaveRow).toContain("End employment");
    expect(leaveRow).toContain("Back from leave");
  });
  it("the dialog from on leave is the separation only: no leave choice, the separation fields", () => {
    const html = dialog("en", "end", LEAVE);
    expect(html).not.toContain("On leave — coming back");
    expect(html).toContain("Separated — not coming back");
    for (const s of ["Last day worked", "Eligible for rehire?", "Reason"]) expect(html).toContain(s);
    expect(html).not.toContain("Reason for leave");
    expect(dialog("es", "end", LEAVE)).not.toContain("De permiso — va a regresar");
  });
});

describe("the dialogs", () => {
  it("End employment: the two branches; the separation asks type, last day, reason, rehire; the privacy line", () => {
    const leave = dialog("en", "end", employmentStateOf([]), "leave");
    expect(leave).toContain("On leave — coming back");
    expect(leave).toContain("Reason for leave");
    expect(leave).toContain("They can&#x27;t sign in while on leave");
    const sep = dialog("en", "end", employmentStateOf([]), "separated");
    for (const s of ["Last day worked", "Eligible for rehire?", "Only the owner, the MoO, the CGS and this person&#x27;s GM can read the reason."]) expect(sep).toContain(s);
    expect(sep).toContain('value="2026-10-20"');
    expect(sep).toMatch(/<button[^>]*disabled=""[^>]*>Confirm<\/button>/); // no reason yet
  });
  it("Rehire on `no` asks for the reason; Correct starts from the record in force", () => {
    const rehire = dialog("en", "rehire");
    expect(rehire).toContain("Why are you rehiring this person?");
    expect(rehire).toContain("Separated · not eligible for rehire");
    const correct = dialog("en", "correct");
    expect(correct).toContain("Took cash from the drawer");
    expect(correct).toContain("Owner decision");
  });
  it("every control is 44 px with items-center; Spanish renders", () => {
    for (const html of [dialog("en", "end", employmentStateOf([]), "separated"), dialog("es", "rehire"), dialog("es", "correct", LEAVE)]) {
      for (const m of html.matchAll(/<(button|select|input)[^>]*class="([^"]*)"/g)) {
        if (/type="(radio|checkbox)"/.test(m[0])) continue;
        expect(m[2], m[0]).toContain("min-h-[44px]");
      }
      for (const m of html.matchAll(/<button[^>]*class="([^"]*)"/g)) expect(m[1]).toContain("items-center");
      expect(html).not.toMatch(/undefined|\[object|admin\.users\./);
    }
    expect(dialog("es", "end", employmentStateOf([]), "separated")).toContain("Último día trabajado");
  });
});

describe("Add user: the rehire warning", () => {
  const match = (mayProceed: boolean, detail: boolean): RehireMatch => ({ userId: "s1", name: "Miguel", by: ["phone"], rehire: "no",
    view: detail ? viewFor("owner", SEP) : viewFor("agm", SEP), mayProceed });
  const form = (language: "en" | "es", matches: RehireMatch[]) => renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language,
    children: createElement(CreateUserForm, { assignableRoles: ["employee"], accessibleLocations: [{ id: A, name: "Capitol Hill", code: "MEP" }], onClose: () => {},
      initial: { role: "employee", locationIds: [A], name: "Miguel L", phone: "202-555-0101", matches } }) }));
  it("a match the actor may pass: the chip, how it matched, the confirm box; Add stays off until it is ticked", () => {
    const html = form("en", [match(true, true)]);
    expect(html).toContain("This may be someone who worked here before");
    expect(html).toContain("Same phone");
    expect(html).toContain("Separated · not eligible for rehire");
    expect(html).toContain("I checked — add them anyway");
    expect(html).toContain("Took cash from the drawer"); // the owner's view
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add user<\/button>|<button[^>]*disabled=""[^>]*>[^<]*<\/button>\s*<\/div>\s*<\/div>\s*<\/div>$/);
  });
  it("a match the actor may not pass: no confirm box, who can approve; no reason for a viewer it was not sent to", () => {
    const html = form("en", [match(false, false)]);
    expect(html).not.toContain("I checked — add them anyway");
    expect(html).toContain("Only the owner can approve adding this person.");
    expect(html).not.toContain("Took cash");
    expect(form("es", [match(false, false)])).toContain("Solo el dueño puede aprobar");
  });
  it("the phone field is there, labelled, 44 px", () => {
    const html = form("en", []);
    expect(html).toContain("Phone (optional)");
    expect(html).toMatch(/<input[^>]*type="tel"[^>]*class="[^"]*min-h-\[44px\]/);
    expect(html).not.toContain("This may be someone");
  });
});
