import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: mocks.session }));
vi.mock("@/lib/catering/inbox", async original => ({ ...await original<typeof import("@/lib/catering/inbox")>(), listCateringInbox: mocks.list }));
import Page from "@/app/(authed)/catering/inbox/page";
import { CateringInboxError } from "@/lib/catering/inbox";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

it.each(["en", "es"] as const)("renders a harmless not-installed destination in %s", async language => {
  mocks.session.mockResolvedValue({ user: { language } });
  mocks.list.mockRejectedValue(new CateringInboxError(503, "inbox_unavailable"));
  const page = renderToStaticMarkup(await Page());
  expect(page).toContain((language === "en" ? en : es)["catering.inbox.unavailable"]);
  expect(page).toContain('href="/catering"');
  expect(page).toContain('role="status"');
});
