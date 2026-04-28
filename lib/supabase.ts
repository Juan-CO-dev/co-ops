/**
 * Browser-side Supabase client — Phase 1.
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Authenticated requests carry our JWT (signed with AUTH_JWT_SECRET, which
 * matches the Supabase project's JWT secret per architectural decision §2)
 * so RLS sees `request.jwt.claim.user_id` natively.
 */
export {};
