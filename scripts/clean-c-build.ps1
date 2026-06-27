$ErrorActionPreference = "SilentlyContinue"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$removed = @()

function Remove-IfExists([string]$Path, [string]$Label) {
    if (-not (Test-Path $Path)) { return }
    Remove-Item $Path -Recurse -Force
    if (-not (Test-Path $Path)) {
        $script:removed += $Label
        Write-Host "Removed: $Label"
    }
}

# Cursor sandbox: cargo builds on C:
$sandboxRoot = Join-Path $env:LOCALAPPDATA "Temp\cursor-sandbox-cache"
if (Test-Path $sandboxRoot) {
    Get-ChildItem $sandboxRoot -Directory | ForEach-Object {
        Remove-IfExists (Join-Path $_.FullName "cargo-target") "cursor sandbox cargo-target ($($_.Name))"
    }
}

# Previous project target dir on D root
Remove-IfExists "D:\tauri-build" "old D:\tauri-build"

# Default cargo target inside repo (if config was ignored)
Remove-IfExists (Join-Path $ProjectRoot "src-tauri\target") "src-tauri\target"

# Vite cache in project node_modules/.vite stays on D — only clean temp on C
$userTemp = [Environment]::GetFolderPath("LocalApplicationData") + "\Temp"
Get-ChildItem $userTemp -Directory -Filter "vite-*" -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-IfExists $_.FullName "temp vite cache ($($_.Name))"
}

if ($removed.Count -eq 0) {
    Write-Host "No C: build artifacts found to remove."
} else {
    Write-Host "Cleaned $($removed.Count) location(s) from C: / old paths."
}
