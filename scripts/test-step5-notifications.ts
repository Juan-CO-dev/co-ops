/**
 * Test script: Step 5 lib/notifications.ts end-to-end verification.
 *
 * Exercises enqueueNotification → loadUnreadForUser → markNotificationRead
 * cycle + PROTECTED_DATA_KEYS guard + cross-user mark-read authorization.
 * Self-cleans via final DELETE (try/finally pattern).
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-step5-notifications.ts
 *
 * Expected output: "Step 5 verification PASS" + structured matrix.
 *
 * NOT a permanent test harness; this is a one-time pre-commit verification.
 * Future Reports Hub or Internal Comms work would build a proper test suite.
 */

import { createClient } from "@supabase/supabase-js";

import {
  enqueueNotification,
  formatNotification,
  isUrgent,
  loadUnreadForUser,
  markNotificationRead,
  NOTIFICATION_TYPES,
  type NotificationWithRecipient,
} from "../lib/notifications";

const JUAN_ID = "16329556-900e-4cbb-b6e0-1829c6f4a6ed";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  process.stdout.write(`  ${pass ? "✓" : "✗"} ${name}${detail ? `  (${detail})` : ""}\n`);
}

async function main() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let createdNotificationId: string | null = null;
  let createdRecipientIds: string[] = [];

  try {
    process.stdout.write("Step 5 verification: lib/notifications.ts\n\n");

    // ─────────────────────────────────────────────────────────────────
    // 1. enqueueNotification — happy path
    // ─────────────────────────────────────────────────────────────────
    const enqueued = await enqueueNotification(sb, {
      type: NOTIFICATION_TYPES.UNDER_PAR_ALERT,
      priority: "urgent",
      titleKey: "notifications.under_par_alert.title",
      titleParams: { itemName: "Basil", locationCode: "MEP" },
      bodyKey: "notifications.under_par_alert.body",
      bodyParams: {
        openerName: "Test User",
        prepped: 1,
        par: 3,
        closer: 3,
        reasonCategory: "ingredient_unavailable",
        freeText: "Test free text",
      },
      title: "Under-par: Basil at MEP",
      body: null as unknown as string | undefined,
      extraData: { itemName: "Basil", parDelta: -2 },
      relatedTable: "checklist_completions",
      locationId: "54ce1029-400e-4a92-9c2b-0ccb3b031f0a",
      createdBy: JUAN_ID,
      recipients: [{ userId: JUAN_ID, deliveryMethod: "in_app" }],
    });
    createdNotificationId = enqueued.notificationId;
    createdRecipientIds = enqueued.recipientIds;

    check("enqueueNotification returns notificationId", !!enqueued.notificationId);
    check(
      "enqueueNotification returns 1 recipientId",
      enqueued.recipientIds.length === 1,
      `count=${enqueued.recipientIds.length}`,
    );

    // ─────────────────────────────────────────────────────────────────
    // 2. enqueueNotification — PROTECTED_DATA_KEYS guard
    // ─────────────────────────────────────────────────────────────────
    let guardThrew = false;
    let guardError = "";
    try {
      await enqueueNotification(sb, {
        type: NOTIFICATION_TYPES.UNDER_PAR_ALERT,
        priority: "info",
        titleKey: "notifications.under_par_alert.title",
        bodyKey: "notifications.under_par_alert.body",
        extraData: {
          titleKey: "MUST_THROW",
          itemName: "test",
        } as Record<string, unknown>,
        recipients: [{ userId: JUAN_ID }],
      });
    } catch (err) {
      guardThrew = true;
      guardError = err instanceof Error ? err.message : String(err);
    }
    check("PROTECTED_DATA_KEYS collision throws", guardThrew);
    check(
      "PROTECTED_DATA_KEYS error message names protected key",
      guardError.includes("titleKey"),
      `msg="${guardError.slice(0, 100)}"`,
    );

    // ─────────────────────────────────────────────────────────────────
    // 3. loadUnreadForUser — surfaces the enqueued notification
    // ─────────────────────────────────────────────────────────────────
    const unread = await loadUnreadForUser(sb, JUAN_ID);
    const ours = unread.find((n) => n.notification.id === createdNotificationId);
    check("loadUnreadForUser surfaces enqueued notification", !!ours);
    check(
      "loadUnreadForUser returns priority='urgent'",
      ours?.notification.priority === "urgent",
      `actual=${ours?.notification.priority}`,
    );
    check(
      "loadUnreadForUser returns recipient.readAt=null",
      ours?.recipient.readAt === null,
      `actual=${ours?.recipient.readAt}`,
    );
    check(
      "loadUnreadForUser data carries titleKey",
      ours?.notification.data.titleKey === "notifications.under_par_alert.title",
      `actual=${ours?.notification.data.titleKey}`,
    );
    check(
      "loadUnreadForUser data carries extraData merged (parDelta=-2)",
      ours?.notification.data.parDelta === -2,
      `actual=${ours?.notification.data.parDelta}`,
    );

    // ─────────────────────────────────────────────────────────────────
    // 4. isUrgent helper
    // ─────────────────────────────────────────────────────────────────
    check(
      "isUrgent returns true for priority='urgent'",
      ours ? isUrgent(ours.notification) : false,
    );

    // ─────────────────────────────────────────────────────────────────
    // 5. formatNotification — title + body via translation function
    //    Use a synthetic t() that mirrors serverT semantics for EN.
    // ─────────────────────────────────────────────────────────────────
    const en = (await import("../lib/i18n/en.json")).default as Record<string, string>;
    const t = (key: string, params?: Record<string, string | number>): string => {
      const template = en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
        const v = params[name];
        return v === undefined ? `{${name}}` : String(v);
      });
    };
    const formatted = ours
      ? formatNotification(
          ours.notification,
          t as Parameters<typeof formatNotification>[1],
        )
      : { title: "", body: "" };
    check(
      "formatNotification.title resolves correctly",
      formatted.title === "Under-par: Basil at MEP",
      `actual="${formatted.title}"`,
    );
    check(
      "formatNotification.body resolves reasonCategory translation",
      formatted.body.includes("Ingredient unavailable"),
      `body contains: "${formatted.body.slice(0, 80)}…"`,
    );

    // ─────────────────────────────────────────────────────────────────
    // 6. markNotificationRead — first call (newly marked)
    // ─────────────────────────────────────────────────────────────────
    const firstMark = await markNotificationRead(sb, {
      recipientId: createdRecipientIds[0]!,
      userId: JUAN_ID,
    });
    check("first markNotificationRead — newlyMarked=true", firstMark.newlyMarked);
    const firstReadAt = firstMark.recipient.readAt;
    check("first markNotificationRead sets readAt", firstReadAt !== null);

    // ─────────────────────────────────────────────────────────────────
    // 7. markNotificationRead — second call (idempotent; preserves original)
    // ─────────────────────────────────────────────────────────────────
    await new Promise((r) => setTimeout(r, 10)); // ensure clock would advance
    const secondMark = await markNotificationRead(sb, {
      recipientId: createdRecipientIds[0]!,
      userId: JUAN_ID,
    });
    check(
      "second markNotificationRead — newlyMarked=false",
      !secondMark.newlyMarked,
    );
    check(
      "second markNotificationRead preserves original readAt (no clobber)",
      secondMark.recipient.readAt === firstReadAt,
      `first=${firstReadAt} second=${secondMark.recipient.readAt}`,
    );

    // ─────────────────────────────────────────────────────────────────
    // 8. markNotificationRead — cross-user authorization (must throw)
    // ─────────────────────────────────────────────────────────────────
    let crossUserThrew = false;
    let crossUserError = "";
    try {
      await markNotificationRead(sb, {
        recipientId: createdRecipientIds[0]!,
        userId: "00000000-0000-0000-0000-000000000000", // wrong user
      });
    } catch (err) {
      crossUserThrew = true;
      crossUserError = err instanceof Error ? err.message : String(err);
    }
    check("cross-user markNotificationRead throws", crossUserThrew);
    check(
      "cross-user error names authorization filter",
      crossUserError.includes("authorization filter") || crossUserError.includes("user_id mismatch"),
      `msg="${crossUserError.slice(0, 120)}"`,
    );

    // ─────────────────────────────────────────────────────────────────
    // 9. loadUnreadForUser — after read, should NOT surface
    // ─────────────────────────────────────────────────────────────────
    const unreadAfter = await loadUnreadForUser(sb, JUAN_ID);
    const stillThere = unreadAfter.find(
      (n: NotificationWithRecipient) => n.notification.id === createdNotificationId,
    );
    check(
      "loadUnreadForUser excludes read notifications",
      !stillThere,
      stillThere ? "still present" : "correctly excluded",
    );

    // ─────────────────────────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────────────────────────
    process.stdout.write("\n");
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;
    if (failed === 0) {
      process.stdout.write(`✅ Step 5 verification PASS — ${passed}/${results.length} checks\n`);
    } else {
      process.stdout.write(`❌ Step 5 verification FAILED — ${failed} of ${results.length} checks\n`);
      for (const r of results.filter((x) => !x.pass)) {
        process.stdout.write(`    ✗ ${r.name}${r.detail ? `  (${r.detail})` : ""}\n`);
      }
      process.exit(1);
    }
  } finally {
    // Clean up test rows.
    if (createdRecipientIds.length > 0) {
      await sb.from("notification_recipients").delete().in("id", createdRecipientIds);
    }
    if (createdNotificationId) {
      await sb.from("notifications").delete().eq("id", createdNotificationId);
    }
    process.stdout.write(
      `\nCleanup: deleted ${createdRecipientIds.length} recipient(s) + ${createdNotificationId ? "1" : "0"} notification\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
