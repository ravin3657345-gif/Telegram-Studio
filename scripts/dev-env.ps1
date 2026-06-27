$ProjectRoot = Split-Path $PSScriptRoot -Parent
$BuildRoot = Join-Path $ProjectRoot ".build"

foreach ($dir in @(
    (Join-Path $BuildRoot "cargo-target"),
    (Join-Path $BuildRoot "cargo-home"),
    (Join-Path $BuildRoot "npm-cache"),
    (Join-Path $BuildRoot "tmp")
)) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$env:CARGO_TARGET_DIR = Join-Path $BuildRoot "cargo-target"
$env:CARGO_HOME = Join-Path $BuildRoot "cargo-home"
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
