$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$goExe = Join-Path $repoRoot ".tools\go1.26.5\go\bin\go.exe"
if (-not (Test-Path -LiteralPath $goExe)) {
    throw "Portable Go not found at $goExe"
}

$outputDir = Join-Path $repoRoot "bin"
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$env:GOCACHE = Join-Path $repoRoot ".tools\gocache"
$env:GOPATH = Join-Path $repoRoot ".tools\gopath"
$env:CGO_ENABLED = "0"
$env:GOOS = "android"
$env:GOARCH = "arm64"
$env:GOFLAGS = "-buildvcs=false -trimpath"

& $goExe build -ldflags="-s -w -buildid=" -o (Join-Path $outputDir "hipzip-arm64") (Join-Path $PSScriptRoot "hipzip")
if ($LASTEXITCODE -ne 0) {
    throw "hipzip Android build failed"
}

Write-Output "Built bin/hipzip-arm64"
