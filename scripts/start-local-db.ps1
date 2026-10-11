$ErrorActionPreference = 'Stop'
$projectPath = Split-Path $PSScriptRoot -Parent
$dataPath = Join-Path $projectPath '.local\postgres-data'
$pgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
& $pgCtl -D $dataPath status
if ($LASTEXITCODE -eq 0) { exit 0 }
$process = Start-Process -FilePath $pgCtl -ArgumentList @('-D', ('"' + $dataPath + '"'), '-l', ('"' + (Join-Path $projectPath '.local\postgres.log') + '"'), '-w', 'start') -WindowStyle Hidden -PassThru
if (!$process.WaitForExit(15000)) { throw 'Database startup timed out. Inspect .local/postgres.log.' }; if ($process.ExitCode -ne 0) { throw 'Unable to start local PostgreSQL. Check .local/postgres.log.' }
