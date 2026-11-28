/**
 * Digests round 3, PR 4: the switch-off GOLDEN cases. Built ONLY from fixtures that existed before PR 4's composer
 * edits (tests/fixtures/digest-staffing.ts), so the goldens in this folder were rendered by the composers of the
 * commit named in `goldens.json` (`headSha`) and the test re-renders the SAME inputs with today's composers.
 * Synthetic data only.
 */
import { businessAccessFor } from "@/lib/business-access-shared";
import { digestAccessFor, type DigestAccess } from "@/lib/report-digests-access-shared";
import type { Envelope, ShopDayFacts } from "@/lib/report-digests-compose";
import type { LinkViewer } from "@/lib/report-digests-links";
import { ok } from "@/lib/report-digests-v2-shared";
import type { Language } from "@/lib/i18n/types";
import { A, B, BASE, D, D1, fullDay, labor, schedule, SHOP_A, SHOP_B, shopFacts, tomorrowDay } from "../digest-staffing";

export interface GoldenMail { subject: string; preheader: string; html: string; text: string }
export interface GoldenCase { name: string; digest: "shop" | "unified"; language: Language; who: "permitted" | "refused" }

const GM_A: LinkViewer = { role: "gm", level: 7, locations: [A] };
const OWNER: LinkViewer = { role: "owner", level: 9, locations: [A, B] };
const SMM: LinkViewer = { role: "social_media_mgr", level: 6, locations: [A, B] };

/** The facts: Toast labor ok, a published schedule, v2 everything else. */
export const goldenShop = (shop: { id: string; name: string }): ShopDayFacts =>
  shopFacts(shop, { labor: ok(labor()) }, schedule(fullDay(D), tomorrowDay(D1, 1)));
export const goldenUnified = () => ({ day: D, shops: [goldenShop(SHOP_A), goldenShop(SHOP_B)], notFinalized: [] as Array<{ id: string; name: string }> });

/** The envelope of a case (no `laborMoney` key: the switch-off envelope). A permitted viewer carries a full business access. */
export function goldenEnvelope(c: GoldenCase): Envelope {
  const kind = c.digest === "shop" ? "gm_shop" as const : "unified" as const;
  const shops = c.digest === "shop" ? [A] : [A, B];
  const viewer = c.who === "refused" ? SMM : c.digest === "shop" ? GM_A : OWNER;
  const business = c.who === "refused" ? null : businessAccessFor(viewer.role as "gm" | "owner", null);
  const access: DigestAccess | null = digestAccessFor(viewer, { kind, shops }, business);
  return { language: c.language, baseUrl: BASE, viewer, access };
}

export const GOLDEN_CASES: GoldenCase[] = (["shop", "unified"] as const).flatMap((digest) =>
  (["en", "es"] as const).flatMap((language) => (["permitted", "refused"] as const).map((who) => ({ name: `${digest}-${language}-${who}`, digest, language, who }))));

/** The preheader as the layout writes it (the hidden first div of the HTML). */
export function preheaderOf(html: string): string {
  const m = /<div[^>]*display:\s*none[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  return m ? m[1]! : "";
}
