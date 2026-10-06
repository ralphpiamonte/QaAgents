$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env file not found at $envPath"
}

$lines = Get-Content -LiteralPath $envPath
$synced = New-Object System.Collections.Generic.List[string]

foreach ($line in $lines) {
  $trimmed = $line.Trim()
  if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
    continue
  }

  $sepIndex = $line.IndexOf("=")
  if ($sepIndex -lt 1) {
    continue
  }

  $key = $line.Substring(0, $sepIndex).Trim()
  $value = $line.Substring($sepIndex + 1)

  if (-not ($key -match "^[A-Za-z_][A-Za-z0-9_]*$")) {
    Write-Warning "Skipping invalid environment variable key: $key"
    continue
  }

  [Environment]::SetEnvironmentVariable($key, $value, "User")
  $synced.Add($key)
}

if ($synced.Count -eq 0) {
  Write-Host "No .env values found to sync."
  exit 0
}

Write-Host "Synced $($synced.Count) variable(s) to Windows user environment: $($synced -join ', ')"
