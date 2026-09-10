# Re-applies the tracked Android customizations over the Tauri-generated
# project in src-tauri/gen/android/.
#
# `npx tauri android init` regenerates that gitignored directory from the
# vanilla template, which wipes MainActivity.kt and AndroidManifest.xml back
# to their un-customized stubs. Run this after every init (and any time you
# want to be sure the patches are in place):
#
#   npm run android:patch
#
# Idempotent — safe to run repeatedly. It copies:
#   src-tauri/android-custom/MainActivity.kt     -> .../com/telegram_studio/app/MainActivity.kt
#   src-tauri/android-custom/AndroidManifest.xml -> .../app/src/main/AndroidManifest.xml
#
# and then verifies each copy still contains its expected customization marker.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent

$sourceDir = Join-Path $ProjectRoot "src-tauri\android-custom"
$genRoot   = Join-Path $ProjectRoot "src-tauri\gen\android"

if (-not (Test-Path (Join-Path $genRoot "app\build.gradle.kts"))) {
    Write-Host ""
    Write-Host "Generated Android project not found at:" -ForegroundColor Red
    Write-Host "  $genRoot" -ForegroundColor Red
    Write-Host ""
    Write-Host "Run `npx tauri android init` first, then re-run:" -ForegroundColor Yellow
    Write-Host "  npm run android:patch" -ForegroundColor Yellow
    exit 1
}

$targets = @(
    @{
        Source = Join-Path $sourceDir "MainActivity.kt"
        Dest   = Join-Path $genRoot "app\src\main\java\com\telegram_studio\app\MainActivity.kt"
        Marker = "enableEdgeToEdge"
    },
    @{
        Source = Join-Path $sourceDir "AndroidManifest.xml"
        Dest   = Join-Path $genRoot "app\src\main\AndroidManifest.xml"
        Marker = 'windowSoftInputMode="adjustResize"'
    }
)

foreach ($t in $targets) {
    if (-not (Test-Path $t.Source)) {
        Write-Host "Missing tracked template: $($t.Source)" -ForegroundColor Red
        exit 1
    }

    Copy-Item -Path $t.Source -Destination $t.Dest -Force

    $content = Get-Content -Raw $t.Dest
    if (-not (Select-String -InputObject $content -Pattern $t.Marker -Quiet)) {
        Write-Host "Patched file failed verification (marker '$($t.Marker)' missing): $($t.Dest)" -ForegroundColor Red
        exit 1
    }

    Write-Host "Applied: $($t.Dest)"
}

Write-Host "Android customizations applied."
