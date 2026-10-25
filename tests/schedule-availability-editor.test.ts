// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import { StaffSettings } from "@/components/schedule/StaffSettings";

const { post } = vi.hoisted(() => ({ post: vi.fn(async () => ({ ok: true })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => post }));
vi.mock("@/components/schedule/use-board-line", () => ({ useBoardLine: () => ({
  t: (key: string) => (en as Record<string, string>)[key] ?? key,
  position: (id: string) => id,
}) }));
afterEach(() => { cleanup(); post.mockClear(); });
function editor() {
  return render(createElement(StaffSettings, { locationId: "shop", shopDay: { prepStartQ: 28, outLatestQ: 84 }, members: [{ userId: "worker", name: "Worker",
    role: "employee", settings: null, includeOffered: false }], positions: {}, livePositionIds: [], names: {}, initialPerson: "worker" }));
}
it("seeds Works, defaults specific times to 7 AM through close, and preserves 4 PM through close", () => {
  const { container } = editor();
  fireEvent.click(screen.getByRole("button", { name: "Set days they work" }));
  expect(screen.getAllByRole<HTMLInputElement>("radio", { name: "Works" }).every((r) => r.checked)).toBe(true);
  const monday = within(container.querySelector('[data-availability-day="1"]') as HTMLElement);
  fireEvent.click(monday.getByRole("checkbox", { name: "Set specific times" }));
  const from = monday.getByLabelText<HTMLInputElement>("From");
  expect(from.value).toBe("07:00");
  expect(monday.getByRole<HTMLInputElement>("checkbox", { name: "Until close" }).checked).toBe(true);
  fireEvent.change(from, { target: { value: "16:00" } });
  expect(from.value).toBe("16:00");
  expect(monday.getByRole<HTMLInputElement>("checkbox", { name: "Until close" }).checked).toBe(true);
});
it("refuses an all-Off dirty draft before posting and enables save after a Works day", () => {
  editor();
  fireEvent.click(screen.getByRole("button", { name: "Set days they work" }));
  for (const off of screen.getAllByRole("radio", { name: "Off" })) fireEvent.click(off);
  const save = screen.getByRole<HTMLButtonElement>("button", { name: en["schedule.settings.save"] });
  expect(save.disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe(en["schedule.settings.staff.availability_all_off"]);
  fireEvent.click(save);
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("radio", { name: "Works" })[0]!);
  expect(save.disabled).toBe(false);
});
