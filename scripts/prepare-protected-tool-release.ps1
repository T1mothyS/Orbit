[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]+(?:-[a-z0-9]+)*$')]
  [string]$Slug,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Title,

  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Summary,

  [ValidateSet('inline', 'plotly-alipay')]
  [string]$CspProfile = 'inline',

  [string]$ToolsRoot,
  [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $ToolsRoot) { $ToolsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\protected-tools')) }
if (-not $OutputRoot) { $OutputRoot = Join-Path ([IO.Path]::GetTempPath()) 'aicalendar-tool-releases' }

$source = Get-Item -LiteralPath $InputPath
if (-not $source.PSIsContainer -and $source.Extension.ToLowerInvariant() -ne '.html') { throw 'InputPath 必须指向 .html 文件或含 index.html 的工具目录。' }
$sourcePath = if ($source.PSIsContainer) { Join-Path $source.FullName 'index.html' } else { $source.FullName }
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw '工具目录缺少 index.html。' }
if ((Get-Item -LiteralPath $sourcePath).Length -gt 10MB) { throw '单个工具 HTML 不能超过 10 MB。' }
if ($Slug.Length -gt 80) { throw 'Slug 不能超过 80 个字符。' }

function Get-ToolFiles([string]$Root) {
  $rootItem = Get-Item -LiteralPath $Root
  if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '工具目录不能是链接。' }
  $entries = @(Get-ChildItem -LiteralPath $Root -Recurse -Force)
  foreach ($entry in $entries) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $entry.Name.StartsWith('.')) { throw '工具目录不能包含链接或隐藏文件。' }
  }
  @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    [pscustomobject]@{ Relative = [IO.Path]::GetRelativePath($Root, $_.FullName).Replace('\', '/'); Path = $_.FullName; Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  } | Sort-Object Relative)
}

$manifestPath = Join-Path ([IO.Path]::GetFullPath($ToolsRoot)) 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "找不到工具清单: $manifestPath" }
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
if ($null -eq $manifest.tools) { throw '工具清单缺少 tools 数组。' }

# Fast uploads are an exception; the source tree remains authoritative.
$sourceEntry = @($manifest.tools | Where-Object { $_.slug -eq $Slug })
$trackedHtml = Join-Path $ToolsRoot "$Slug/index.html"
if ($sourceEntry.Count -ne 1 -or -not (Test-Path -LiteralPath $trackedHtml -PathType Leaf)) {
  throw '请先将工具 HTML 和清单纳入源码，再准备例外快传。'
}
if ((Get-FileHash -LiteralPath $trackedHtml).Hash -ne (Get-FileHash -LiteralPath $sourcePath).Hash -or
    $sourceEntry[0].title -ne $Title.Trim() -or $sourceEntry[0].summary -ne $Summary.Trim() -or
    $sourceEntry[0].cspProfile -ne $CspProfile -or $sourceEntry[0].enabled -eq $false) {
  throw '快传输入必须与源码 HTML 和清单完全一致。'
}
$trackedFiles = @(Get-ToolFiles (Join-Path $ToolsRoot $Slug))
if ($source.PSIsContainer) {
  $inputFiles = @(Get-ToolFiles $source.FullName)
  if ($inputFiles.Count -ne $trackedFiles.Count) { throw '输入目录与源码文件清单不一致。' }
  for ($index = 0; $index -lt $trackedFiles.Count; $index++) {
    if ($inputFiles[$index].Relative -ne $trackedFiles[$index].Relative -or $inputFiles[$index].Hash -ne $trackedFiles[$index].Hash) { throw '输入目录与源码资源不一致。' }
  }
} elseif ($trackedFiles.Count -ne 1 -or $trackedFiles[0].Relative -ne 'index.html') { throw '工具含附属资源，请将 InputPath 指向完整工具目录。' }
$releaseId = "tool-$((Get-Date).ToUniversalTime().ToString('yyMMdd.HHmmss'))-$Slug"
$releaseDirectory = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $releaseId
if (Test-Path -LiteralPath $releaseDirectory) { throw "发布目录已存在，请稍后重试: $releaseDirectory" }
$stageRoot = Join-Path $releaseDirectory 'protected-tools'
$stageToolRoot = Join-Path $stageRoot $Slug
New-Item -ItemType Directory -Path $stageToolRoot -Force | Out-Null

$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllBytes((Join-Path $stageRoot 'manifest.json'), [IO.File]::ReadAllBytes($manifestPath))
$fileHashes = [ordered]@{ 'protected-tools/manifest.json' = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() }
foreach ($file in $trackedFiles) {
  $target = Join-Path $stageToolRoot $file.Relative
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
  [IO.File]::WriteAllBytes($target, [IO.File]::ReadAllBytes($file.Path))
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.Hash) { throw '准备发布包时源码发生变化。' }
  $fileHashes["protected-tools/$Slug/$($file.Relative)"] = $file.Hash
}

$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestHash = (Get-FileHash -LiteralPath (Join-Path $stageRoot 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$record = [ordered]@{
  releaseId = $releaseId
  slug = $Slug
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceSha256 = $sourceHash
  manifestSha256 = $manifestHash
  files = @($fileHashes.Keys)
  fileHashes = $fileHashes
  uploadMode = 'protected-tools fast path'
  note = '仅包含受审阅的完整静态工具目录和清单；服务器端仍需按逐文件哈希、备份、原子替换和回滚流程发布。'
}
[IO.File]::WriteAllText((Join-Path $releaseDirectory 'release.json'), ($record | ConvertTo-Json -Depth 6), $utf8NoBom)

Write-Output "工具发布包已准备: $releaseId"
Write-Output "目录: $releaseDirectory"
Write-Output "HTML SHA-256: $sourceHash"
Write-Output "清单 SHA-256: $manifestHash"
Write-Output '该脚本只准备本地发布包，不会连接服务器或修改生产目录。'
