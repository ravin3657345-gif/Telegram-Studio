. "$PSScriptRoot\dev-env.ps1"
. "$PSScriptRoot\clean-c-build.ps1"

Write-Host ""
Write-Host "Starting Telegram Studio (Tauri dev)..."
npm run tauri dev
