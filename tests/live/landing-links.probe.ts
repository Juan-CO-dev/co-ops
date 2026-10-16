/** Deliberately outside the pure Vitest glob. A 200 SPA shell is NOT branch proof.
 * Run manually with tsx; actual Appfront payload endpoint/schema and reviewed
 * digests still require merchant inspection before launch (A2/E5 gate).
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadLandingConfig } from "../../lib/landing/config";
import { getLandingLinks } from "../../lib/landing/links";

export interface ProbeEvidence {status:number;finalUrl:string;redirected:boolean;challenged:boolean;branchIds:readonly string[];digest:string}
export function assessProbe(evidence:ProbeEvidence,baseline:{host:string;branchId?:string;digest:string}):string[] {
  const failures:string[] = [];
  if (evidence.status !== 200) failures.push("http-status");
  if (evidence.challenged) failures.push("challenge");
  if (evidence.redirected) failures.push("redirect-review");
  if (new URL(evidence.finalUrl).hostname !== baseline.host) failures.push("host-drift");
  if (baseline.branchId && !evidence.branchIds.includes(baseline.branchId)) failures.push("missing-branch");
  if (evidence.digest !== baseline.digest) failures.push("digest-drift");
  return failures;
}
async function main() {
  const config = loadLandingConfig();
  const links = getLandingLinks(config);
  const destinations = [...links.orders.map((order)=>({key:order.store,url:order.href})),{key:"catering",url:links.catering},{key:"inquiry",url:links.inquiry},...links.footer.map((link)=>({key:link.key,url:link.url}))];
  for (const destination of destinations) {
    try {
      const response = await fetch(destination.url,{redirect:"follow",signal:AbortSignal.timeout(15000)});
      const body = await response.text();
      // Report bounded diagnostic facts only. No HTML/customer payload logging.
      console.log(JSON.stringify({key:destination.key,status:response.status,finalHost:new URL(response.url).hostname,redirected:response.redirected,digest:createHash("sha256").update(body).digest("hex"),challenge:/captcha|access denied|verify you are human|cf-chl/i.test(body),branchPayloadVerified:false}));
    } catch {
      console.log(JSON.stringify({key:destination.key,error:"probe-unavailable",branchPayloadVerified:false}));
    }
  }
  console.error("Launch evidence incomplete: verify both branches in merchant payload and serving-option flow; record reviewed response/payload digests and branded-host equivalence.");
  process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
