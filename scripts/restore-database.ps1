[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$ArchivePath,
  [switch]$Execute,
  [string]$Confirmation = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ProjectRef([Uri]$Uri) {
  if ($Uri.Host -match '^db\.([^.]+)\.supabase\.co$') { return $Matches[1] }
  $userName = ($Uri.UserInfo -split ':', 2)[0]
  if ($userName -match '^postgres\.([^.]+)$') { return $Matches[1] }
  return $null
}

$resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
& (Join-Path $PSScriptRoot 'verify-backup.ps1') -ArchivePath $resolvedArchive

$targetUrl = $env:ATTENDANCE_RESTORE_DB_URL
if ([string]::IsNullOrWhiteSpace($targetUrl)) {
  throw 'ATTENDANCE_RESTORE_DB_URL is not set. It must point to a new recovery project.'
}
try {
  $targetUri = [Uri]$targetUrl
} catch {
  throw 'ATTENDANCE_RESTORE_DB_URL is not a valid PostgreSQL connection URI.'
}
if ($targetUri.Scheme -notin @('postgres', 'postgresql')) {
  throw 'ATTENDANCE_RESTORE_DB_URL must use the postgres or postgresql scheme.'
}

$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "attendance-restore-$([Guid]::NewGuid().ToString('N'))"
[System.IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null

try {
  Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $temporaryDirectory
  $manifest = Get-Content -LiteralPath (Join-Path $temporaryDirectory 'backup-manifest.json') -Raw | ConvertFrom-Json
  $targetProjectRef = Get-ProjectRef $targetUri
  $targetIdentity = if ($targetProjectRef) { $targetProjectRef } else { "$($targetUri.Host)/$($targetUri.AbsolutePath.Trim('/'))" }

  $sameProject = if ($manifest.sourceProjectRef -and $targetProjectRef) {
    $manifest.sourceProjectRef -eq $targetProjectRef
  } else {
    $manifest.sourceHost -eq $targetUri.Host -and $manifest.sourceDatabase -eq $targetUri.AbsolutePath.Trim('/')
  }
  if ($sameProject) {
    throw 'Restore refused: the target appears to be the source project. Create a fresh recovery project and restore there.'
  }

  $requiredConfirmation = "RESTORE $targetIdentity"
  Write-Host "Archive: $resolvedArchive"
  Write-Host "Backup created (UTC): $($manifest.createdUtc)"
  Write-Host "Target: $targetIdentity"
  Write-Host 'Restore mode: logical restore into a new Supabase project; no existing objects are deleted.'

  if (-not $Execute) {
    Write-Host 'DRY RUN ONLY. No database connection was made and no data was changed.'
    Write-Host "To execute, add -Execute -Confirmation '$requiredConfirmation'"
    return
  }

  if ($Confirmation -cne $requiredConfirmation) {
    throw "Confirmation mismatch. Required exact value: $requiredConfirmation"
  }

  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) { throw 'PostgreSQL psql is required and must be available on PATH.' }

  $arguments = @(
    '--single-transaction',
    '--no-psqlrc',
    '--variable', 'ON_ERROR_STOP=1',
    '--file', (Join-Path $temporaryDirectory 'schema.sql'),
    '--command', 'SET session_replication_role = replica',
    '--file', (Join-Path $temporaryDirectory 'data.sql'),
    '--dbname', $targetUrl
  )

  Write-Host 'Starting transactional restore. The operation will roll back if any SQL command fails.'
  & $psql.Source @arguments
  if ($LASTEXITCODE -ne 0) { throw "psql restore failed (exit code $LASTEXITCODE)." }

  Write-Host 'Restore completed. Continue with the post-restore checklist in docs/DISASTER_RECOVERY.md.'
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
