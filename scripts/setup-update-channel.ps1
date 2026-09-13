<#
One-time setup of the in-app update channel. Safe to re-run.

  1. creates the public Storage bucket `updates`  (needs the service/secret key)
  2. deploys the `updates` Edge Function with JWT verification OFF
  3. smoke-tests the endpoint and explains what the answer means

Why each piece matters:
  * the bucket must be PUBLIC -- the Tauri updater downloads the installer with
    no Authorization header whatsoever, so a private bucket means every client
    fails to download;
  * JWT verification must be OFF -- same reason, the updater's request carries no
    Supabase credentials, so verify_jwt=true (the default, and what tg-relay
    uses) would answer 401 to every check.

Credentials come from the environment only, never from this file:
  $env:SUPABASE_SERVICE_ROLE_KEY -- service_role / sb_secret_ key (Storage REST)
  $env:SUPABASE_ACCESS_TOKEN     -- personal access token (CLI), only for step 2

Usage:
  $env:SUPABASE_SERVICE_ROLE_KEY = "..."
  $env:SUPABASE_ACCESS_TOKEN     = "sbp_..."
  powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup-update-channel.ps1

Then publish a build: scripts/publish-update.ps1

NOTE: this file is deliberately ASCII-only and saved with a UTF-8 BOM. Windows
PowerShell 5.1 reads .ps1 files without a BOM as the local ANSI codepage, where
a UTF-8 em dash decodes to a smart quote -- which PowerShell treats as a string
delimiter, silently breaking the parse.
#>

$ErrorActionPreference = "Stop"

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$SupabaseUrl = "https://xhjxnyhvfyzyulzzxpsg.supabase.co"
$ProjectRef  = "xhjxnyhvfyzyulzzxpsg"
$Bucket      = "updates"

# Credentials: environment first, then a local file that is NOT in git (see
# .gitignore) so the keys never have to be pasted anywhere or committed. Same
# idea as sales-bot/token.txt for the sales bot token.
#   scripts/.secrets.env
#     SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
#     SUPABASE_ACCESS_TOKEN=sbp_...
$SecretsFile = Join-Path $PSScriptRoot ".secrets.env"
function Get-Secret([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value }
  if (Test-Path $SecretsFile) {
    foreach ($line in Get-Content $SecretsFile) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $parts = $line -split '=', 2
      if ($parts[0].Trim() -eq $Name) { return $parts[1].Trim() }
    }
  }
  return $null
}

$ServiceKey  = Get-Secret "SUPABASE_SERVICE_ROLE_KEY"
$AccessToken = Get-Secret "SUPABASE_ACCESS_TOKEN"

if (-not $ServiceKey) {
  throw "No SUPABASE_SERVICE_ROLE_KEY. Set it in the environment or in $SecretsFile (one KEY=VALUE per line)."
}

function Storage-Headers {
  return @{ apikey = $ServiceKey; Authorization = "Bearer $ServiceKey" }
}

# -- 1. Public bucket --------------------------------------------------------
Write-Host "[1/3] Storage bucket '$Bucket'"
$existing = $null
try {
  $existing = Invoke-RestMethod -Method Get -Uri "$SupabaseUrl/storage/v1/bucket/$Bucket" -Headers (Storage-Headers)
} catch {
  $existing = $null # 404: does not exist yet
}

if (-not $existing) {
  $body = @{ id = $Bucket; name = $Bucket; public = $true } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/storage/v1/bucket" `
    -ContentType "application/json" -Body $body -Headers (Storage-Headers) | Out-Null
  Write-Host "      created (public)"
  $existing = Invoke-RestMethod -Method Get -Uri "$SupabaseUrl/storage/v1/bucket/$Bucket" -Headers (Storage-Headers)
} else {
  Write-Host "      already exists"
}

if ($existing.public -eq $true) {
  Write-Host "      public: yes"
} else {
  Write-Host "      was PRIVATE - switching to public (the updater sends no auth headers)"
  Invoke-RestMethod -Method Put -Uri "$SupabaseUrl/storage/v1/bucket/$Bucket" `
    -ContentType "application/json" -Body (@{ public = $true } | ConvertTo-Json) `
    -Headers (Storage-Headers) | Out-Null
  Write-Host "      now public"
}

# -- 2. Deploy the Edge Function (JWT off) -----------------------------------
Write-Host "[2/3] Edge Function 'updates'"

if (-not $AccessToken) {
  Write-Warning "SUPABASE_ACCESS_TOKEN is not set - skipping the deploy. Run this once in a terminal that has it:"
  Write-Host    "      cd sales-bot; supabase functions deploy updates --project-ref $ProjectRef --no-verify-jwt"
} else {
  $env:SUPABASE_ACCESS_TOKEN = $AccessToken
  $cli = Get-Command supabase -ErrorAction SilentlyContinue
  Push-Location (Join-Path $RepoRoot "sales-bot")
  try {
    if ($cli) {
      & supabase functions deploy updates --project-ref $ProjectRef --no-verify-jwt
    } else {
      # Local npm fallback so no global CLI install is required.
      & npx --yes supabase@latest functions deploy updates --project-ref $ProjectRef --no-verify-jwt
    }
    if ($LASTEXITCODE -ne 0) { throw "Function deploy failed with exit code $LASTEXITCODE" }
    Write-Host "      deployed (verify_jwt = false, also pinned in sales-bot/supabase/config.toml)"
  } finally {
    Pop-Location
  }
}

# -- 3. Smoke test -----------------------------------------------------------
# Probe with an ancient version so a published build always looks "newer" and
# the endpoint answers 200 instead of 204.
Write-Host "[3/3] Smoke test"
$probeUrl = "$SupabaseUrl/functions/v1/updates?target=windows&arch=x86_64&version=0.0.1"
$status = $null
$body   = ""
try {
  $resp   = Invoke-WebRequest -Uri $probeUrl -UseBasicParsing
  $status = [int]$resp.StatusCode
  $body   = $resp.Content
} catch {
  if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode.value__ }
}

switch ($status) {
  200     { Write-Host "      HTTP 200 - an update is offered. The channel is live."
            Write-Host "      $body" }
  204     { Write-Host "      HTTP 204 - no update available (published version is not newer than the probe's 0.0.1)." }
  500     { Write-Host "      HTTP 500 - deployed, but the manifest is missing. Expected until the first publish-update.ps1 run." }
  401     { Write-Warning "HTTP 401 - JWT verification is still ON. Redeploy with --no-verify-jwt." }
  404     { Write-Warning "HTTP 404 - function not deployed yet (or wrong project ref)." }
  default { Write-Warning "Unexpected answer (status: $status)." }
}

Write-Host ""
Write-Host "Next: keep the version in src-tauri/tauri.conf.json current, then run scripts/publish-update.ps1"
