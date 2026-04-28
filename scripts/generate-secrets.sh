#!/usr/bin/env bash
# =============================================================================
# CO-OPS — Secret Generator (POSIX / bash)
# =============================================================================
# For WSL, macOS, Linux. Windows users: use generate-secrets.ps1 instead.
#
# Usage:
#   bash scripts/generate-secrets.sh
#
# Output: prints to stdout. COPY values into .env.local AND Vercel env vars.
# DO NOT commit the output. DO NOT paste the values into any chat.
# =============================================================================

set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required but not found in PATH." >&2
  exit 1
fi

gen() { openssl rand -hex 32; }

echo "# CO-OPS secrets generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# Copy into .env.local AND Vercel (Production + Preview + Development)."
echo ""
echo "AUTH_JWT_SECRET=$(gen)"
echo "AUTH_PIN_PEPPER=$(gen)"
echo "AUTH_PASSWORD_PEPPER=$(gen)"
echo ""
echo "# IMPORTANT: AUTH_JWT_SECRET must also be configured in Supabase as an HS256"
echo "# standby key (Dashboard -> JWT Keys -> Create standby key, algorithm HS256)."
echo "# If the two drift apart, every authenticated request will fail."
