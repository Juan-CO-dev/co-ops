/**
 * Notification primitives — Build #3 PR 3 Step 5.
 *
 * Foundation lib for in-app notifications. PR 3 Step 4 already emits the
 * first notification class (under-par alerts) directly from the
 * submit_opening_atomic RPC for transactional safety. This lib provides
 * the JS-side helpers used by:
 *   - Future non-transactional emission paths (caller imports
 *     enqueueNotification when the notification can be best-effort, not
 *     transactionally tied to a parent operation)
 *   - Dashboard polling read (Step 7 — loadUnreadForUser surfaces unread
 *     in-app notifications for the bell affordance)
 *   - Mark-as-read flow (Step 7 dashboard tap → markNotificationRead)
 *   - Render-time i18n resolution (formatNotification reads
 *     data.titleKey/titleParams/bodyKey/bodyParams written by either RPC
 *     or JS-side helper)
 *
 * Replaces the Phase 0 `export {}` stub. Original spec note (preserved as
 * forward-note for SMS/email/prefs work):
 *   sendNotification({ type, category, title, body, recipients[], locationId? }):
 *   - Inserts notifications row
 *   - Inserts notification_recipients per recipient with desired delivery method
 *   - Per recipient: respects user_notification_prefs (in_app/sms/email,
 *     alert_categories, quiet_hours)
 *   - Queues SMS via sms_queue when sms_enabled (Twilio activation deferred)
 *   - Sends email via Resend when email_enabled
 * Step 5 ships the in_app + foundation primitives; SMS/email + prefs/quiet-hours
 * fold in alongside Module #6 (Internal Comms) when A2P clears.
 *
 * Design references:
 *   - BUILD_3_OPENING_REPORT_DESIGN.md §3.3 (under-par notification routing)
 *   - SPEC_AMENDMENTS.md C.50 PENDING (notifications.priority TEXT-with-CHECK
 *     + notifications.type vocabulary at lib layer not DB layer)
 *   - AGENTS.md "PostgREST embedded-select .eq() filter on relation" lesson
 *     — loadUnreadForUser uses two-step query pattern (recipients → notifications
 *     by id), not embedded-select-with-eq-on-relation
 *
 * Locked sub-decisions (Step 5 architectural surface):
 *   Q1: enqueueNotification auto-builds standard data JSONB; PROTECTED_DATA_KEYS
 *       collision check throws (caller bug, not feature)
 *   Q2: loadUnreadForUser filters delivery_method='in_app' AND
 *       delivery_status != 'disabled' at query level; orders created_at DESC;
 *       default limit=50
 *   Q3: markNotificationRead preserves original read_at on second call;
 *       returns {recipient, newlyMarked}; service-role + WHERE user_id
 *       authorization defense-in-depth
 *   Q4: NOTIFICATION_TYPES typed-vocabulary pattern; future types extend the
 *       constant
 *   Q5: combined formatNotification helper returns {title, body}; pre-resolves
 *       reasonCategory translation before body interpolation
 *   Q6: i18n keys (10 entries × 2 langs = 20) ship in this commit
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranslationKey, TranslationParams } from "./i18n/types";

// ─────────────────────────────────────────────────────────────────────────────
// Type vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical notification type vocabulary. New notification classes add a
 * value here; future-Claude calling enqueueNotification with an unknown
 * type gets a TS error.
 *
 * Forward-extension pattern: when Module #2 (User Lifecycle) ships its
 * notification class, add `USER_INVITE: 'user_invite'` etc. The vocabulary
 * stays in this constant; DB-side stays free-form text per the locked
 * "type vocabulary at lib layer not DB layer" decision.
 *
 * Drift mitigation: never rename or remove a value here for an active
 * notification type. Existing persisted rows reference the value via their
 * `type` column; renaming silently breaks dashboard render's lookup. To
 * deprecate, comment the entry as deprecated; remove only after all rows
 * with the old type are aged out (or migrated).
 */
export const NOTIFICATION_TYPES = {
  UNDER_PAR_ALERT: "under_par_alert",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Severity per notifications.priority CHECK constraint (migration 0049). */
export type NotificationPriority = "info" | "urgent";

/** Delivery channels per notification_recipients.delivery_method CHECK. */
export type DeliveryMethod = "in_app" | "sms" | "email";

/** Delivery state per notification_recipients.delivery_status CHECK. */
export type DeliveryStatus = "pending" | "sent" | "failed" | "disabled";

// ─────────────────────────────────────────────────────────────────────────────
// Result row shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationWithRecipient {
  notification: {
    id: string;
    type: NotificationType;
    priority: NotificationPriority;
    title: string;
    body: string | null;
    data: Record<string, unknown>;
    relatedTable: string | null;
    relatedId: string | null;
    locationId: string | null;
    createdAt: string;
  };
  recipient: {
    id: string;
    notificationId: string;
    userId: string;
    deliveryMethod: DeliveryMethod | null;
    deliveryStatus: DeliveryStatus | null;
    readAt: string | null;
    acknowledgedAt: string | null;
  };
}

