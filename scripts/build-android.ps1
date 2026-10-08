param(
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$BuildRoot = (Join-Path $env:LOCALAPPDATA 'OrbitAndroidToolchain/builds'),
  [switch]$Offline,
  [switch]$DeveloperTools
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) { throw 'Pass -JavaHome with a JDK 17 directory' }
$resolvedBuildRoot = [IO.Path]::GetFullPath($BuildRoot)
if ($resolvedBuildRoot -match '[^\x00-\x7F]') { throw 'BuildRoot must be an ASCII path for the Gradle Windows test worker' }
$workspace = Join-Path $resolvedBuildRoot ([Guid]::NewGuid().ToString('N'))
$mirror = Join-Path $workspace 'android'
New-Item -ItemType Directory -Path $mirror -Force | Out-Null
function Copy-AndroidSources([string]$from, [string]$to) {
  foreach ($entry in Get-ChildItem -LiteralPath $from) {
    if ($entry.PSIsContainer) {
      if ($entry.Name -in @('build', '.gradle', '.kotlin')) { continue }
      $next = Join-Path $to $entry.Name
      New-Item -ItemType Directory -Path $next -Force | Out-Null
      Copy-AndroidSources $entry.FullName $next
    } elseif ($entry.Extension -notin @('.jks', '.keystore')) {
      Copy-Item -LiteralPath $entry.FullName -Destination (Join-Path $to $entry.Name)
    }
  }
}
# Use a disposable ASCII copy. The checkout and existing local changes are never moved or reset.
Copy-AndroidSources (Join-Path $sourceRoot 'android') $mirror
Copy-Item -LiteralPath (Join-Path $sourceRoot 'package.json') -Destination (Join-Path $workspace 'package.json')
$arguments = @('-classpath', (Join-Path $mirror 'gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain',
  '-p', $mirror, ':app:assembleDebug', ':app:lintDebug', ':app:testDebugUnitTest', '--no-daemon')
if ($Offline) { $arguments += '--offline' }
if ($DeveloperTools) { $arguments += '-PorbitDeveloperTools=true' }
& (Join-Path $JavaHome 'bin/java.exe') @arguments
if ($LASTEXITCODE -ne 0) { throw "Android verification failed; evidence retained at $workspace" }
$output = Join-Path $sourceRoot 'android/app/build/outputs/apk/debug'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$apkName = if ($DeveloperTools) { 'app-debug-developer.apk' } else { 'app-debug.apk' }
Copy-Item -LiteralPath (Join-Path $mirror 'app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $output $apkName) -Force
Write-Output "APK: $(Join-Path $output $apkName)"
Write-Output "Build and verification evidence: $workspace"
