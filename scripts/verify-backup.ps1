[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$ArchivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
if ([System.IO.Path]::GetExtension($resolvedArchive) -ne '.zip') {
  throw 'Backup archive must be a .zip file created by backup-database.ps1.'
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "attendance-verify-$([Guid]::NewGuid().ToString('N'))"
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null

try {
  Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $temporaryDirectory
  $manifestPath = Join-Path $temporaryDirectory 'backup-manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'backup-manifest.json is missing.' }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.formatVersion -ne 2) { throw "Unsupported backup format version: $($manifest.formatVersion)" }

  $allowedFiles = @('schema.sql', 'data.sql')
  foreach ($entry in $manifest.files) {
    if ($entry.name -notin $allowedFiles) { throw "Unexpected file in manifest: $($entry.name)" }
    $filePath = Join-Path $temporaryDirectory $entry.name
    if (-not (Test-Path -LiteralPath $filePath)) { throw "Backup file is missing: $($entry.name)" }
    $item = Get-Item -LiteralPath $filePath
    if ($item.Length -ne $entry.bytes) { throw "Size check failed for $($entry.name)." }
    $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $entry.sha256) { throw "SHA-256 check failed for $($entry.name)." }
  }

  foreach ($requiredFile in $allowedFiles) {
    if (-not ($manifest.files.name -contains $requiredFile)) { throw "Manifest entry is missing: $requiredFile" }
  }

  Write-Host "Backup verified: $resolvedArchive"
  Write-Host "Created (UTC): $($manifest.createdUtc)"
  Write-Host "Source: $($manifest.sourceHost)/$($manifest.sourceDatabase)"
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
