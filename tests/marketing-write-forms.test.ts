// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MarketingWriteForms } from "@/components/admin/marketing/MarketingWriteForms";
import { marketingWriteCopy } from "@/lib/marketing/write-copy";
const mocks = vi.hoisted(() => ({ prompt: vi.fn(), post: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/admin/StepUpProvider", () => ({ useStepUp: () => ({ requestStepUp: mocks.prompt }) }));
vi.mock("@/components/admin/useStepUpPost", () => ({ useStepUpPost: () => mocks.post }));
const id = "11111111-1111-4111-8111-111111111111";
const props = { lang: "en" as const, locations: [{ id, name: "Shop" }], milestones: [{ id, kind: "first_ad_spend", milestone_date: "2026-11-01", corrects_id: null }], entries: [], weeks: [{ from: "2026-11-01", to: "2026-11-07" }], canCorrectBaseline: true };
beforeEach(() => { vi.clearAllMocks(); mocks.prompt.mockResolvedValue("ok"); mocks.post.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
it("opens milestone correction on demand and prompts Tier B", async () => {
  render(createElement(MarketingWriteForms, props));
  expect(screen.queryByLabelText("Date")).toBeNull();
  fireEvent.click(screen.getByText("Milestone"));
  fireEvent.change(screen.getByLabelText("Correct record"), { target: { value: id } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-02" } });
  fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Changed launch" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(`/api/admin/marketing/milestones/${id}/correct`, { kind: "first_ad_spend", date: "2026-11-02", reason: "Changed launch" }));
  expect(mocks.prompt).toHaveBeenCalledWith("B");
});
it("records all-shop weekly Meta spend using Tier A and maps overlap refusal", async () => {
  mocks.post.mockResolvedValue({ ok: false, code: "entry_overlaps" });
  render(createElement(MarketingWriteForms, props));
  fireEvent.click(screen.getByText("Manual entry"));
  expect(screen.queryByLabelText("Shop")).toBeNull();
  fireEvent.change(screen.getByLabelText("Week"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("Amount ($)"), { target: { value: "4.50" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/admin/marketing/entries", expect.objectContaining({ kind: "meta_spend", amountCents: 450, locationId: null, platform: null, from: "2026-11-01", to: "2026-11-07" })));
  expect(mocks.prompt).toHaveBeenCalledWith("A");
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(marketingWriteCopy("en").entry_overlaps));
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("snapshot submits only correction identity/reason, with Tier B", async () => {
  render(createElement(MarketingWriteForms, { ...props, snapshotId: id }));
  fireEvent.click(screen.getByText("Lock baseline numbers"));
  fireEvent.change(screen.getByLabelText("Reason for correction"), { target: { value: "Reconcile capture" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/admin/marketing/baseline-snapshot", { correctsId: id, reason: "Reconcile capture" }));
  expect(mocks.prompt).toHaveBeenCalledWith("B");
});
it("cancelled password confirmation never writes", async () => {
  mocks.prompt.mockResolvedValue("cancelled");
  render(createElement(MarketingWriteForms, { ...props, lang: "es" }));
  fireEvent.click(screen.getByText(marketingWriteCopy("es").baseline));
  fireEvent.click(screen.getByText(marketingWriteCopy("es").save));
  await waitFor(() => expect(mocks.prompt).toHaveBeenCalledOnce());
  expect(mocks.post).not.toHaveBeenCalled();
});

it("offers exactly the scorecard weeks and hides the end-date input", () => {
  render(createElement(MarketingWriteForms, { ...props, weeks: [...props.weeks, { from: "2026-11-08", to: "2026-11-14" }] }));
  fireEvent.click(screen.getByText("Manual entry"));
  const picker = screen.getByLabelText("Week") as HTMLSelectElement;
  expect(Array.from(picker.options).map(option => option.value)).toEqual(["2026-11-01", "2026-11-08"]);
  expect(screen.queryByLabelText("Through")).toBeNull();
});
it("hides protected corrections from MoO and offers only unrecorded milestone kinds", () => {
  render(createElement(MarketingWriteForms, { ...props, snapshotId: id, canCorrectBaseline: false }));
  expect(screen.queryByText("Lock baseline numbers")).toBeNull();
  fireEvent.click(screen.getByText("Milestone"));
  expect(Array.from((screen.getByLabelText("Correct record") as HTMLSelectElement).options).map(option => option.value)).toEqual([""]);
  expect(Array.from((screen.getByLabelText("Kind") as HTMLSelectElement).options).map(option => option.value)).toEqual(["landing_live", "counter_on", "capi_on"]);
});
