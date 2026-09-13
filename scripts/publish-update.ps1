<#
Publishes a release to the in-app update channel.

  powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/publish-update.ps1
  # or, to re-upload an already-built version without rebuilding:
  powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/publish-update.ps1 -SkipBuild

What it does:
  1. builds signed installers (NSIS + MSI) with the updater signing key
  2. uploads the NSIS installer + its .sig to the public Supabase Storage
     bucket `updates`   (NSIS - not MSI - is what the updater installs, so an
     update needs no UAC prompt; see tauri.conf.json's
     plugins.updater.windows.installMode and bundle.windows.nsis.installMode)
  3. writes latest.json (version + notes from CHANGELOG.md + url + signature)
     into the same bucket - this is the manifest the `updates` Edge Function serves
  4. copies the NSIS installer into the sales-bot release folder so the bot hands
     buyers the same format the updater installs

Requirements:
  * $env:SUPABASE_SERVICE_ROLE_KEY - the service key (NOT the anon key: only
    service_role may write to Storage). Read from the environment only, never
    committed to the repo.
  * the update signing key at ~/.tauri/telegram-studio.key (the same one
    build-release.ps1 uses). Losing it means no already-installed app can ever
    update again.

Before running: bump `version` in src-tauri/tauri.conf.json - it is the single
source of truth the updater compares against (the package.json/Cargo.toml
versions are irrelevant to the update check). Keep it strictly 3-part semver.

NOTE: this file is deliberately ASCII-only, saved without a BOM (like the other
scripts here). Windows PowerShell 5.1 reads BOM-less .ps1 files as the local
ANSI codepage, where a UTF-8 em dash decodes to a smart quote - which PowerShell
treats as a string delimiter, silently breaking the parse. Anything non-ASCII
must be read as UTF-8 explicitly (see the CHANGELOG read below) or built from
code points (see $ReleaseDir).
#>

param(
  [switch]$SkipBuild,
  # Set tauri.conf.json to this version before building, e.g. -Version 1.9.3.
  # Must be 3-part semver (the updater's parser rejects 1.9.0.1 style).
  [string]$Version
)

$ErrorActionPreference = "Stop"

$RepoRoot    = Split-Path -Parent $PSScriptRoot
$SupabaseUrl = "https://xhjxnyhvfyzyulzzxpsg.supabase.co"
$Bucket      = "updates"
$TargetDir   = "D:/cargo-tgt"

# The sales-bot release folder (D:\ + the Cyrillic word for "release"), built
# this script can stay pure ASCII: R=U+0420, e=U+0435, l=U+043B, i=U+0438,
# z=U+0437. Override with TS_RELEASE_DIR if the folder ever moves.
$ReleaseDir = if ($env:TS_RELEASE_DIR) {
  $env:TS_RELEASE_DIR
} else {
  "D:\" + [string][char]0x0420 + [string][char]0x0435 + [string][char]0x043B +
  [string][char]0x0438 + [string][char]0x0437
}

# Credentials: environment first, then a local file that is NOT in git (see
# .gitignore) so the key never has to be pasted anywhere or committed. Same
# idea as sales-bot/token.txt for the sales bot token.
#   scripts/.secrets.env ->  SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
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

# Sets a process environment variable to an EMPTY string while keeping it
# present in the process. Measured on 2026-09-11 after a release got stuck:
#   $env:X = ""                                                -> variable deleted
#   [Environment]::SetEnvironmentVariable("X", "", "Process")  -> deleted too
# A child process sees neither, so tauri-cli asks for the signing password on
# the console, and a non-interactive build waits there forever (the installer
# was already built, which made it look like a hang rather than an error).
# Only the Win32 call with an empty string leaves the variable present but empty.
function Set-EmptyProcessEnv([string]$Name) {
  if (-not ("TStudio.EnvApi" -as [type])) {
    Add-Type -MemberDefinition '[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool SetEnvironmentVariable(string lpName, string lpValue);' -Name EnvApi -Namespace TStudio | Out-Null
  }
  [void][TStudio.EnvApi]::SetEnvironmentVariable($Name, '')
}

