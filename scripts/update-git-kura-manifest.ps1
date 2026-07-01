param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [string]$ManifestPath = "bucket/git-kura.json",

    [string]$Repository = "tooppoo/git-kura"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

function Normalize-Version([string]$RawVersion) {
    $trimmed = $RawVersion.Trim()

    if ($trimmed.StartsWith("v")) {
        $trimmed = $trimmed.Substring(1)
    }

    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        Fail "Version must not be empty."
    }

    if ($trimmed -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$') {
        Fail "Version must look like a git-kura release version, for example 0.1.3 or v0.1.3. Actual: '$RawVersion'"
    }

    return $trimmed
}

function Get-Checksum([string]$Checksums, [string]$FileName) {
    $escapedFileName = [regex]::Escape($FileName)
    $pattern = "(?m)^([a-fA-F0-9]{64})\s+\*?$escapedFileName$"
    $match = [regex]::Match($Checksums, $pattern)

    if (-not $match.Success) {
        Fail "Checksum for '$FileName' was not found in checksums.txt."
    }

    return $match.Groups[1].Value.ToLowerInvariant()
}

function Assert-Sha256([string]$Name, [string]$Value) {
    if ($Value -notmatch '^[a-f0-9]{64}$') {
        Fail "$Name must be a lowercase SHA-256 hex string. Actual: '$Value'"
    }
}

$manifestVersion = Normalize-Version $Version
$releaseTag = "v$manifestVersion"
$releaseBaseUrl = "https://github.com/$Repository/releases/download/$releaseTag"
$checksumsUrl = "$releaseBaseUrl/checksums.txt"

$x64AssetName = "git-kura_${releaseTag}_Windows_x86_64.zip"
$arm64AssetName = "git-kura_${releaseTag}_Windows_arm64.zip"
$x64Url = "$releaseBaseUrl/$x64AssetName"
$arm64Url = "$releaseBaseUrl/$arm64AssetName"

Write-Host "Fetching checksums from $checksumsUrl"
try {
    $checksums = (Invoke-WebRequest -Uri $checksumsUrl -UseBasicParsing).Content
}
catch {
    Fail "Failed to fetch checksums.txt from $checksumsUrl. $($_.Exception.Message)"
}

$x64Hash = Get-Checksum -Checksums $checksums -FileName $x64AssetName
$arm64Hash = Get-Checksum -Checksums $checksums -FileName $arm64AssetName

Assert-Sha256 -Name "x86_64 hash" -Value $x64Hash
Assert-Sha256 -Name "arm64 hash" -Value $arm64Hash

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    Fail "Manifest was not found: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

if ($null -eq $manifest.architecture) {
    Fail "Manifest is missing architecture."
}
if ($null -eq $manifest.architecture.'64bit') {
    Fail "Manifest is missing architecture.64bit."
}
if ($null -eq $manifest.architecture.arm64) {
    Fail "Manifest is missing architecture.arm64."
}

$manifest.version = $manifestVersion
$manifest.architecture.'64bit'.url = $x64Url
$manifest.architecture.'64bit'.hash = $x64Hash
$manifest.architecture.arm64.url = $arm64Url
$manifest.architecture.arm64.hash = $arm64Hash

$manifestJson = $manifest | ConvertTo-Json -Depth 20
Set-Content -LiteralPath $ManifestPath -Value $manifestJson -Encoding utf8

$updatedManifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

if ($updatedManifest.version -ne $manifestVersion) {
    Fail "Updated manifest version does not match expected version."
}
if ($updatedManifest.architecture.'64bit'.url -ne $x64Url) {
    Fail "Updated x86_64 URL does not match expected URL."
}
if ($updatedManifest.architecture.arm64.url -ne $arm64Url) {
    Fail "Updated arm64 URL does not match expected URL."
}
Assert-Sha256 -Name "updated x86_64 hash" -Value $updatedManifest.architecture.'64bit'.hash
Assert-Sha256 -Name "updated arm64 hash" -Value $updatedManifest.architecture.arm64.hash

if ($env:GITHUB_OUTPUT) {
    "manifest_version=$manifestVersion" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
    "release_tag=$releaseTag" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
}

Write-Host "Updated $ManifestPath to git-kura $manifestVersion"
Write-Host "x86_64: $x64Hash"
Write-Host "arm64 : $arm64Hash"
