/**
 * Rendered samples of the digest LABOR MONEY lines (digests round 3, PR 4) — for a human reviewer, never for a send.
 *
 * The REAL engine runs the REAL pre-load pieces (lib/business-labor-core.ts, the settings read) over a fake labor
 * database, and the REAL composers write the emails (tests/fixtures/digest-labor-e2e.ts, the harness of
 * tests/report-digests-labor-e2e.test.ts). Fixture data only: shops "Shop A" / "Shop B", people "Person A" …, made-up
 * ids, example.com addresses. No network, no database, no email.
 *
 * Writes, in en and es, `.html` + `.txt` (the `.txt` starts with the subject and the preheader):
 *   shop-digest-owner               (i)   the owner, flagged for Shop A's shop digest: F1–F5
 *   shop-digest-gm-defaults         (ii)  a GM with the default settings (no row saved): F1–F3 + cost by role, no fully loaded
 *   shop-digest-gm-loaded-roles     (iii) a GM with fully loaded and cost by role on (every switch on)
 *   shop-digest-gm-week-updating    (iv)  a GM on a night when the current week is updating (the digest's own Toast pull
 *                                         moved an out_at of this week): F1 = last Saturday, F2 "updating"
 *   shop-digest-agm                 (v)   a flagged AGM: no labor-money line
 *   unified-digest-owner                  the owner's unified digest (each shop's Labor section)
 *
 * Run (the pieces and the composers are server modules, hence the react-server condition):
 *   npx tsx --conditions=react-server scripts/render-digest-labor-samples.ts [outDir]
 * Default outDir: tmp/digest-labor-samples, relative to the working directory (`tmp/` is git-ignored; Opus R-7: no
 * absolute user path in the repo).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Language } from "@/lib/i18n/types";
import { GM_ALL_ON } from "../tests/helpers/business-report-fake";
import { A, B, D, SALARY, e2e, type E2EOpts, type Mail, type Who } from "../tests/fixtures/digest-labor-e2e";

const DEFAULT_OUT = path.join("tmp", "digest-labor-samples");

/** The closing run of D with both shops finalized; every recipient in `language`. */
async function night(language: Language, opts: Partial<E2EOpts> & { gmSettings?: Record<string, boolean> | null } = {}): Promise<Mail[]> {
  const { gmSettings, ...o } = opts;
  const who: Who[] = ["gm-a", "moo", "own", "agm"];
  const h = e2e({
    run: { kind: "closing" }, finalized: { [D]: [A, B] }, switchOn: true,
    dir: { who, es: language === "es" ? who : [], ownerShopDigest: true },
    db: { laborCostRow: () => SALARY, visibility: [gmSettings ?? null] },
    ...o,
  });
  await h.run();
  return h.mails;
}

const pick = (mails: Mail[], kind: string, id: string, location: string | null) => {
  const m = mails.find((x) => x.kind === kind && x.ref === `user:${id}` && x.location === location);
  if (!m) throw new Error(`no ${kind} mail for ${id}`);
  return m;
};

export async function main(outDir = DEFAULT_OUT): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  const write = (name: string, language: Language, mail: Mail) => {
    for (const [ext, body] of [["html", mail.html], ["txt", `Subject: ${mail.subject}\nPreheader: ${mail.preheader}\n\n${mail.text}`]] as const) {
      const file = path.join(outDir, `${name}.${language}.${ext}`);
      writeFileSync(file, body, "utf8");
      written.push(file);
    }
  };
  for (const language of ["en", "es"] as const) {
    const defaults = await night(language);
    write("shop-digest-owner", language, pick(defaults, "gm_shop", "own", A));
    write("shop-digest-gm-defaults", language, pick(defaults, "gm_shop", "gm-a", A));
    write("shop-digest-agm", language, pick(defaults, "gm_shop", "agm", A));
    write("unified-digest-owner", language, pick(defaults, "unified", "own", null));
    const allOn = await night(language, { gmSettings: GM_ALL_ON });
    write("shop-digest-gm-loaded-roles", language, pick(allOn, "gm_shop", "gm-a", A));
    // The common case Tuesday to Saturday at closing time: the digest's own pull moves this week's source.
    const updating = await night(language, { before: (h) => h.shop.mode(A, D, { pullChanges: true }) });
    write("shop-digest-gm-week-updating", language, pick(updating, "gm_shop", "gm-a", A));
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).then((files) => { for (const f of files) console.log(f); }, (e) => { console.error(e); process.exit(1); });
}
