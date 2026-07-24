/**
 * One-shot ezCater integration setup (spec #2c). Run AFTER Juan's ezManage
 * errand puts EZCATER_API_TOKEN in the environment.
 *
 *   npx tsx scripts/ezcater-setup.ts                     # list caterers (uuid ↔ store)
 *   npx tsx scripts/ezcater-setup.ts --create-subscriber https://<domain>/api/webhooks/ezcater
 *   npx tsx scripts/ezcater-setup.ts --subscribe <subscriberId> <catererUuid> [...more uuids]
 *
 * createSubscriber prints the webhookSecret ONCE (ezCater never shows it
 * again) — save it to EZCATER_WEBHOOK_SECRET immediately. ONE subscriber per
 * API user (their limit); accepted + cancelled subscriptions are created per
 * caterer uuid. Operations are NAMED per ezCater's conventions.
 */
import { pathToFileURL } from "node:url";

import { ezcaterGraphql, ezcaterConfigured } from "@/lib/ezcater/client";

async function listCaterers(): Promise<void> {
  const res = await ezcaterGraphql<{ data?: { caterers?: Array<{ uuid: string; name: string; storeNumber: string | null; address?: { street?: string; city?: string } }> } }>(
    "allCaterers",
    `query allCaterers { caterers { uuid name storeNumber address { street city } } }`,
  );
  const caterers = res.data?.caterers ?? [];
  console.log(`caterers (${caterers.length}):`);
  for (const c of caterers) {
    console.log(`  ${c.uuid}  ${c.name}${c.storeNumber ? ` #${c.storeNumber}` : ""}  ${c.address?.street ?? ""} ${c.address?.city ?? ""}`);
  }
  console.log("\nPaste each uuid into the matching location on /admin/catering/menu → Toast tab → EZCater field.");
}

async function createSubscriber(webhookUrl: string): Promise<void> {
  const res = await ezcaterGraphql<{ data?: { createSubscriber?: { subscriber?: { id: string; webhookSecret: string } } } }>(
    "createSubscriber",
    `mutation createSubscriber($params: SubscriberParams!) {
      createSubscriber(subscriberParams: $params) { subscriber { id name webhookUrl webhookSecret } }
    }`,
    { params: { name: "CO-OPS", webhookUrl } },
  );
  const sub = res.data?.createSubscriber?.subscriber;
  if (!sub) throw new Error("createSubscriber returned no subscriber (one may already exist — run allSubscribers)");
  console.log(`subscriberId: ${sub.id}`);
  console.log("\n*** SAVE THIS NOW — shown ONCE, unrecoverable: ***");
  console.log(`EZCATER_WEBHOOK_SECRET=${sub.webhookSecret}\n`);
}

async function subscribe(subscriberId: string, catererUuids: string[]): Promise<void> {
  for (const catererUuid of catererUuids) {
    for (const eventKey of ["accepted", "cancelled"]) {
      const res = await ezcaterGraphql<{ data?: { createSubscription?: { subscription?: Record<string, unknown> } } }>(
        "createSubscription",
        `mutation createSubscription($params: SubscriptionParams!) {
          createSubscription(subscriptionParams: $params) { subscription { parentEntity parentId eventKey eventEntity } }
        }`,
        { params: { subscriberId, eventKey, eventEntity: "Order", parentEntity: "Caterer", parentId: catererUuid } },
      );
      console.log(`  ${catererUuid} ${eventKey}: ${res.data?.createSubscription?.subscription ? "ok" : "FAILED"}`);
    }
  }
}

async function main(): Promise<void> {
  if (!ezcaterConfigured() && process.env.EZCATER_FIXTURES !== "1") {
    console.error("EZCATER_API_TOKEN not set — run after the ezManage token errand.");
    process.exitCode = 1;
    return;
  }
  const [, , flag, ...rest] = process.argv;
  if (flag === "--create-subscriber" && rest[0]) return createSubscriber(rest[0]);
  if (flag === "--subscribe" && rest.length >= 2) return subscribe(rest[0]!, rest.slice(1));
  return listCaterers();
}

// House law: data-touching scripts gate main() behind a direct-invocation check.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
