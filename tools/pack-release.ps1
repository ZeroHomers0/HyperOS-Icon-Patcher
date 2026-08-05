[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [switch]$RebuildHelper
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot "output"
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot $OutputDirectory
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$modulePropPath = Join-Path $repoRoot "module.prop"
$versionLine = Get-Content -LiteralPath $modulePropPath -Encoding UTF8 |
    Where-Object { $_ -match '^version=(.+)$' } |
    Select-Object -First 1
if (-not $versionLine) {
    throw "module.prop does not contain a version entry"
}
$version = ($versionLine -replace '^version=', '').Trim()
if ($version -notmatch '^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$') {
    throw "Unsafe module version: $version"
}

if ($RebuildHelper) {
    & (Join-Path $PSScriptRoot "build-hipzip.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "ARM64 helper build failed"
    }
}

$archiveName = "HyperOS-Icon-Patcher-v$version.zip"
$outputPath = Join-Path $OutputDirectory $archiveName
$tempPath = Join-Path $OutputDirectory ".$archiveName.$PID.tmp"

$roots = @(
    "module.prop",
    "customize.sh",
    "uninstall.sh",
    "README.md",
    "CHANGELOG.md",
    "THIRD_PARTY_NOTICES.md",
    "update.json",
    "bin",
    "scripts",
    "webroot"
)

$files = [System.Collections.Generic.List[string]]::new()
foreach ($root in $roots) {
    $source = Join-Path $repoRoot $root
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required module path is missing: $root"
    }
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        $files.Add($root)
        continue
    }
    Get-ChildItem -LiteralPath $source -File -Recurse |
        ForEach-Object {
            # Windows PowerShell 5.1 does not provide Path.GetRelativePath.
            $relative = $_.FullName.Substring($repoRoot.Length).TrimStart([char[]]@('\', '/'))
            $files.Add($relative)
        }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

try {
    if (Test-Path -LiteralPath $tempPath) {
        Remove-Item -LiteralPath $tempPath -Force
    }
    $stream = [System.IO.File]::Open(
        $tempPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )
    try {
        $archive = [System.IO.Compression.ZipArchive]::new(
            $stream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $true
        )
        try {
            foreach ($relative in ($files | Sort-Object)) {
                $entryName = $relative.Replace('\', '/')
                if ($entryName.StartsWith('/') -or $entryName.Contains('../')) {
                    throw "Unsafe archive entry: $entryName"
                }
                $source = Join-Path $repoRoot $relative
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $archive,
                    $source,
                    $entryName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                ) | Out-Null
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }

    $verify = [System.IO.Compression.ZipFile]::OpenRead($tempPath)
    try {
        $entryNames = @($verify.Entries | ForEach-Object FullName)
        $required = @(
            "module.prop",
            "customize.sh",
            "uninstall.sh",
            "bin/hipzip-arm64",
            "scripts/backend.sh",
            "webroot/index.html"
        )
        $missing = @($required | Where-Object { $_ -notin $entryNames })
        if ($missing.Count -gt 0) {
            throw "Package verification failed; missing: $($missing -join ', ')"
        }
        if ($entryNames | Where-Object { $_ -match '^HyperOS-Icon-Patcher[^/]*/' }) {
            throw "Package contains an unexpected top-level wrapper directory"
        }
    }
    finally {
        $verify.Dispose()
    }

    if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath -Force
    }
    Move-Item -LiteralPath $tempPath -Destination $outputPath

    $package = Get-Item -LiteralPath $outputPath
    $hash = Get-FileHash -LiteralPath $outputPath -Algorithm SHA256
    Write-Host ""
    Write-Host "Package: $($package.FullName)"
    Write-Host "Version: $version"
    Write-Host "Size:    $($package.Length) bytes"
    Write-Host "SHA256:  $($hash.Hash)"
}
catch {
    if (Test-Path -LiteralPath $tempPath) {
        Remove-Item -LiteralPath $tempPath -Force
    }
    throw
}
