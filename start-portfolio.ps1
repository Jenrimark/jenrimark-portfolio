$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { throw 'Node.js 22 or later is required.' }
$listener = Get-NetTCPConnection -State Listen -LocalPort 8766 -ErrorAction SilentlyContinue
if (-not $listener) {
  New-Item -ItemType Directory -Force -Path (Join-Path $projectDirectory '.local') | Out-Null
  $serverScript = Join-Path $projectDirectory 'scripts\server.mjs'
  Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectDirectory '.local\server.log') -RedirectStandardError (Join-Path $projectDirectory '.local\server-error.log')
  Start-Sleep -Seconds 1
}
Start-Process 'http://127.0.0.1:8766/admin/'
Write-Host ('Local login details: ' + (Join-Path $projectDirectory '.local\admin-access.txt'))
