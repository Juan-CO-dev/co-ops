import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("0299 retains the complete 0297 mutation body except the explicit body hash contract", () => {
 const source=readFileSync("supabase/migrations/0297_vendor_mail.sql","utf8");
 const original=source.slice(source.indexOf("create function public.vendor_mail_mutate"),source.indexOf("create function public.vendor_mail_act")).trim();
 const amended=readFileSync("supabase/migrations/0299_vendor_mail_b2.sql","utf8").split("\n").filter(line => !line.startsWith("--") && !line.includes("p_payload->>'body_sha256'")).join("\n").replace("create or replace function","create function").replace("'body','body_sha256','attachments'","'body','attachments'").trim();
 expect(amended).toBe(original);
});
it("0299 actual DDL validates immutable hash and preserves RPC/session/ACL behavior",()=>{
 const output=execFileSync(process.execPath,["scripts/sql-harness-0299.mjs"],{encoding:"utf8",timeout:240000});
 expect(output).toContain("body hash mismatch refused"); expect(output).toContain("PASS 0299:");
},250000);
