# Build a signed release.
#
# NSIS is what the in-app updater installs: bundle.windows.nsis.installMode is
# "currentUser", so an update needs no UAC prompt, unlike the per-machine MSI.
# The MSI is still built because sales-bot hands buyers a .msi and WiX produces
# a versioned product code for it; see scripts/publish-update.ps1, which uploads
# the NSIS installer to the update channel and copies it to the sales folder
# (ASCII only here on purpose: PowerShell 5.1 reads a BOM-less .ps1 as ANSI, and
# non-ASCII bytes in this file have already turned into smart quotes once).
$env:CARGO_TARGET_DIR = "D:/cargo-tgt"
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.tauri\telegram-studio.key" -Raw).Trim()
# The key is stored with an EMPTY password (`tauri signer sign -p ""` signs with
# it). Removing the variable used to look harmless, but tauri-cli then PROMPTS
# for a password at the end of the build - in a non-interactive run that prompt
# hangs until the process is killed (that is exactly how the 1.9.3 release got
# stuck). The variable must be PRESENT and empty, and neither PowerShell's
# `$env:X = ""` nor .NET's SetEnvironmentVariable(..., "", "Process") does that -
# both delete it, which a child process can see. Only the Win32 call with an
# empty string leaves it present-but-empty.
function Set-EmptyProcessEnv([string]$Name) {
  if (-not ("TStudio.EnvApi" -as [type])) {
    Add-Type -MemberDefinition '[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool SetEnvironmentVariable(string lpName, string lpValue);' -Name EnvApi -Namespace TStudio | Out-Null
  }
  [void][TStudio.EnvApi]::SetEnvironmentVariable($Name, '')
}
Set-EmptyProcessEnv "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
npx tauri build --bundles "nsis,msi"
