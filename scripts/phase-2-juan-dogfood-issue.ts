/**
 * Phase 2 Session 5 Workstream 3 — issue Juan's dogfood verify token.
 *
 * One-shot. Generates a fresh email_verifications token (24h expiry) for
 * juan@complimentsonlysubs.com, inserts the hashed token row via service-role,
 * and dispatches the branded verification email through the project's
 * lib/email.ts Resend wrapper using lib/email-templates/verification.ts.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/phase-2-juan-dogfood-issue.ts
 *
 * The raw token never touches disk. The DB stores SHA-256(token) only.
 * The user clicks the link in the email; the form on /verify submits to
 * /api/auth/verify which hashes the URL token and matches against the row.
 *
 * Discardable script — ad-hoc operational tool, not a regression artifact.
 */

import { createClient } from "@supabase/supabase-js";

import { generateToken, hashToken } from "../lib/auth";
import { sendEmail } from "../lib/email";
import { renderVerificationEmail } from "../lib/email-templates/verification";

const JUAN_EMAIL = "juan@complimentsonlysubs.com";
const EXPIRES_HOURS = 24;

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Resolve Juan's user_id
  const { data: user, error: userErr } = await sb
    .from("users")
    .select("id, email, active, email_verified")
    .eq("email", JUAN_EMAIL)
    .maybeSingle<{ id: string; email: string; active: boolean; email_verified: boolean }>();
  if (userErr || !user) {
    throw new Error(`Could not resolve user ${JUAN_EMAIL}: ${userErr?.message ?? "not found"}`);
  }
  if (!user.active) throw new Error(`User ${JUAN_EMAIL} is inactive`);

  // Generate fresh token (raw stays in this process only)
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EXPIRES_HOURS * 3600 * 1000);

  const { data: row, error: insertErr } = await sb
    .from("email_verifications")
    .insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insertErr || !row) {
    throw new Error(`email_verifications insert failed: ${insertErr?.message ?? "no row"}`);
  }

  const { html, text } = renderVerificationEmail({
    rawToken,
    expiresInHours: EXPIRES_HOURS,
  });

  const result = await sendEmail({
    to: JUAN_EMAIL,
    subject: "Verify your account — CO-OPS",
    html,
    text,
  });

  if ("error" in result) {
    process.stdout.write(
      `FAIL: email send rejected — ${result.error}\n` +
        `  user_id=${user.id}\n` +
        `  verification_id=${row.id}\n` +
        `  expires_at=${expiresAt.toISOString()}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `OK: verification email dispatched to ${JUAN_EMAIL}\n` +
      `  user_id=${user.id}\n` +
      `  verification_id=${row.id}\n` +
      `  resend_id=${result.id}\n` +
      `  expires_at=${expiresAt.toISOString()}\n` +
      `  app_url=${process.env.NEXT_PUBLIC_APP_URL ?? "(NEXT_PUBLIC_APP_URL unset!)"}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
