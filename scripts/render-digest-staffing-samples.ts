/**
 * Rendered samples of the digest staffing lines (digests round 3, PR 2) — for a human reviewer, never for a send.
 *
 * A literal 7shifts answer → the REAL schedule reader (fake `fetch`, in-memory mirror) → the facts → the REAL
 * composers → `.html` + `.txt` files. Fixture data only: shops "Shop A" / "Shop B", people "Person Q" / "Person R",
 * made-up ids and a fake token. No network, no database, no email.
 *
 * Writes, in en and es: the shop digest (GM of Shop A), the unified digest (owner), the catering digest (a catering
 * manager with a membership at Shop A), a "not available" shop digest (GM, a refused answer) and a refused-recipient
 * shop digest (a social media manager, the valid answer).
 *
 * Run (the reader and the composers are server modules, hence the react-server condition):
 *   npx tsx --conditions=react-server scripts/render-digest-staffing-samples.ts [outDir]
 * Default outDir: C:/Users/conta/co-ops-wt/samples-digest3-2 (outside the repo).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Language } from "@/lib/i18n/types";
import { digestAccessFor, type DigestDelivery } from "@/lib/report-digests-access-shared";
import { renderCateringDigest, renderShopDigest, renderUnifiedDigest, type ComposedEmail, type ShopDayFacts } from "@/lib/report-digests-compose";
import type { LinkViewer } from "@/lib/report-digests-links";
import { createScheduleReader, type ServiceRoleClient } from "@/lib/report-digests-schedule";
import type { ShopSchedule } from "@/lib/report-digests-schedule-shared";
import { ok, type Loaded } from "@/lib/report-digests-v2-shared";
import type { SevenShiftsFetch } from "@/lib/sevenshifts/client";
import { A, B, BASE, cateringFacts, labor, lead, SHOP_A, SHOP_B, shopFacts } from "../tests/fixtures/digest-staffing";
import { COMPANY, SHOP_A_7S, SHOP_B_7S, VALID_WHOAMI, shiftRow, validAnswerBody } from "../tests/fixtures/digest/staffing-cases";

const D = "2026-03-01";
const D1 = "2026-03-02";
const DEFAULT_OUT = "C:/Users/conta/co-ops-wt/samples-digest3-2";

type Row = Record<string, unknown>;
const MIRROR = {
  links: [{ location_id: A, sevenshifts_location_id: SHOP_A_7S, active: true }, { location_id: B, sevenshifts_location_id: SHOP_B_7S, active: true }] as Row[],
  locations: [{ id: SHOP_A_7S, company_id: COMPANY }, { id: SHOP_B_7S, company_id: COMPANY }] as Row[],
  users: [{ id: "11", first_name: "Person Q", preferred_first_name: null }, { id: "12", first_name: "Person R", preferred_first_name: null }] as Row[],
  roles: [{ id: "21", name: "Cook" }] as Row[],
};

function mirror(): ServiceRoleClient {
  return {
    from(table: string) {
      const q = { select: "", eq: {} as Record<string, unknown>, in: [] as unknown[] };
      const b: Record<string, unknown> = {
        select: (c: string) => { q.select = c; return b; },
        eq: (c: string, v: unknown) => { q.eq[c] = v; return b; },
        in: (_c: string, v: unknown[]) => { q.in = v; return b; },
        order: () => b,
        abortSignal: () => b,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          let rows: Row[] = [];
          if (table === "sevenshifts_location_links") rows = MIRROR.links.filter((r) => r.location_id === q.eq.location_id && r.active === q.eq.active);
          else if (table === "sevenshifts_locations") rows = MIRROR.locations.filter((r) => String(r.id) === String(q.eq.id));
          else {
            const want = new Set(q.in.map(String));
            const cols = q.select.split(",").map((c) => c.trim());
            rows = (table === "sevenshifts_users" ? MIRROR.users : MIRROR.roles).filter((r) => want.has(String(r.id))).map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return b;
    },
  } as unknown as ServiceRoleClient;
}

/** Person Q at Shop A on D and D+1 (Cook), Person R at Shop B on D+1, one open shift at Shop A on D+1. */
const VALID = validAnswerBody({ rows: [shiftRow("A"), shiftRow("A", { id: "1002", start: `"2026-03-02T14:00:00Z"`, end: `"2026-03-02T22:00:00Z"` }), shiftRow("B"), shiftRow("OPEN")] });
/** The same page with Shop A's shift on draft: refused for the company and window. */
const REFUSED = validAnswerBody({ rows: [shiftRow("A", { draft: "true" }), shiftRow("B"), shiftRow("OPEN")] });

