/** Print the reading grade of every English section of a guide (Guides v2: each must be 6 or lower).
 * Usage: npx tsx scripts/guide-test/grade.ts docs/guides/staff-guide.md
 * Same scorer as tests/guides-reading-level.test.ts (sections under 30 words are not judged).
 */
import { readFileSync } from "node:fs";
import { englishSections, fkGrade, plainSentences } from "../../lib/guides/readability-shared";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx scripts/guide-test/grade.ts <guide.md>");
  process.exit(2);
}
let over = 0;
for (const { heading, body } of englishSections(readFileSync(file, "utf8"))) {
  const sentences = plainSentences(body);
  const r = fkGrade(sentences);
  const judged = r.words >= 30;
  const bad = judged && r.grade > 6;
  if (bad) over += 1;
  console.log(`${bad ? "OVER" : judged ? "ok  " : "--  "} ${r.grade.toFixed(1).padStart(5)}  ${String(r.words).padStart(4)}w  ${heading}`);
  if (bad) {
    const longest = [...sentences].sort((a, b) => b.split(" ").length - a.split(" ").length).slice(0, 3);
    for (const s of longest) console.log(`        long: ${s}`);
  }
}
console.log(over === 0 ? "ALL SECTIONS AT GRADE 6 OR LOWER" : `${over} section(s) above grade 6`);
process.exitCode = over === 0 ? 0 : 1;
