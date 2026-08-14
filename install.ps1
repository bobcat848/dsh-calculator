# dsh-cost-tracker installer for Windows (PowerShell).
# Two modes:
#   1. Local clone:  .\install.ps1
#      (copies the package from this checked-out repo)
#   2. One-liner:    irm https://raw.githubusercontent.com/bobcat848/dsh-calculator/main/install.ps1 | iex
#      (downloads the package straight from GitHub, no clone needed)
# Idempotent: safe to re-run; existing rows are not duplicated.
$ErrorActionPreference = 'Stop'

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }

$profilesRoot = Join-Path $dshHome 'profiles'
$destDir = Join-Path $profilesRoot 'node_modules\dsh-cost-tracker'
$patchFile = Join-Path $profilesRoot 'web\cordis.patch.yml'

Write-Host "Installing dsh-cost-tracker into $destDir"

# 1. Obtain the package files.
#    Local mode: the script is running from a cloned checkout, so copy the
#    files next to it. Remote mode (irm ... | iex): $MyInvocation.MyCommand.Path
#    is empty, so fetch the three files from GitHub instead.
$libDir = Join-Path $destDir 'lib'
New-Item -ItemType Directory -Force -Path $libDir | Out-Null

$localScript = $MyInvocation.MyCommand.Path
if ($localScript -and (Test-Path (Join-Path (Split-Path $localScript) 'package.json'))) {
    $src = Split-Path $localScript
    Copy-Item (Join-Path $src 'package.json') $destDir -Force
    Copy-Item (Join-Path $src 'lib\client.js') $libDir -Force
    Copy-Item (Join-Path $src 'lib\index.js') $libDir -Force
    Write-Host "  copied package.json + lib/ (local: $src)"
} else {
    $base = 'https://raw.githubusercontent.com/bobcat848/dsh-calculator/main'
    Write-Host "  downloading from $base ..."
    Invoke-WebRequest -UseBasicParsing "$base/package.json" -OutFile (Join-Path $destDir 'package.json')
    Invoke-WebRequest -UseBasicParsing "$base/lib/client.js" -OutFile (Join-Path $libDir 'client.js')
    Invoke-WebRequest -UseBasicParsing "$base/lib/index.js" -OutFile (Join-Path $libDir 'index.js')
    Write-Host "  downloaded package.json + lib/ (GitHub)"
}

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
