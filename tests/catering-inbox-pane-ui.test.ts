// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { InboxPane } from "@/app/(authed)/catering/inbox/InboxPane";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { InboxDetail, InboxList } from "@/lib/catering/inbox";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
const initial: InboxList = { mode:"shadow",assignees:[],messages:[{id:"m",inbound_message_id:"i",location_id:null,sender_address:"sender@example.test",subject:"<script>alert(1)</script>",received_at:"2026-11-10T12:00:00Z",disposition:"needs_human",classification:"unclassified",identity_status:"ambiguous",reason:"urgent",assigned_to:null,revision:1,group:"needs_reply",transport_only:false,stale:true}] };
describe("inbox pane", () => {
  it.each(["en","es"] as const)("renders translated disclosure groups, warnings and escaped contacts in %s", language => {
    const dict=language==="en"?en:es;
    const html=renderToStaticMarkup(createElement(TranslationProvider,{initialLanguage:language} as Parameters<typeof TranslationProvider>[0],createElement(InboxPane,{initial})));
    expect(html).toContain(dict["catering.inbox.drafts_not_sent"]);
    for(const group of ["needs_reply","drafted","handled","notifications","noise"] as const) expect(html).toContain(dict[`catering.inbox.group.${group}`]);
    expect(html).toContain('aria-expanded="true"'); expect(html).toContain('aria-controls="inbox-needs_reply"');
    expect(html).toContain(dict["catering.inbox.stale"]); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("sender@example.test"); expect(html).toContain('min-h-11'); expect(html).toContain('items-center');
  });
  it("drawer is native modal with focus return, plain text and revision-fenced actions", () => {
    const source=readFileSync("app/(authed)/catering/inbox/InboxPane.tsx","utf8");
    expect(source).toContain("showModal()"); expect(source).toContain("previousFocus.current?.focus()"); expect(source).toContain("onCancel=");
    expect(source).toContain("expectedRevision: detail.revision");expect(source).toContain("pendingAction.current.requestId");expect(source).toContain('act("handle")');expect(source).toContain('act("reassign")');
    expect(source).not.toContain("dangerouslySetInnerHTML"); expect(source).not.toContain("localStorage");
  });
});

