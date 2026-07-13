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

# Singleton-лок для самого супервизора — без него два случайно запущенных
# run-forever.ps1 оба спамят node bot.mjs каждые 5с. bot.mjs сам по себе уже
# отказывается запускать второй getUpdates-поллинг (свой отдельный лок), так
# что Telegram-конфликта это и без этой проверки не вызовет — но лишний
# супервизор бесполезно жжёт CPU и засоряет список процессов, поэтому второй
# экземпляр просто сразу выходит, не трогая уже работающий.
$lockPath = Join-Path $PSScriptRoot "supervisor.lock"

function Test-ProcessAlive($targetPid) {
    try {
        $null = Get-Process -Id $targetPid -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

if (Test-Path $lockPath) {
    $prevPid = (Get-Content -Path $lockPath -Raw).Trim()
    if ($prevPid -and $prevPid -ne $PID -and (Test-ProcessAlive $prevPid)) {
        Write-Host "Supervisor уже запущен (PID $prevPid) — выхожу."
        exit 0
    }
}
Set-Content -Path $lockPath -Value $PID -NoNewline

try {
    while ($true) {
        Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Запуск бота..."
        node bot.mjs
        Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') Бот завершился (код выхода $LASTEXITCODE) — перезапуск через 5с."
        Start-Sleep -Seconds 5
    }
} finally {
    if ((Test-Path $lockPath) -and ((Get-Content -Path $lockPath -Raw).Trim() -eq "$PID")) {
        Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
    }
}
