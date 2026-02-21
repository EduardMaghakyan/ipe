$ErrorActionPreference = "Stop"

$IpeDir = "$env:USERPROFILE\.ipe"
$ClaudeSettings = "$env:USERPROFILE\.claude\settings.json"
$Repo = "eduardmaghakyan/ipe"
$Binary = "ipe-windows-x64.exe"

# Determine download URL
if ($env:IPE_VERSION) {
    $DownloadUrl = "https://github.com/$Repo/releases/download/$env:IPE_VERSION/$Binary"
} else {
    $DownloadUrl = "https://github.com/$Repo/releases/latest/download/$Binary"
}

# Download binary
Write-Host "==> Downloading IPE ($Binary)..." -ForegroundColor Green
New-Item -ItemType Directory -Force -Path $IpeDir | Out-Null
Invoke-WebRequest -Uri $DownloadUrl -OutFile "$IpeDir\ipe.exe" -UseBasicParsing

# Register Claude Code hook
Write-Host "==> Configuring Claude Code hook..." -ForegroundColor Green
$ClaudeDir = Split-Path $ClaudeSettings
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null

$HookCmd = "$IpeDir\ipe.exe"

$settings = @{}
if (Test-Path $ClaudeSettings) {
    try {
        $settings = Get-Content $ClaudeSettings -Raw | ConvertFrom-Json -AsHashtable
    } catch {}
}

if (-not $settings.ContainsKey("hooks")) { $settings["hooks"] = @{} }
if (-not $settings["hooks"].ContainsKey("PermissionRequest")) { $settings["hooks"]["PermissionRequest"] = @() }

# Remove any existing IPE hook to avoid duplicates
$settings["hooks"]["PermissionRequest"] = @(
    $settings["hooks"]["PermissionRequest"] | Where-Object {
        -not ($_.matcher -eq "ExitPlanMode" -and ($_.hooks | Where-Object { $_.command -like "*.ipe*" }))
    }
)

$settings["hooks"]["PermissionRequest"] += @{
    matcher = "ExitPlanMode"
    hooks = @(
        @{
            type = "command"
            command = $HookCmd
            timeout = 345600
        }
    )
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $ClaudeSettings -Encoding UTF8

Write-Host "==> Done! IPE is installed and configured." -ForegroundColor Green
Write-Host ""
Write-Host "  Verify with: claude and run /hooks"
Write-Host "  Uninstall:   Remove-Item -Recurse -Force ~\.ipe"
Write-Host "               (then remove the ExitPlanMode hook from ~\.claude\settings.json)"
