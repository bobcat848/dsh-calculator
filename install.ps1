# dsh-cost-tracker installer for Windows (PowerShell).
# Copies the plugin into the DSH web profile and registers the loader row.
# Idempotent: safe to re-run; existing rows are not duplicated.
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }

$profilesRoot = Join-Path $dshHome 'profiles'
$destDir = Join-Path $profilesRoot 'node_modules\dsh-cost-tracker'
$patchFile = Join-Path $profilesRoot 'web\cordis.patch.yml'

Write-Host "Installing dsh-cost-tracker into $destDir"

# 1. Copy package files (hoisted node_modules root).
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Copy-Item -Path (Join-Path $scriptDir 'package.json') -Destination $destDir -Force
$libDir = Join-Path $destDir 'lib'
New-Item -ItemType Directory -Force -Path $libDir | Out-Null
Copy-Item -Path (Join-Path $scriptDir 'lib\client.js') -Destination $libDir -Force
Copy-Item -Path (Join-Path $scriptDir 'lib\index.js') -Destination $libDir -Force
Write-Host "  copied lib/ and package.json"

# 2. Append the loader row to cordis.patch.yml if not already present.
if (Test-Path $patchFile) {
    $content = Get-Content $patchFile -Raw
    if ($content -notmatch 'dsh-cost-tracker') {
        $row = @"

- insert:
    - id: dsh-cost-tracker
      name: 'dsh-cost-tracker'
      config: {}
"@
        Add-Content -Path $patchFile -Value $row -Encoding UTF8
        Write-Host "  added loader row to $patchFile"
    } else {
        Write-Host "  loader row already present, skipped"
    }
} else {
    Write-Host "WARNING: $patchFile not found — create it with:" -ForegroundColor Yellow
    Write-Host "  - insert:"
    Write-Host "      - id: dsh-cost-tracker"
    Write-Host "        name: 'dsh-cost-tracker'"
    Write-Host "        config: {}"
}

Write-Host "Done. Restart DSH web (e.g. 'dsh web --port 3080') and refresh http://127.0.0.1:3080"