$ServiceKey      = Get-Secret "SUPABASE_SERVICE_ROLE_KEY"
$SigningPassword = Get-Secret "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
if (-not $ServiceKey) {
  throw "No SUPABASE_SERVICE_ROLE_KEY. Set it in the environment or in $SecretsFile (one KEY=VALUE per line)."
}

# -- 1. Version (tauri.conf.json is the one the updater compares) ------------
$confPath = Join-Path $RepoRoot "src-tauri/tauri.conf.json"

if ($Version) {
  if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "-Version '$Version' is not 3-part semver. The updater's parser rejects four-part versions like 1.9.0.1 - use 1.9.3 style."
  }
  # Target the top-level key only (anchored at line start), and refuse to touch
  # the file unless exactly one key matched - a JSON re-serialization would
  # reformat the whole config, and a blind replace could hit a nested "version".
  $raw     = [System.IO.File]::ReadAllText($confPath, [System.Text.Encoding]::UTF8)
  $updated = [regex]::Replace($raw, '(?m)^(\s*)"version"\s*:\s*"[^"]*"', ('$1"version": "' + $Version + '"'), 1)
  $hits    = ([regex]::Matches($raw, '(?m)^(\s*)"version"\s*:\s*"[^"]*"')).Count
  if ($hits -ne 1) { throw "Expected exactly one top-level 'version' key in tauri.conf.json, found $hits - bump it by hand." }
  [System.IO.File]::WriteAllText($confPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Bumped tauri.conf.json to $Version"
}

$conf    = [System.IO.File]::ReadAllText($confPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$Version = $conf.version
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Version '$Version' is not 3-part semver. The updater's parser rejects four-part versions like 1.9.0.1 - bump to 1.9.1 style before publishing."
}
Write-Host "Publishing Telegram Studio $Version"

