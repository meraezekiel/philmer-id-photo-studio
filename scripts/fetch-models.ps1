<#
.SYNOPSIS
  Downloads the ONNX models and runtime this app needs, and verifies them.

.DESCRIPTION
  Model files are large and license-bound, so they are not committed. This
  script fills src-tauri/resources/ with everything the installer bundles.
  Run it once after cloning, and again whenever scripts/models.json changes.

  Downloads resume, so a dropped connection costs only the remaining bytes.
  Every file is checked against the SHA-256 pinned in scripts/models.json
  (the same values live in src-tauri/src/models.rs, which re-checks at runtime).

.PARAMETER HD
  Also fetch the optional 973 MB HD portrait model into
  %APPDATA%\art.philmerdigi.idphotostudio\models. Not needed to build or run.

.PARAMETER Force
  Re-download even if the file is already present and verifies.

.PARAMETER PrintHashes
  Print the SHA-256 of whatever is on disk and exit. Use this when you change a
  model URL and need new values for models.json and models.rs.

.EXAMPLE
  ./scripts/fetch-models.ps1
  ./scripts/fetch-models.ps1 -HD
#>
[CmdletBinding()]
param(
  [switch]$HD,
  [switch]$Force,
  [switch]$PrintHashes
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $PSScriptRoot 'models.json'
$resources = Join-Path $root 'src-tauri\resources'
$userModels = Join-Path $env:APPDATA 'art.philmerdigi.idphotostudio\models'
$staging = Join-Path ([System.IO.Path]::GetTempPath()) 'philmer-id-photo-models'

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "    $Message" -ForegroundColor DarkGray }

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLower()
}

function Test-File([string]$Path, [string]$Sha256, [long]$Bytes) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $actualSize = (Get-Item -LiteralPath $Path).Length
  if ($Bytes -gt 0 -and $actualSize -ne $Bytes) {
    Write-Note "size mismatch: expected $Bytes, found $actualSize"
    return $false
  }
  $actual = Get-Sha256 $Path
  if ($actual -ne $Sha256.ToLower()) {
    Write-Note "checksum mismatch: expected $Sha256, got $actual"
    return $false
  }
  return $true
}

# curl.exe ships with Windows 10 1803+ and handles resume (-C -) and redirects
# far better than Invoke-WebRequest, which buffers the whole body in memory.
function Invoke-Download([string]$Url, [string]$Destination) {
  $dir = Split-Path -Parent $Destination
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue)
  if ($null -eq $curl) { throw "curl.exe was not found. Windows 10 1803 or newer is required." }

  & $curl.Source --fail --location --retry 3 --retry-delay 2 --continue-at - `
    --progress-bar --output $Destination $Url
  if ($LASTEXITCODE -ne 0) {
    throw "download failed (curl exit $LASTEXITCODE): $Url"
  }
}

function Expand-Member([string]$Archive, [string]$Member, [string]$Destination) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq $Member }
    if ($null -eq $entry) {
      $entry = $zip.Entries | Where-Object { $_.Name -eq (Split-Path -Leaf $Member) } | Select-Object -First 1
    }
    if ($null -eq $entry) { throw "$Member was not found inside $Archive" }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $Destination, $true)
  } finally {
    $zip.Dispose()
  }
}

function Get-Model($Item, [string]$TargetDir) {
  $destination = Join-Path $TargetDir $Item.file

  if (-not $Force -and (Test-File $destination $Item.sha256 $Item.bytes)) {
    Write-Ok "$($Item.file) already present and verified"
    return
  }

  Write-Step "$($Item.label)"
  $hasMember = ($Item.PSObject.Properties.Name -contains 'archiveMember')

  if ($hasMember) {
    # Several files come out of one zip, so cache the archive between items.
    $archive = Join-Path $staging (Split-Path -Leaf ($Item.url -replace '\?.*$', ''))
    if (-not (Test-Path -LiteralPath $archive)) {
      Write-Note "downloading $($Item.url)"
      Invoke-Download $Item.url $archive
    } else {
      Write-Note "using cached $(Split-Path -Leaf $archive)"
    }
    if (-not (Test-Path -LiteralPath $TargetDir)) { New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null }
    Expand-Member $archive $Item.archiveMember $destination
  } else {
    Write-Note "downloading $($Item.url)"
    # Download to a .part file so an interrupted run never leaves a
    # truncated model looking like a good one.
    $partial = "$destination.part"
    Invoke-Download $Item.url $partial
    Move-Item -LiteralPath $partial -Destination $destination -Force
  }

  if (-not (Test-File $destination $Item.sha256 $Item.bytes)) {
    Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    throw "$($Item.file) failed verification and was removed. Re-run the script."
  }
  Write-Ok "$($Item.file) verified ($([math]::Round($Item.bytes / 1MB, 1)) MB, $($Item.license))"
}

if ($PrintHashes) {
  Write-Step 'SHA-256 of files currently on disk'
  foreach ($dir in @($resources, $userModels)) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    Get-ChildItem -LiteralPath $dir -File | ForEach-Object {
      '{0}  {1,12}  {2}' -f (Get-Sha256 $_.FullName), $_.Length, $_.Name
    }
  }
  return
}

New-Item -ItemType Directory -Force -Path $resources, $staging | Out-Null

Write-Step "Fetching into $resources"
foreach ($item in $manifest.bundled) { Get-Model $item $resources }

if ($HD) {
  Write-Host ''
  Write-Step "Fetching the optional HD model into $userModels"
  Write-Note 'This is 973 MB. The app works without it; it is the "best hair detail" option in Settings.'
  New-Item -ItemType Directory -Force -Path $userModels | Out-Null
  foreach ($item in $manifest.optional) { Get-Model $item $userModels }
} else {
  Write-Host ''
  Write-Note 'Skipping the optional HD model. Pass -HD to fetch it, or install it later from Settings > Models.'
}

# The zip is only needed to extract the dlls.
Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Ok 'All models present and verified.'
Write-Note "ONNX Runtime $($manifest.ortVersion) - matches the version the ort crate targets."
