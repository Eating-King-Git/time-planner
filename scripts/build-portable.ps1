param([string]$ElectronDist = '', [string]$ReleaseDirectory = '')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$releasePath = if ($ReleaseDirectory) { [IO.Path]::GetFullPath($ReleaseDirectory) } else { Join-Path $projectPath 'release' }
$appName = -join @([char]0x65F6, [char]0x95F4, [char]0x89C4, [char]0x5212, [char]0x5E08)
$info = [IO.File]::ReadAllText((Join-Path $projectPath 'package.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
if (-not $ElectronDist) { $ElectronDist = Join-Path $projectPath 'node_modules\electron\dist' }
$ElectronDist = [IO.Path]::GetFullPath($ElectronDist)
if (-not (Test-Path -LiteralPath (Join-Path $ElectronDist 'electron.exe'))) { throw 'Run npm ci before building.' }
$portableName = "TimePlanner-v$($info.version)-windows"
$portablePath = Join-Path $releasePath $portableName
$portableZip = Join-Path $releasePath "$portableName.zip"
$sourceZip = Join-Path $releasePath "TimePlanner-v$($info.version)-source.zip"
foreach ($target in @($portablePath, $portableZip, $sourceZip)) {
  if (Test-Path -LiteralPath $target) { throw "Already exists: $target" }
}
New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
Copy-Item -LiteralPath $ElectronDist -Destination $portablePath -Recurse
$appPath = Join-Path $portablePath 'resources\app'
New-Item -ItemType Directory -Path $appPath -Force | Out-Null
foreach ($name in @('package.json', 'main.js', 'preload.js', 'reminders.js', 'store.js', 'README.md', 'LICENSE', 'core', 'renderer')) {
  Copy-Item -LiteralPath (Join-Path $projectPath $name) -Destination $appPath -Recurse
}
Move-Item -LiteralPath (Join-Path $portablePath 'electron.exe') -Destination (Join-Path $portablePath "$appName.exe")
Compress-Archive -LiteralPath $portablePath -DestinationPath $portableZip -CompressionLevel Optimal
$sourceItems = @('package.json', 'package-lock.json', 'main.js', 'preload.js', 'reminders.js', 'store.js', 'README.md', 'LICENSE', 'core', 'renderer', 'scripts', 'tests', 'docs') | ForEach-Object { Join-Path $projectPath $_ }
Compress-Archive -LiteralPath $sourceItems -DestinationPath $sourceZip -CompressionLevel Optimal
Get-Item -LiteralPath $portableZip, $sourceZip | Select-Object Name, Length
