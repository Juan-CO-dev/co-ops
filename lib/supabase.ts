/**
 * Browser-side Supabase client — Phase 1.
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
 *
 * Authenticated requests carry our JWT (signed with AUTH_JWT_SECRET).
 * Supabase verifies it via the matching HS256 *standby key* configured in
 * the Supabase JWT Keys dashboard. PostgREST then exposes claims to RLS as
 * `request.jwt.claim.user_id`.
 *
 * Architecture: see Foundation Spec §2 + README "Critical — Supabase HS256
 * standby key" section.
 */
export {};
