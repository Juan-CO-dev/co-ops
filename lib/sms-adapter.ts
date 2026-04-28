/**
 * Twilio SMS adapter — scaffolded, deferred per spec Section 2.8.
 *
 * isEnabled(): boolean — reads TWILIO_ENABLED env var
 * sendSms(to, body): when disabled, marks the sms_queue row as 'disabled'
 *                    and no-ops; otherwise dispatches via Twilio REST API
 * processSmsQueue(): batch invoked by Vercel Cron via /api/sms/process-queue
 */
export {};
