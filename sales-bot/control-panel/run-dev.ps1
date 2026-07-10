# Запуск панели управления продающим ботом в dev-режиме (Tauri).
# Отдельная target-директория (D:/cargo-tgt-panel), чтобы не конфликтовать
# с параллельной dev-сборкой основного приложения Telegram Studio.

Set-Location $PSScriptRoot
$env:CARGO_TARGET_DIR = "D:/cargo-tgt-panel"
npx tauri dev
