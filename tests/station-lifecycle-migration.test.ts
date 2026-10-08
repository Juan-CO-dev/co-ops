import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const old = readFileSync(new URL("../supabase/migrations/0228_assignment_attribution.sql", import.meta.url), "utf8");
const next = readFileSync(new URL("../supabase/migrations/0230_station_lifecycle.sql", import.meta.url), "utf8");
function body(sql: string, name: string) {
  const declaration = sql.search(new RegExp(`create(?: or replace)? function public\\.${name}\\(`));
  const start = sql.indexOf(`function public.${name}(`, declaration);
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}

describe("0230 preserves the 0228 human-write contract", () => {
  it.each(["write_station_event", "write_task_assignment"])("keeps %s args/defaults and every existing body line in order", (name) => {
    const source = body(old, name).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const actual = body(next, name).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let offset = 0;
    for (const line of source) {
      const index = actual.indexOf(line, offset);
      expect(index, `missing/reordered ${name}: ${line}`).toBeGreaterThanOrEqual(offset);
      offset = index + 1;
    }
  });
  it("does not reserve 0229 or seed tenant closing/trim times", () => {
    expect(next).not.toMatch(/insert into public\.(stations|station_positions)\s*\(/i);
    expect(next).toContain("AUTHORED ONLY");
    expect(next).toContain("NOT APPLIED");
  });
});
