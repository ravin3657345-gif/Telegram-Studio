# Build release MSI with updater signing
$env:CARGO_TARGET_DIR = "D:/cargo-tgt"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\telegram-studio.key" -Raw).Trim()
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
npx tauri build --bundles msi
