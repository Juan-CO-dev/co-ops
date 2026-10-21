import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { UserAdminClient } from "@/components/admin/users/UserAdminClient";
import { ToastEmployeeLinks } from "@/components/admin/toast-employees/ToastEmployeeLinks";
import type { AdminUserListItem } from "@/lib/admin/users";
import type { LinkReview } from "@/lib/toast/employee-links";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
const user: AdminUserListItem = { id: "u", name: "Ana", email: null, role: "employee", level: 3,
  active: true, lastLoginAt: null, locationIds: [], dormantAt: "2026-10-01",
  dormancy: { dormant: true, reason: "manual", since: "2026-10-01" } };
const filters = { role: "", status: "", location: "", q: "" };
function users(filter = filters) {
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(UserAdminClient, {
    users: [user], allLocations: [], accessibleLocations: [], assignableRoles: [], actorRole: "owner", actorLevel: 9, currentFilters: filter,
    actorUserId: "actor", actorLocations: [], employmentAvailable: false, toastPickerEnabled: false, today: "2026-10-20",
  }) }));
}
describe("user list discoverability", () => {
  it("puts dormant users and their actions in a closed section", () => {
    const html = users();
    expect(html).toContain("Dormant &amp; deactivated (1)");
    expect(html).toMatch(/<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.indexOf("<details")).toBeLessThan(html.indexOf(">Ana<"));
    expect(html).toContain("Move back to active");
    expect(html).toContain("Marked dormant");
  });
  it.each(["role", "status", "location", "q"] as const)("shows matches flat for %s", (key) => {
    const html = users({ ...filters, [key]: key === "status" ? "inactive" : "value" });
    expect(html).not.toContain("<details");
    expect(html).toContain(">Ana<");
  });
});
it("Toast header counts seen only; dormant controls remain and history failures disclose", () => {
  const review: LinkReview = { locationId: "l", toastError: null, clockHistoryUnavailable: true, links: [], users: [],
    unlinked: [false, true].map((notSeen, i) => ({ guid: String(i), name: `Person${i}`, deleted: false,
      lastClockInAt: null, notSeen, suggestions: [] })) };
  const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en",
    children: createElement(ToastEmployeeLinks, { review }) }));
  expect(html).toContain("Not seen in 6+ months (1)");
  expect(html).toContain("showing everyone");
  expect(html.indexOf("<details")).toBeLessThan(html.indexOf(">Person1<"));
  expect(html.match(/<form/g)).toHaveLength(2);
  expect(html).not.toMatch(/<details[^>]* open/);
  // Read the translated header, rather than duplicating its English wording here.
  expect(html.match(/<h2[^>]*>(.*?)<\/h2>/)?.[1]).toMatch(/1/);
});
