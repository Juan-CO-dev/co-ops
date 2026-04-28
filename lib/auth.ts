/**
 * Auth primitives — Phase 2.
 *
 * Functions:
 *   - hashPin(pin), verifyPin(pin, hash)
 *   - hashPassword(pw), verifyPassword(pw, hash)
 *   - signJwt(claims), verifyJwt(token)
 *   - findUserByPinAndName(name, pin)
 *   - findUserByEmail(email)
 *
 * Implementation notes:
 *   - bcrypt cost 12 for both PIN and password
 *   - PINs are peppered with AUTH_PIN_PEPPER before hashing
 *   - Passwords peppered with AUTH_PASSWORD_PEPPER before hashing
 *   - JWTs signed with AUTH_JWT_SECRET (= Supabase project JWT secret)
 *   - JWT claim shape: { user_id, role, role_level, locations[], session_id, exp }
 *   - Min PIN length: 5 for level 5+, 4 for level 4 and below (lib/roles.ts)
 *   - Lockout: 5 failures → 15min; 2nd lockout in 24h → 1hr; 3rd → admin unlock
 */
export {};
