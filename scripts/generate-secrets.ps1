# =============================================================================
# CO-OPS — Secret Generator (Windows / PowerShell)
# =============================================================================
# Generates AUTH_JWT_SECRET, AUTH_PIN_PEPPER, AUTH_PASSWORD_PEPPER as
# 64-hex-character (256-bit) cryptographic secrets.
#
# Usage:
#   npm run secrets:generate
#   # or directly:
#   powershell -ExecutionPolicy Bypass -File scripts/generate-secrets.ps1
#
# Output: prints to stdout. COPY values into .env.local AND Vercel env vars.
# DO NOT commit the output. DO NOT paste the values into any chat.
# =============================================================================

$ErrorActionPreference = "Stop"

function New-HexSecret {
    param([int]$Bytes = 32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $buf = New-Object byte[] $Bytes
        $rng.GetBytes($buf)
        ($buf | ForEach-Object { $_.ToString("x2") }) -join ""
    } finally {
        $rng.Dispose()
    }
}

Write-Output "# CO-OPS secrets generated $(Get-Date -Format o)"
Write-Output "# Copy into .env.local AND Vercel (Production + Preview + Development)."
Write-Output ""
Write-Output "AUTH_JWT_SECRET=$(New-HexSecret)"
Write-Output "AUTH_PIN_PEPPER=$(New-HexSecret)"
Write-Output "AUTH_PASSWORD_PEPPER=$(New-HexSecret)"
Write-Output ""
Write-Output "# IMPORTANT: AUTH_JWT_SECRET must also be set as the Supabase project's"
Write-Output "# JWT Secret (Dashboard -> Settings -> API -> JWT Settings)."
Write-Output "# If the two drift apart, every authenticated request will fail."
