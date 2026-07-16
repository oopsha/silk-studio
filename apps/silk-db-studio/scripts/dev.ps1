# Load the app .env.local and start Silk DB Studio (Tauri + Vite).
# Usage (from apps/silk-db-studio):
#   .\scripts\dev.ps1
# Usage (from the monorepo root):
#   pnpm --filter @silk-studio/db-studio tauri:dev

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envFile = Join-Path $root ".env.local"
if (-not (Test-Path $envFile)) {
  Write-Error @"
Missing .env.local

Copy the template and fill in DB credentials:
  Copy-Item .env.example .env.local
"@
}

$loaded = 0
Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { return }

  $eq = $line.IndexOf("=")
  if ($eq -lt 1) {
    Write-Warning "Skipping invalid env line: $line"
    return
  }

  $key = $line.Substring(0, $eq).Trim()
  $value = $line.Substring($eq + 1).Trim()

  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  Set-Item -Path "Env:$key" -Value $value
  $loaded++
}

Write-Host "Loaded $loaded variable(s) from .env.local"
pnpm tauri dev