const full: InboxDetail = { ...initial.messages[0]!, body_text: "Plain message body", body_from_html: false, body_truncated: false, catering_customer_id: "customer", lead_id: "lead", quote_id: "quote", preview_text: "Proposed reply only", events: [{id:"event",event_type:"finalize",created_at:"2026-11-10T12:00:00Z"}], assignees:[{id:"manager",name:"Manager"}] };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { return render(createElement(TranslationProvider,{initialLanguage:"en"} as Parameters<typeof TranslationProvider>[0],createElement(InboxPane,{initial:{...initial,assignees:full.assignees}}))); }
function mockFetch() {
 const calls: {url:string;body:Record<string,unknown>}[]=[];
 const fetcher=vi.fn(async (url: string, options?: RequestInit) => {
   if(options?.method === "POST") calls.push({url,body:JSON.parse(String(options.body))});
   return {ok:true,json:async()=>url === "/api/catering/inbox" ? {inbox:initial}:{message:full}};
 });
 vi.stubGlobal("fetch",fetcher); return {fetcher,calls};
}
async function openDrawer() { fireEvent.click(screen.getByRole("button",{name:/Open message:/})); return screen.findByRole("dialog"); }
describe("inbox interactive drawer",()=>{
 it.each(["en", "es"] as const)("names stale revision, reloads the item and retries its current revision in %s", async language => {
  let revision = 1;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST" && revision === 1) { revision = 2; return { ok: false, json: async () => ({ code: "stale_revision" }) }; }
    return { ok: true, json: async () => _url === "/api/catering/inbox" ? { inbox: initial } : { message: { ...full, revision } } };
  });
  vi.stubGlobal("fetch", fetcher);
  const dict = language === "en" ? en : es;
  render(createElement(TranslationProvider, { initialLanguage: language } as Parameters<typeof TranslationProvider>[0], createElement(InboxPane, { initial })));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(dict["catering.inbox.action.open"]) }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: dict["catering.inbox.action.handle"] }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe(dict["catering.inbox.stale_revision"]));
  expect(fetcher.mock.calls.filter(([url, options]) => url.endsWith("/m") && !options?.method)).toHaveLength(2);
  fireEvent.click(within(dialog).getByRole("button", { name: dict["catering.inbox.action.handle"] }));
  await waitFor(() => expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2));
  const posts = fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(JSON.parse(String(posts[1]?.[1]?.body)).expectedRevision).toBe(2);
 });
 it.each(["en", "es"] as const)("names invalid assignees in %s", async language => {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => options?.method === "POST"
    ? { ok: false, json: async () => ({ code: "invalid_assignee" }) }
    : { ok: true, json: async () => ({ message: full }) }));
  const dict = language === "en" ? en : es;
  render(createElement(TranslationProvider, { initialLanguage: language } as Parameters<typeof TranslationProvider>[0], createElement(InboxPane, { initial })));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(dict["catering.inbox.action.open"]) }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: dict["catering.inbox.action.reassign"] }));
  await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe(dict["catering.inbox.invalid_assignee"]));
 });
 it("offers handle on a recorded child, but not reassignment", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ message: { ...full, disposition: "recorded", revision: 0 } }) })));
  mount(); const dialog = await openDrawer();
  expect(within(dialog).getByRole("button", { name: "Mark handled" })).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Reassign" })).toBeNull();
 });
 it("renders noise as a count only and never points controls at missing content", () => {
  render(createElement(TranslationProvider, { initialLanguage: "en" } as Parameters<typeof TranslationProvider>[0], createElement(InboxPane, { initial: { ...initial, messages: [...initial.messages, { ...initial.messages[0]!, id: "noise", subject: "Noise secret", group: "noise" }] } })));
  expect(screen.getByText("Noise").closest("section")?.textContent).toContain("1 message");
  expect(screen.queryByText("Noise secret")).toBeNull();
  expect(screen.queryByRole("button", { name: /Noise/ })).toBeNull();
  for (const button of screen.getAllByRole("button")) {
    const target = button.getAttribute("aria-controls");
    if (target) expect(document.getElementById(target)).not.toBeNull();
  }
  const group = screen.getByRole("button", { name: /Needs your reply/ });
  fireEvent.click(group); expect(group.hasAttribute("aria-controls")).toBe(false);
 });
 it("opens plain-text message, proposed preview, links, history and closes accessibly",async()=>{
  mockFetch();mount();const dialog=await openDrawer();
  expect(within(dialog).getByText("Plain message body")).toBeTruthy();expect(within(dialog).getByText("Proposed reply only")).toBeTruthy();
  expect(within(dialog).getByText(/Message classified/)).toBeTruthy();
  expect(within(dialog).getByRole("link",{name:"Quote"}).getAttribute("href")).toBe("/catering/quotes/quote");
  fireEvent.click(within(dialog).getByRole("button",{name:"Close message"}));await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
 });
 it("posts expected revision and a request ID for handle and reassign, never a send",async()=>{
  const {calls}=mockFetch();mount();const dialog=await openDrawer();
  fireEvent.change(within(dialog).getByRole("combobox",{name:"Choose assignee"}),{target:{value:"manager"}});
  fireEvent.click(within(dialog).getByRole("button",{name:"Reassign"}));
  await waitFor(()=>expect(calls).toHaveLength(1));
  expect(calls[0]?.body).toEqual({expectedRevision:1,requestId:expect.any(String),assignedTo:"manager"});
  await waitFor(()=>expect((within(dialog).getByRole("button",{name:"Mark handled"}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByRole("button",{name:"Mark handled"}));await waitFor(()=>expect(calls).toHaveLength(2));
  expect(calls[1]?.url).toMatch(/\/handle$/);expect(calls[1]?.body.expectedRevision).toBe(1);expect(calls[1]?.body).not.toHaveProperty("assignedTo");
 });
 it("retains request ID after uncertain failure and lets the operator retry",async()=>{
  const {fetcher,calls}=mockFetch();let failed=false;
  fetcher.mockImplementation(async(url,options)=>{
    if(options?.method==="POST"){ calls.push({url,body:JSON.parse(String(options.body))});if(!failed){failed=true;throw new Error("network");} }
    return {ok:true,json:async()=>url==="/api/catering/inbox"?{inbox:initial}:{message:full}};
  });
  mount();const dialog=await openDrawer();fireEvent.click(within(dialog).getByRole("button",{name:"Mark handled"}));
  await waitFor(()=>expect(within(dialog).getByRole("alert")).toBeTruthy());
  fireEvent.click(within(dialog).getByRole("button",{name:"Mark handled"}));await waitFor(()=>expect(calls).toHaveLength(2));
  expect(calls[1]?.body.requestId).toBe(calls[0]?.body.requestId);
 });
 it("filters assignees and toggles groups with session-only disclosure state",()=>{
  mockFetch();mount();fireEvent.change(screen.getByRole("combobox",{name:"Filter by assignee"}),{target:{value:"manager"}});
  expect(screen.queryByRole("button",{name:/Open message:/})).toBeNull();
  fireEvent.change(screen.getByRole("combobox",{name:"Filter by assignee"}),{target:{value:"unassigned"}});
  expect(screen.getByRole("button",{name:/Open message:/})).toBeTruthy();
  const group=screen.getByRole("button",{name:/Needs your reply/});fireEvent.click(group);expect(group.getAttribute("aria-expanded")).toBe("false");
 });
});
