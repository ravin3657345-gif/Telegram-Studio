$ProjectRoot = Split-Path $PSScriptRoot -Parent
# Deliberately OUTSIDE the project directory: "D:\TElega POST" contains a
# space, which breaks windres/cc1 when it ends up in a build path (resource
# compilation fails with "No such file or directory" / "preprocessing
# failed" — see project memory "Build Path Fix"). Keep all build caches on a
# space-free path instead of a project-relative ".build" folder.
$BuildRoot = "D:\tstudio-build"

foreach ($dir in @(
    (Join-Path $BuildRoot "npm-cache"),
    (Join-Path $BuildRoot "tmp")
)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# Reuse D:/cargo-tgt — already warm with ~500 compiled dependency crates from
# this session's manual builds (keygen, sales-bot-launcher, cargo check),
# built with the same `--no-default-features` flag Tauri's own dev command
# uses. Pointing at a fresh directory here would force a from-scratch
# rebuild of every dependency for no benefit.
$env:CARGO_TARGET_DIR = "D:/cargo-tgt"
# CARGO_HOME deliberately left at its default (~/.cargo) — already has the
# full crates.io registry cache from this session's manual cargo commands,
# and its path has no space in it, so it was never actually the problem.
$env:TMP = Join-Path $BuildRoot "tmp"
$env:TEMP = $env:TMP
$env:NPM_CONFIG_CACHE = Join-Path $BuildRoot "npm-cache"
$env:npm_config_cache = $env:NPM_CONFIG_CACHE

Set-Location $ProjectRoot

Write-Host "Build paths on D:"
Write-Host "  CARGO_TARGET_DIR = $($env:CARGO_TARGET_DIR)"
Write-Host "  CARGO_HOME       = $($env:CARGO_HOME)"
Write-Host "  TEMP/TMP         = $($env:TEMP)"
Write-Host "  NPM cache        = $($env:NPM_CONFIG_CACHE)"