interface NotificationRow {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  related_table: string | null;
  related_id: string | null;
  location_id: string | null;
  created_at: string;
}

interface RecipientRow {
  id: string;
  notification_id: string;
  user_id: string;
  delivery_method: string | null;
  delivery_status: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

function rowToNotification(r: NotificationRow): NotificationWithRecipient["notification"] {
  return {
    id: r.id,
    type: r.type as NotificationType,
    priority: r.priority as NotificationPriority,
    title: r.title,
    body: r.body,
    data: r.data ?? {},
    relatedTable: r.related_table,
    relatedId: r.related_id,
    locationId: r.location_id,
    createdAt: r.created_at,
  };
}

function rowToRecipient(r: RecipientRow): NotificationWithRecipient["recipient"] {
  return {
    id: r.id,
    notificationId: r.notification_id,
    userId: r.user_id,
    deliveryMethod: (r.delivery_method ?? null) as DeliveryMethod | null,
    deliveryStatus: (r.delivery_status ?? null) as DeliveryStatus | null,
    readAt: r.read_at,
    acknowledgedAt: r.acknowledged_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// enqueueNotification — JS-side helper for non-transactional notification emission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level keys in `data` that the helper auto-builds from typed args.
 * Caller's `extraData` may NOT include these — collision throws because
 * mistyped extraData.titleKey would silently break render-time resolution.
 */
const PROTECTED_DATA_KEYS = ["titleKey", "titleParams", "bodyKey", "bodyParams"] as const;

export interface EnqueueNotificationArgs {
  type: NotificationType;
  priority: NotificationPriority;
  titleKey: TranslationKey;
  titleParams?: TranslationParams;
  bodyKey: TranslationKey;
  bodyParams?: TranslationParams;
  /** Merged into data JSONB after standard keys. PROTECTED_DATA_KEYS collision throws. */
  extraData?: Record<string, unknown>;
  /** Optional EN-fallback title literal for the notifications.title NOT NULL column. */
  title?: string;
  /** Optional EN-fallback body literal for the notifications.body column (nullable). */
  body?: string;
  relatedTable?: string;
  relatedId?: string;
  locationId?: string;
  createdBy?: string;
  recipients: Array<{
    userId: string;
    /** Defaults to 'in_app'. */
    deliveryMethod?: DeliveryMethod;
  }>;
}

/**
 * Inserts a notifications row + N notification_recipients rows. Best-effort:
 * if the parent insert fails, the helper throws and recipients are not
 * written. If the recipients insert fails, the helper throws but the parent
 * notifications row remains (caller must clean up if needed). For
 * transactional safety, use the RPC-side emission pattern (e.g.,
 * submit_opening_atomic RPC writes both inside one transaction).
 *
 * @returns the new notification id + the new recipient ids
 */
export async function enqueueNotification(
  service: SupabaseClient,
  args: EnqueueNotificationArgs,
): Promise<{ notificationId: string; recipientIds: string[] }> {
  // Build data JSONB with PROTECTED_DATA_KEYS collision check.
  if (args.extraData) {
    const collisions = PROTECTED_DATA_KEYS.filter((k) => k in args.extraData!);
    if (collisions.length > 0) {
      throw new Error(
        `enqueueNotification: extraData cannot include protected keys: ${collisions.join(", ")}. ` +
          `Use the typed args (titleKey/titleParams/bodyKey/bodyParams) instead.`,
      );
    }
  }
  const data: Record<string, unknown> = {
    titleKey: args.titleKey,
    titleParams: args.titleParams ?? {},
    bodyKey: args.bodyKey,
    bodyParams: args.bodyParams ?? {},
    ...(args.extraData ?? {}),
  };

  // notifications.title is NOT NULL — fallback to titleKey string when caller
  // doesn't provide an EN literal. Direct DB inspections see the key name.
  const titleFallback = args.title ?? args.titleKey;

  const { data: insertedNotif, error: notifErr } = await service
    .from("notifications")
    .insert({
      type: args.type,
      category: null,
      priority: args.priority,
      title: titleFallback,
      body: args.body ?? null,
      data,
      related_table: args.relatedTable ?? null,
      related_id: args.relatedId ?? null,
      location_id: args.locationId ?? null,
      created_by: args.createdBy ?? null,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (notifErr || !insertedNotif) {
    throw new Error(
      `enqueueNotification: notifications insert failed: ${notifErr?.message ?? "no row"}`,
    );
  }
  const notificationId = insertedNotif.id;

  // Recipients: bulk-insert one row per recipient.
  const recipientRows = args.recipients.map((r) => ({
    notification_id: notificationId,
    user_id: r.userId,
    delivery_method: r.deliveryMethod ?? "in_app",
    delivery_status: "pending",
  }));
  const { data: insertedRecipients, error: recipErr } = await service
    .from("notification_recipients")
    .insert(recipientRows)
    .select("id");
  if (recipErr) {
    throw new Error(
      `enqueueNotification: recipients insert failed: ${recipErr.message} ` +
        `(notification ${notificationId} remains; manual cleanup may be needed)`,
    );
  }
  const recipientIds = ((insertedRecipients ?? []) as Array<{ id: string }>).map(
    (r) => r.id,
  );

  return { notificationId, recipientIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// loadUnreadForUser — dashboard polling read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads unread in-app notifications for a user, ordered most-recent-first.
 * Two-step query (per AGENTS.md "PostgREST embedded-select" lesson):
 *   Step 1: notification_recipients with delivery_method='in_app' +
 *           delivery_status != 'disabled' + read_at IS NULL filters
 *   Step 2: notifications by id, ordered by created_at DESC, optional
 *           location_id filter, limit applied
 *
 * Result joins both rows into NotificationWithRecipient pairs, ordered by
 * notification.createdAt DESC (matches step 2 ordering).
 *
 * Authorization: caller passes userId; the lib does NOT enforce identity
 * here (caller's responsibility — typically the route handler that already
 * verified session ownership). The query's user_id filter is the access
 * predicate; service-role bypass means no RLS gate, so the WHERE clause
 * is the only access control.
 */
export async function loadUnreadForUser(
  service: SupabaseClient,
  userId: string,
  args?: {
    /** Filter notifications to these locations (and global notifications with location_id=NULL). */
    locationContext?: string[];
    /** Max rows returned. Default 50. */
    limit?: number;
  },
): Promise<NotificationWithRecipient[]> {
  const limit = args?.limit ?? 50;

  // Step 1: fetch matching recipient rows.
  const { data: recipRows, error: recipErr } = await service
    .from("notification_recipients")
    .select(
      "id, notification_id, user_id, delivery_method, delivery_status, read_at, acknowledged_at",
    )
    .eq("user_id", userId)
    .is("read_at", null)
    .eq("delivery_method", "in_app")
    .neq("delivery_status", "disabled");
  if (recipErr) {
    throw new Error(`loadUnreadForUser: recipients query failed: ${recipErr.message}`);
  }
  const recipients = (recipRows ?? []) as RecipientRow[];
  if (recipients.length === 0) return [];

  const notifIds = recipients.map((r) => r.notification_id);

  // Step 2: fetch notifications, ordered + limited + optional location filter.
  let notifQuery = service
    .from("notifications")
    .select(
      "id, type, priority, title, body, data, related_table, related_id, location_id, created_at",
    )
    .in("id", notifIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (args?.locationContext && args.locationContext.length > 0) {
    // Include global notifications (location_id IS NULL) plus the requested locations.
    const locFilter = args.locationContext
      .map((id) => `location_id.eq.${id}`)
      .concat(["location_id.is.null"])
      .join(",");
    notifQuery = notifQuery.or(locFilter);
  }

  const { data: notifRows, error: notifErr } = await notifQuery;
  if (notifErr) {
    throw new Error(`loadUnreadForUser: notifications query failed: ${notifErr.message}`);
  }

  // Pair recipients with notifications, preserving notifications order.
  const recipientByNotif = new Map<string, RecipientRow>();
  for (const r of recipients) recipientByNotif.set(r.notification_id, r);

  const result: NotificationWithRecipient[] = [];
  for (const n of (notifRows ?? []) as NotificationRow[]) {
    const r = recipientByNotif.get(n.id);
    if (!r) continue;
    result.push({
      notification: rowToNotification(n),
      recipient: rowToRecipient(r),
    });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// markNotificationRead — idempotent + authorization-safe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks a recipient row as read. Idempotent: if read_at was already set,
 * the original timestamp is preserved (no clobber) and `newlyMarked: false`
 * is returned. The "first read" is the canonical timestamp.
 *
 * Authorization: filter `WHERE user_id = $userId` is critical defense-in-
 * depth. Service role bypasses RLS, so the WHERE clause prevents cross-user
 * mark-read attacks if the helper is ever called with a wrong userId.
 *
 * Throws when the recipient row doesn't exist OR the user_id doesn't match
 * (caller passed wrong userId).
 */
export async function markNotificationRead(
  service: SupabaseClient,
  args: { recipientId: string; userId: string },
): Promise<{
  recipient: NotificationWithRecipient["recipient"];
  /** True when this call landed read_at; false when already read. */
  newlyMarked: boolean;
}> {
  const now = new Date().toISOString();

  // First attempt: set read_at only if currently NULL.
  const { data: updated, error: updateErr } = await service
    .from("notification_recipients")
    .update({ read_at: now })
    .eq("id", args.recipientId)
    .eq("user_id", args.userId)
    .is("read_at", null)
    .select(
      "id, notification_id, user_id, delivery_method, delivery_status, read_at, acknowledged_at",
    )
    .maybeSingle<RecipientRow>();
  if (updateErr) {
    throw new Error(`markNotificationRead: update failed: ${updateErr.message}`);
  }

  if (updated) {
    return { recipient: rowToRecipient(updated), newlyMarked: true };
  }

  // No row updated — either already read OR not authorized. Fetch current
  // state via the same authorization filter to disambiguate.
  const { data: current, error: readErr } = await service
    .from("notification_recipients")
    .select(
      "id, notification_id, user_id, delivery_method, delivery_status, read_at, acknowledged_at",
    )
    .eq("id", args.recipientId)
    .eq("user_id", args.userId)
    .maybeSingle<RecipientRow>();
  if (readErr) {
    throw new Error(`markNotificationRead: post-update read failed: ${readErr.message}`);
  }
  if (!current) {
    throw new Error(
      `markNotificationRead: recipient ${args.recipientId} not found OR user_id mismatch — ` +
        `cross-user mark-read blocked by authorization filter.`,
    );
  }

  return { recipient: rowToRecipient(current), newlyMarked: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Severity + render helpers
// ─────────────────────────────────────────────────────────────────────────────

export function isUrgent(n: { priority: NotificationPriority }): boolean {
  return n.priority === "urgent";
}

/**
 * Resolves notification.data.titleKey/titleParams/bodyKey/bodyParams via the
 * caller's translation function. Pre-resolves nested translation keys
 * (currently: bodyParams.reasonCategory for under_par_alert) before
 * interpolating into body template. Returns trimmed strings.
 *
 * Caller passes a TranslateFn shaped like serverT or client-side useTranslation
 * `t`. This helper is the canonical render-time resolution path; the dashboard
 * polling surface (Step 7) consumes this exclusively.
 *
 * Fallback chain when data.titleKey/bodyKey is missing OR not in
 * TranslationKey union (e.g., notification persisted before key existed):
 *   1. data.titleKey/bodyKey resolved via t() — if the key isn't in
 *      en.json, t() returns the key string as last fallback (per
 *      lib/i18n/server.ts `serverT` semantics).
 *   2. notification.title/body literal (NOT NULL title; nullable body) —
 *      the EN fallback written at notifications insert time.
 *   3. Empty string — last resort.
 */
export function formatNotification(
  notification: NotificationWithRecipient["notification"],
  t: (key: TranslationKey, params?: TranslationParams) => string,
): { title: string; body: string } {
  const data = notification.data as {
    titleKey?: TranslationKey;
    titleParams?: TranslationParams;
    bodyKey?: TranslationKey;
    bodyParams?: TranslationParams;
  };

  // Pre-resolve nested translation keys. Currently only bodyParams.reasonCategory
  // for under_par_alert; the helper checks generically so future notification
  // types adding nested keys can extend the same pattern.
  const bodyParams: TranslationParams = { ...(data.bodyParams ?? {}) };
  if (
    notification.type === "under_par_alert" &&
    typeof bodyParams.reasonCategory === "string"
  ) {
    const reasonKey =
      `notifications.under_par_alert.reason.${bodyParams.reasonCategory}` as TranslationKey;
    bodyParams.reasonCategory = t(reasonKey, {});
  }

  const title = data.titleKey
    ? t(data.titleKey, data.titleParams ?? {})
    : (notification.title ?? "");
  const body = data.bodyKey
    ? t(data.bodyKey, bodyParams)
    : (notification.body ?? "");

  return {
    title: title.trim(),
    body: body.trim(),
  };
}
