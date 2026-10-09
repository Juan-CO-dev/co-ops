# CO-OPS Password Vault — design (approved by Juan 2026-10-08)

## Purpose
Never lose a company login or AI key, give people role-based access to the ones they need, and make every view of a shared secret visible to management. Approach A (built into CO-OPS) chosen over a commercial manager because "notify management on every view" + the CO-OPS role/shop model are the core requirements.

## Scope
- **Shared vault:** company logins, codes (Wi-Fi, alarm, safe), vendor/platform logins (Toast, ezCater, vendor portals, Meta), and **AI keys as records only** (apps/agents keep reading keys from Vercel env / local files; the vault is the never-lose copy, not a live secrets service).
- **My logins:** each user's own personal entries.
- Out of scope: browser autofill, mobile apps, live secret delivery to apps, sharing outside CO.

## Entries
Fields: name, type (`login` | `code` | `ai_key`), username, secret (encrypted), optional URL, notes (plain, no secrets), shop (`EM` | `MEP` | both), owner (personal only).
Shared entries carry a **role floor**: KH+ (4), SL+ (5), AGM+ (6), GM+ (7), Level 8+, owner/cgs only. **AI keys default to owner/cgs only.**

## Visibility and management
- List view shows name, type, username, shop for shared entries at/above the viewer's level and in their shops — never the secret.
- "My logins" are visible only to their owner.
- GMs add/edit shared entries for their own shop; level 8+ manage everything (incl. AI keys, both-shop entries); everyone manages their own personal entries.

## Reveal flow
1. Tap **Reveal** -> PIN step-up (existing step-up tier).
2. Banner: "This view is recorded. Management has been notified." (en/es)
3. Secret shown with **Copy**; auto-hides after 30 s or on navigation. Never cached client-side.
- **Shared/AI-key reveal:** append-only record (viewer, entry, shop, time; never the secret) + immediate notification to level 8+ (Juan, Pete, Cristian) and the entry shop's GM via the in-app notification bell (email/WhatsApp channels follow the post-launch delivery switch). Example: "Maya (KH, P Street) viewed 'Toast back-office login' · 3:12 PM".
- **Personal reveal:** PIN step-up, no record, no notification.
- **Owner-level recovery of a personal entry:** recorded + the entry's owner is notified.

## Guardrails
- Reveal rate cap per user per hour; a burst is flagged to management.
- Create/edit/delete of a shared entry is recorded + notified.
- On change, the previous secret is kept 30 days, recoverable by level 8+ (recorded + notified).
- Deactivated users lose access immediately; role/shop changes apply immediately.

## Security
- Envelope encryption, AES-256-GCM: a per-entry data key encrypts the secret; the data key is wrapped by a **master key held only in server env (Vercel)**, never in the database. A database dump alone reveals nothing.
- Decrypt only server-side inside an authorized reveal; the plaintext never enters logs, audit rows, analytics, errors or the client bundle.
- Deny-all RLS + service-role writers (house pattern), location bind, closed audit vocabulary, step-up B or higher for reveals.
- Decryption failure (missing/rotated key) fails closed with an alert; nothing partial is shown.
- Master-key rotation: documented procedure (re-wrap every data key with the new master key); not built in v1.

## Testing
Role/shop floors (no one below a floor can list-reveal or reveal), every shared reveal writes the record + sends the notification, personal entries never notify/record, owner recovery records + notifies, rate cap, secret absent from every log/audit/error, en/es parity, 44 px, SQL harness on the sim.

## Delivery
Built by CO CC, reviewed by Astra, CC verifies on the sim and merges. Behind an on/off switch; then level 8+ load the first shared entries.
