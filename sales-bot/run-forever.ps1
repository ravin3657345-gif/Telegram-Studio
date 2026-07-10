# Держит sales-bot/bot.mjs запущенным постоянно: если процесс завершится
# по любой причине (падение, случайное закрытие окна, перезагрузка Windows),
# перезапускает его через несколько секунд. Токен читается из token.txt
# рядом с этим скриптом — вручную задавать $env:SALES_BOT_TOKEN не нужно.
#
# Запуск: powershell -File sales-bot/run-forever.ps1
# Остановка: Ctrl+C в этом окне.

Set-Location $PSScriptRoot

$tokenPath = Join-Path $PSScriptRoot "token.txt"
if (-not (Test-Path $tokenPath)) {
    Write-Host "Не найден $tokenPath — создайте файл с токеном от @BotFather (одна строка)."
    exit 1
}
$env:SALES_BOT_TOKEN = (Get-Content -Path $tokenPath -Raw).Trim()

while ($true) {
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Запуск бота..."
    node bot.mjs
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Бот завершился (код выхода $LASTEXITCODE) — перезапуск через 5с."
    Start-Sleep -Seconds 5
}
