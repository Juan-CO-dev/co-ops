// Business report access: every string of the "what GMs can see" card and of the report's access states has en and
// es (operational tu-form) with the same {params}; the card's key list is the whole business.visibility namespace
// (a new string cannot ship untranslated); every refusal has its own message; the card keeps the 44px + items-center
// floor; the page shows it only to the owner / CGS / MoO and only with the switch on.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { BUSINESS_VISIBILITY_ERROR_CODES, BUSINESS_VISIBILITY_I18N_KEYS, GM_VISIBILITY_DEFAULTS, GM_VISIBILITY_KEYS } from "@/lib/business-access-shared";
import { BUSINESS_REPORT_I18N_KEYS } from "@/lib/business-report-shared";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

const EN = en as Record<string, string>, ES = es as Record<string, string>;
const params = (s: string) => [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]!).sort();
const ACCESS_REPORT_KEYS = ["reports.business.access.not_shared", "reports.business.access.settings_link", "reports.business.export.off.not_shared",
  "reports.business.error.gm_report_off", "reports.business.error.business_access_not_installed", "reports.business.error.business_access_unavailable",
  "reports.business.error.business_tab_off", "reports.business.error.business_export_off", "reports.business.error.business_access_changed"];

describe("strings", () => {
  it("every key has a non-empty en and es string with the same params, never usted", () => {
    for (const k of [...BUSINESS_VISIBILITY_I18N_KEYS, ...ACCESS_REPORT_KEYS]) {
      expect(EN[k], k).toBeTruthy();
      expect(ES[k], k).toBeTruthy();
      expect(params(ES[k]!), k).toEqual(params(EN[k]!));
      expect(ES[k], k).not.toMatch(/\busted(es)?\b/i);
      if (k !== "business.visibility.aria.switch") expect(ES[k], k).not.toBe(EN[k]); // that one is only its two params
    }
  });
  it("the list is the whole business.visibility namespace; every switch has a label and a hint; every refusal its own key", () => {
    expect(Object.keys(EN).filter((k) => k.startsWith("business.visibility.")).sort()).toEqual([...BUSINESS_VISIBILITY_I18N_KEYS].sort());
    expect(Object.keys(ES).filter((k) => k.startsWith("business.visibility.")).sort()).toEqual([...BUSINESS_VISIBILITY_I18N_KEYS].sort());
    for (const k of GM_VISIBILITY_KEYS) for (const part of ["switch", "hint"]) expect(BUSINESS_VISIBILITY_I18N_KEYS as readonly string[]).toContain(`business.visibility.${part}.${k}`);
    for (const c of BUSINESS_VISIBILITY_ERROR_CODES) expect(BUSINESS_VISIBILITY_I18N_KEYS as readonly string[]).toContain(`business.visibility.error.${c}`);
  });
  it("the report's access strings are in the report's own pinned list, and every access refusal the loader raises has a line", () => {
    for (const k of ACCESS_REPORT_KEYS) expect(BUSINESS_REPORT_I18N_KEYS as readonly string[], k).toContain(k);
    const loader = readFileSync("lib/business-report.ts", "utf8");
    const codes = [...new Set([...loader.matchAll(/new BusinessReportError\(\d+, "([a-z_]+)"\)/g)].map((m) => m[1]!))];
    expect(codes).toEqual(expect.arrayContaining(["gm_report_off", "business_access_not_installed", "business_access_unavailable", "business_tab_off", "business_export_off", "business_access_changed"]));
    const parts = readFileSync("components/reports-business/BusinessParts.tsx", "utf8");
    for (const c of codes.filter((x) => x !== "invalid_location")) {
      expect(EN[`reports.business.error.${c}`], c).toBeTruthy();
      expect(ES[`reports.business.error.${c}`], c).toBeTruthy();
      expect(parts, `BusinessUnavailable knows ${c}`).toContain(`"${c}"`);
    }
  });
  it("the card says what a switch does (GMs do not see it), never that GMs cannot work something out; and it says whose salaries a shop's total can hold", () => {
    expect(EN["business.visibility.promise"]).toMatch(/GMs do not see it/);
    expect(ES["business.visibility.promise"]).toMatch(/no la ven/);
    for (const k of BUSINESS_VISIBILITY_I18N_KEYS) expect(EN[k], k).not.toMatch(/cannot (work out|compute|derive|estimate|figure out)/i);
    expect(EN["business.visibility.salary_note"]).toBe("A shop's salary total covers every salary on that shop's payroll. That can include an owner's or a director's.");
    expect(ES["business.visibility.salary_note"]).toMatch(/todos los salarios de la nómina de esa tienda/);
    // Juan 2026-11-19: the two per-person / per-15-minute lines are switches now; nothing says they are fixed, on the card or on the report.
    for (const dict of [EN, ES]) {
      for (const k of ["business.visibility.pay_note", "business.visibility.fixed.title", "business.visibility.fixed.person_cost", "business.visibility.fixed.quarter_cost"]) expect(dict[k], k).toBeUndefined();
      for (const k of ["reports.business.people.cost_note", "reports.business.hours.gm_note"]) expect(dict[k], k).not.toMatch(/MoO/);
    }
    expect(EN["business.visibility.hint.person_cost"]).toMatch(/Never a salary/);
    expect(EN["business.visibility.hint.person_salary"]).toMatch(/does not list this yet/);
  });
});

