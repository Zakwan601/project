[CmdletBinding()]
param(
  [string]$OutputDirectory = '',
  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 30,
  [switch]$PruneExpired
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\backups'
}

function Get-ProjectRef([Uri]$Uri) {
  if ($Uri.Host -match '^db\.([^.]+)\.supabase\.co$') { return $Matches[1] }
  $userName = ($Uri.UserInfo -split ':', 2)[0]
  if ($userName -match '^postgres\.([^.]+)$') { return $Matches[1] }
  return $null
}

function Invoke-Dump([string[]]$Arguments, [string]$Description) {
  Write-Host $Description
  & $script:PgDumpCommand @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed while $Description (exit code $LASTEXITCODE)."
  }
}

$dbUrl = $env:ATTENDANCE_BACKUP_DB_URL
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
  throw 'ATTENDANCE_BACKUP_DB_URL is not set. See backup.env.example.'
}

try {
  $sourceUri = [Uri]$dbUrl
} catch {
  throw 'ATTENDANCE_BACKUP_DB_URL is not a valid PostgreSQL connection URI.'
}
if ($sourceUri.Scheme -notin @('postgres', 'postgresql')) {
  throw 'ATTENDANCE_BACKUP_DB_URL must use the postgres or postgresql scheme.'
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  throw 'PostgreSQL pg_dump is required. Install PostgreSQL 17 command-line tools and add their bin directory to PATH.'
}
$script:PgDumpCommand = $pgDump.Source
$pgDumpVersion = (& $script:PgDumpCommand --version) -join ' '
if ($LASTEXITCODE -ne 0) { throw 'Unable to determine the pg_dump version.' }
if ($pgDumpVersion -notmatch '(\d+)(?:\.\d+)?$' -or [int]$Matches[1] -lt 17) {
  throw "pg_dump 17 or newer is required for the PostgreSQL 17 database. Found: $pgDumpVersion"
}

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputRoot) | Out-Null

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$stagingDirectory = Join-Path $outputRoot ".attendance-$timestamp.incomplete-$PID"
$archivePath = Join-Path $outputRoot "attendance-$timestamp.zip"

if ((Test-Path -LiteralPath $stagingDirectory) -or (Test-Path -LiteralPath $archivePath)) {
  throw "Backup target already exists for timestamp $timestamp."
}
[System.IO.Directory]::CreateDirectory($stagingDirectory) | Out-Null

try {
  $schemaPath = Join-Path $stagingDirectory 'schema.sql'
  $dataPath = Join-Path $stagingDirectory 'data.sql'

  Invoke-Dump -Arguments @(
    '--dbname', $dbUrl,
    '--file', $schemaPath,
    '--schema', 'public',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--quote-all-identifiers'
  ) -Description 'exporting public application schema'
  Invoke-Dump -Arguments @(
    '--dbname', $dbUrl,
    '--file', $dataPath,
    '--schema', 'public',
    '--data-only',
    '--no-owner',
    '--no-privileges',
    '--quote-all-identifiers'
  ) -Description 'exporting public application data'

  $requiredFiles = @($schemaPath, $dataPath)
  foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -eq 0) {
      throw "Backup output is missing or empty: $file"
    }
  }

  $fileManifest = foreach ($file in $requiredFiles) {
    $item = Get-Item -LiteralPath $file
    [ordered]@{
      name = $item.Name
      bytes = $item.Length
      sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }

  $manifest = [ordered]@{
    formatVersion = 2
    createdUtc = (Get-Date).ToUniversalTime().ToString('o')
    sourceHost = $sourceUri.Host
    sourceDatabase = $sourceUri.AbsolutePath.Trim('/')
    sourceProjectRef = Get-ProjectRef $sourceUri
    scope = 'Custom pg_dump export of the public application schema and data; Auth users, Storage objects, database roles, and platform configuration are not included.'
    tool = $pgDumpVersion
    files = $fileManifest
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stagingDirectory 'backup-manifest.json') -Encoding UTF8

  Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $archivePath -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $archivePath) -or (Get-Item -LiteralPath $archivePath).Length -eq 0) {
    throw 'The backup archive was not created successfully.'
  }

  & (Join-Path $PSScriptRoot 'verify-backup.ps1') -ArchivePath $archivePath

  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force

  if ($PruneExpired) {
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-$RetentionDays)
    Get-ChildItem -LiteralPath $outputRoot -File -Filter 'attendance-*.zip' |
      Where-Object { $_.LastWriteTimeUtc -lt $cutoff -and $_.FullName -ne $archivePath } |
      ForEach-Object {
        Write-Host "Removing expired backup: $($_.Name)"
        Remove-Item -LiteralPath $_.FullName -Force
      }
  }

  Write-Host "Backup completed and verified: $archivePath"
  Write-Host 'Copy this archive to encrypted off-site storage before considering the run complete.'
} catch {
  Write-Error $_
  Write-Warning "Incomplete working files were retained for diagnosis: $stagingDirectory"
  exit 1
}