# -- 2. Build signed artifacts ----------------------------------------------
$env:CARGO_TARGET_DIR = $TargetDir
if (-not $SkipBuild) {
  $keyPath = "$env:USERPROFILE\.tauri\telegram-studio.key"
  if (-not (Test-Path $keyPath)) {
    throw "Updater signing key not found at $keyPath - updates signed with a new key would be rejected by every installed app."
  }
  $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $keyPath -Raw).Trim()

  if ($SigningPassword) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $SigningPassword
  } else {
    # ~/.tauri/telegram-studio.key is stored with an EMPTY password: the header
    # says "rsign encrypted secret key", and `tauri signer sign -p ""` signs
    # with it happily. Removing the variable (what build-release.ps1 does, and
    # what this script used to do) makes tauri-cli PROMPT for a password at the
    # very end of the build instead - indistinguishable from a hang in a
    # non-interactive run.
    #
    # Both obviously-looking fixes are wrong, so the variable is set through
    # Win32: $env:X = "" deletes it, and .NET's SetEnvironmentVariable with an
    # empty string deletes it as well - a child process sees neither one.
    Set-EmptyProcessEnv "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
    Write-Host "      signing key password: none (key is stored with an empty password)"
  }

  Push-Location $RepoRoot
  try {
    npx tauri build --bundles "nsis,msi"
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

$nsisDir = Join-Path $TargetDir "release/bundle/nsis"
$msiDir  = Join-Path $TargetDir "release/bundle/msi"

# The updater needs the NSIS installer's signature. A missing .sig means the
# build was not signed (createUpdaterArtifacts / signing key env), and every
# client would reject the update - so stop rather than upload a broken release.
$setup = Get-ChildItem $nsisDir -Filter "*.exe" |
  Where-Object { $_.Name -like "*$Version*" } |
  Select-Object -First 1
if (-not $setup) { throw "NSIS installer for $Version not found in $nsisDir (build with --bundles nsis)" }

$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) {
  # Safety net: sign the installer here instead of failing the release, in case
  # the build skipped signing (createUpdaterArtifacts off, or a build run
  # without the key in the environment).
  #
  # The password is NOT passed as `--password ""`: PowerShell 5.1 drops a
  # standalone empty-string argument to a native exe, so tauri received no value
  # for --password and clap failed with a missing <FILE>. Measured 2026-09-11:
  # `--password ""` -> exit 2, `--password=` -> signs, and no flag at all with
  # the empty-but-present env var (Set-EmptyProcessEnv) -> signs. The env var is
  # also what the build itself uses, so one mechanism covers both paths.
  Write-Host "No signature from the build - signing the installer explicitly..."
  if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\telegram-studio.key" -Raw).Trim()
  }
  if ($SigningPassword) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $SigningPassword
  } else {
    Set-EmptyProcessEnv "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
  }
  Push-Location $RepoRoot
  try {
    npx tauri signer sign "$($setup.FullName)"
    if ($LASTEXITCODE -ne 0) { throw "tauri signer sign failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path $sigPath)) {
  throw "Missing $sigPath - the installer could not be signed, clients would reject this update as untrusted."
}
$signature = (Get-Content $sigPath -Raw).Trim()

# -- 3. Upload helper (Storage REST, service_role) ---------------------------
function Publish-Object {
  param([string]$LocalPath, [string]$ObjectName, [string]$ContentType)
  $uri   = "$SupabaseUrl/storage/v1/object/$Bucket/$ObjectName"
  $bytes = [System.IO.File]::ReadAllBytes($LocalPath)
  Invoke-RestMethod -Method Put -Uri $uri -ContentType $ContentType -Body $bytes -Headers @{
    apikey        = $ServiceKey
    Authorization = "Bearer $ServiceKey"
    "x-upsert"    = "true"
  } | Out-Null
  Write-Host "  uploaded $ObjectName ($([math]::Round($bytes.Length / 1MB, 1)) MB)"
}

# Spaces in the default bundle filename would need percent-encoding in the
# manifest URL; a storage-safe name avoids that class of bug entirely.
$installerName = "Telegram-Studio-$Version-x64-setup.exe"
$installerUrl  = "$SupabaseUrl/storage/v1/object/public/$Bucket/$installerName"

Write-Host "Uploading installer..."
Publish-Object -LocalPath $setup.FullName -ObjectName $installerName   -ContentType "application/octet-stream"
Publish-Object -LocalPath $sigPath        -ObjectName "$installerName.sig" -ContentType "text/plain"

# -- 4. Release notes from CHANGELOG.md (the section headed by this version) --
# Read as UTF-8 explicitly: Get-Content -Raw would decode the Cyrillic notes as
# ANSI under PowerShell 5.1 and put mojibake into the update dialog.
$notes = ""
$changelogPath = Join-Path $RepoRoot "CHANGELOG.md"
if (Test-Path $changelogPath) {
  $changelog = [System.IO.File]::ReadAllText($changelogPath, [System.Text.Encoding]::UTF8)
  $pattern   = "(?ms)^##\s+$([regex]::Escape($Version))[^\r\n]*\r?\n(.*?)(?=\r?\n---|\r?\n##\s|\z)"
  if ($changelog -match $pattern) { $notes = $matches[1].Trim() }
}
if (-not $notes) {
  Write-Warning "No CHANGELOG.md section found for $Version."
  Write-Warning "The update is already uploaded at this point, so the dialog would show no 'what's new' text."
  Write-Warning "Add the section, then re-run with -SkipBuild to refresh the manifest."
}

# -- 5. latest.json - the manifest the updater endpoint reads -----------------
# ONE manifest serves every platform, so it is read-modify-written rather than
# replaced. This script only owns the Windows half (scripts/publish-macos.mjs
# owns the darwin-* half, and macOS bundles can only be built on macOS), so
# overwriting the file would delete the other platform's entry - and the failure
# is silent: nothing here would error, that platform would just stop being
# offered updates. Both scripts therefore read the published manifest, replace
# only their own platform key and put it back.
function Get-PublishedManifest {
  # The authenticated object endpoint, not the public URL: the public one is
  # CDN-cached, and a stale read here is exactly what would drop the darwin half.
  $uri = "$SupabaseUrl/storage/v1/object/$Bucket/latest.json"
  try {
    return Invoke-RestMethod -Method Get -Uri $uri -Headers @{
      apikey          = $ServiceKey
      Authorization   = "Bearer $ServiceKey"
      "cache-control" = "no-cache"
    }
  } catch {
    # Storage answers 400 (not 404) for a missing object; either way it means
    # "nothing published yet", which is a normal first release rather than an error.
    Write-Host "  (no published latest.json yet - starting a fresh manifest)"
    return $null
  }
}

# Returns negative/zero/positive like a comparison operator.
function Compare-Semver([string]$Left, [string]$Right) {
  $a = @($Left.Split('.')  | ForEach-Object { [int]$_ })
  $b = @($Right.Split('.') | ForEach-Object { [int]$_ })
  for ($i = 0; $i -lt 3; $i++) {
    $x = if ($i -lt $a.Count) { $a[$i] } else { 0 }
    $y = if ($i -lt $b.Count) { $b[$i] } else { 0 }
    if ($x -ne $y) { return $x - $y }
  }
  return 0
}

$previousManifest = Get-PublishedManifest

# Each platform entry pins its OWN version and notes, because releases are not
# simultaneous: a Windows-only 1.9.6 must not tell a Mac "1.9.6 is available" -
# the Mac would install the older darwin archive and be offered 1.9.6 forever.
$platforms = [ordered]@{
  "windows-x86_64" = [ordered]@{
    version   = $Version
    url       = $installerUrl
    signature = $signature
    notes     = $notes
  }
}
if ($previousManifest -and $previousManifest.platforms) {
  foreach ($entry in $previousManifest.platforms.PSObject.Properties) {
    if ($entry.Name -eq "windows-x86_64") { continue }
    $platforms[$entry.Name] = $entry.Value
    Write-Host "  keeping $($entry.Name) from the published manifest"
  }
}

# The top-level version is a fallback for entries that pin their own, so it must
# never move backwards - a macOS 1.9.7 followed by a Windows 1.9.6 must not
# relabel the manifest as 1.9.6.
$previousVersion = if ($previousManifest) { [string]$previousManifest.version } else { "" }
$weAreNewest = (-not $previousVersion) -or ((Compare-Semver $Version $previousVersion) -ge 0)

$manifest = [ordered]@{
  version  = if ($weAreNewest) { $Version } else { $previousVersion }
  notes    = if ($weAreNewest) { $notes } else { $previousManifest.notes }
  pub_date = if ($weAreNewest) {
    (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  } else {
    $previousManifest.pub_date
  }
  platforms = $platforms
}

$tmpManifest = Join-Path $env:TEMP "ts-latest.json"
[System.IO.File]::WriteAllText($tmpManifest, ($manifest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Uploading manifest..."
Publish-Object -LocalPath $tmpManifest -ObjectName "latest.json" -ContentType "application/json"
Remove-Item $tmpManifest -ErrorAction SilentlyContinue

# -- 6. Keep the sales-bot distribution folder in step -----------------------
# The NSIS installer is what buyers get, not the MSI: the updater installs NSIS
# per-user (no UAC), and a per-machine MSI that later updates through NSIS leaves
# TWO copies on the machine (MSI -> NSIS is the supported direction, the reverse
# is not). The MSI stays in the bundle folder as an archive.
if (Test-Path $ReleaseDir) {
  Copy-Item $setup.FullName -Destination $ReleaseDir -Force
  Write-Host "Copied $($setup.Name) to the sales-bot release folder"
} else {
  Write-Warning "$ReleaseDir not found - copy $($setup.Name) manually for sales-bot (or set TS_RELEASE_DIR)."
}

Write-Host ""
Write-Host "Done. Telegram Studio $Version is offered to every installed copy on next launch."
Write-Host "Verify: $SupabaseUrl/functions/v1/updates?target=windows&arch=x86_64&version=0.0.1"
