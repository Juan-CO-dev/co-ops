/**
 * Notification fan-out — Phase 6.
 *
 * sendNotification({ type, category, title, body, recipients[], locationId? }):
 *   - Inserts notifications row
 *   - Inserts notification_recipients per recipient with desired delivery method
 *   - Per recipient: respects user_notification_prefs (in_app/sms/email,
 *     alert_categories, quiet_hours)
 *   - Queues SMS via sms_queue when sms_enabled (Twilio activation deferred)
 *   - Sends email via Resend when email_enabled
 */
export {};