async function read(body: string): Promise<Record<string, Loaded<ShopSchedule>>> {
  const enc = new TextEncoder();
  const fetch: SevenShiftsFetch = async (url) => {
    const u = new URL(url);
    const text = u.pathname === "/v2/whoami" ? VALID_WHOAMI.body : body;
    return new Response(enc.encode(text), { status: 200, headers: { "content-type": "application/json" } });
  };
  const reader = createScheduleReader(mirror(), { env: { SEVENSHIFTS_ACCESS_TOKEN: "tok_FAKE_do_not_leak", SEVENSHIFTS_SYNC: "1" }, fetch });
  return { [A]: await reader.shopWindow(A, D, D1), [B]: await reader.shopWindow(B, D, D1) };
}

const shopDay = (shop: { id: string; name: string }, sched: Loaded<ShopSchedule> | undefined): ShopDayFacts =>
  ({ ...shopFacts(shop, { labor: ok(labor()), lookahead: D1 }, sched), day: D });
const env = (language: Language, viewer: LinkViewer, kind: DigestDelivery["kind"], shops: string[]) =>
  ({ language, baseUrl: BASE, viewer, access: digestAccessFor(viewer, { kind, shops }) });

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const OWNER: LinkViewer = { role: "owner", level: 9, locations: [] };
const CATERING_MGR: LinkViewer = { role: "catering_mgr", level: 6, locations: [A] };
const SMM: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A] };

export async function main(outDir = DEFAULT_OUT): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const valid = await read(VALID);
  const refused = await read(REFUSED);
  const written: string[] = [];
  const write = (name: string, language: Language, mail: ComposedEmail) => {
    for (const [ext, body] of [["html", mail.html], ["txt", `Subject: ${mail.subject}\n\n${mail.text}`]] as const) {
      const file = path.join(outDir, `${name}.${language}.${ext}`);
      writeFileSync(file, body, "utf8");
      written.push(file);
    }
  };
  for (const language of ["en", "es"] as const) {
    write("shop-digest-gm", language, renderShopDigest(shopDay(SHOP_A, valid[A]), env(language, GM_A, "gm_shop", [A])));
    write("unified-digest-owner", language, renderUnifiedDigest({ day: D, shops: [shopDay(SHOP_A, valid[A]), shopDay(SHOP_B, valid[B])], notFinalized: [] }, env(language, OWNER, "unified", [A, B])));
    const leads = [lead("a1", A, D), lead("a2", A, D1), lead("b1", B, D), lead("b2", B, D1)];
    write("catering-digest-catering-mgr", language, renderCateringDigest(cateringFacts(leads, valid, { today: D }), { locations: [SHOP_A, SHOP_B], includeUnassigned: false, showAddresses: true }, env(language, CATERING_MGR, "catering", [A, B])));
    write("shop-digest-gm-not-available", language, renderShopDigest(shopDay(SHOP_A, refused[A]), env(language, GM_A, "gm_shop", [A])));
    write("shop-digest-smm-refused-recipient", language, renderShopDigest(shopDay(SHOP_A, valid[A]), env(language, SMM, "gm_shop", [A])));
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).then((files) => { for (const f of files) console.log(f); }, (e) => { console.error(e); process.exit(1); });
}