describe("the card", () => {
  const src = readFileSync("components/admin/sevenshifts/BusinessVisibilityCard.tsx", "utf8");
  it("44px controls with items-center, every key it names exists, no date or number formatted by locale, no bare string", () => {
    for (const m of src.matchAll(/min-h-\[44px\][^"`]*/g)) expect(m[0], m[0]).toContain("items-center");
    expect(src).not.toMatch(/toLocale|\.slice\(0, 10\)|toFixed/);
    for (const m of src.matchAll(/"(business\.visibility\.[a-z_.]+)"/g)) expect(BUSINESS_VISIBILITY_I18N_KEYS as readonly string[], m[1]).toContain(m[1]!);
    for (const m of src.matchAll(/`business\.visibility\.([a-z_]+)\.\$\{/g)) expect(BUSINESS_VISIBILITY_I18N_KEYS.some((k) => k.startsWith(`business.visibility.${m[1]}.`)), m[1]).toBe(true);
    // Text between tags is always a {t(...)} expression: no English literal in the markup.
    const markup = src.slice(src.indexOf("export function BusinessVisibilityCard")).replace(/\/\/.*$/gm, "");
    expect([...markup.matchAll(/>\s*([A-Za-z][A-Za-z ,.'-]{3,})\s*</g)].map((m) => m[1])).toEqual([]);
  });
  it("one save of the whole set, behind Tier B every time, bound to the head the card showed", () => {
    expect(src.match(/fetch\("\/api\/admin\/reports\/business-visibility"/g)).toHaveLength(1);
    expect(src).toContain("const against = data.headId;\n      const payload = { settings: draft, expectedId: against };");
    expect(src.indexOf("await requestStepUp(\"B\") !== \"ok\"")).toBeGreaterThan(-1);
    expect(src.indexOf("await requestStepUp(\"B\") !== \"ok\"")).toBeLessThan(src.indexOf("const post = "));
  });
  it("a switch that needs another is disabled while that one is off, and turning a parent off turns its children off in the draft", () => {
    expect(src).toContain("disabled={parent !== undefined || busy || waiting}");
    expect(src).toContain("if (!next[k]) for (const child of dependents(k)) next[child] = false;");
  });
  it("disclosure: collapsed by default, the count on the header, and it cannot close over an unsaved draft", () => {
    expect(src).toContain("const [open, setOpen] = useState(false);");
    expect(src).toContain("open={open || dirty} onToggle={() => { if (!dirty) setOpen((o) => !o); else setOpen(true); }}");
    expect(src).toContain("count={t(\"business.visibility.count\", { on, total: GM_VISIBILITY_KEYS.length })}");
  });
  it("cost per person, labor dollars per 15 minutes and a salary per person are toggles like the rest: no fixed line, every switch in a group", () => {
    for (const k of ["person_cost", "quarter_cost", "person_salary"]) expect(GM_VISIBILITY_KEYS as readonly string[]).toContain(k);
    expect(src).not.toContain("business.visibility.fixed.");
    expect(src).toContain("business.visibility.salary_note");
    expect(Object.keys(GM_VISIBILITY_DEFAULTS)).toHaveLength(12);
    const grouped = [...src.matchAll(/keys: \[([^\]]*)\]/g)].flatMap((m) => m[1]!.split(",").map((x) => x.trim().replace(/"/g, "")).filter(Boolean));
    expect([...grouped].sort()).toEqual([...GM_VISIBILITY_KEYS].sort());
  });
});

describe("where it shows", () => {
  it("the page shows the card only to the visibility roles AND with the switch on, and reads nothing for it otherwise", () => {
    const src = readFileSync("app/admin/sevenshifts/page.tsx", "utf8");
    expect(src).toContain("const visibility = canManageBusinessVisibility(auth.role) && businessReportEnabled(process.env)\n    ? await loadBusinessVisibilityCard(");
    expect(src.match(/loadBusinessVisibilityCard\(/g)).toHaveLength(1);
    expect(src).toContain("{visibility && <BusinessVisibilityCard data={visibility.state === \"ready\" ? visibility : null} />}");
    // The card is never remounted by a new head (a React key would silently drop an edit made while the refresh is in flight).
    expect(src).not.toMatch(/<BusinessVisibilityCard[^>]*\bkey=/);
  });
  it("the server lib refuses anyone else before any read, and reports a missing 0349 as unavailable (never a 500)", async () => {
    const { loadBusinessVisibilityCard, saveBusinessVisibility } = await import("@/lib/business-visibility");
    const reads: string[] = [];
    const sb = (answer: { data: unknown; error: unknown }) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "order", "limit", "eq"]) q[k] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res);
      return { from: (t: string) => { reads.push(t); return q; }, rpc: () => { reads.push("rpc"); return Promise.resolve(answer); } } as never;
    };
    for (const role of ["gm", "agm", "social_media_mgr"] as const) {
      await expect(loadBusinessVisibilityCard(sb({ data: [], error: null }), { userId: "u", role })).rejects.toMatchObject({ status: 403, code: "forbidden" });
      await expect(saveBusinessVisibility(sb({ data: "x", error: null }), { userId: "u", role }, { settings: GM_VISIBILITY_DEFAULTS, expectedId: null })).rejects.toMatchObject({ status: 403 });
    }
    expect(reads).toEqual([]);
    expect(await loadBusinessVisibilityCard(sb({ data: null, error: { code: "42P01", message: "x" } }), { userId: "u", role: "moo" })).toEqual({ state: "unavailable" });
    expect(await loadBusinessVisibilityCard(sb({ data: [], error: null }), { userId: "u", role: "owner" }))
      .toEqual({ state: "ready", settings: GM_VISIBILITY_DEFAULTS, headId: null, savedBy: null, savedAt: null });
    // A stored row that is not the exact twelve is never shown as if it were settings.
    expect(await loadBusinessVisibilityCard(sb({ data: [{ id: "h", settings: { report: true }, created_by: null, created_at: "2026-11-19T00:00:00Z" }], error: null }), { userId: "u", role: "cgs" }))
      .toEqual({ state: "unavailable" });
  });
});
