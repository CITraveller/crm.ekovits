$ErrorActionPreference = 'Stop'
$projectPath = Split-Path $PSScriptRoot -Parent
$localPath = Join-Path $projectPath '.local'
$dataPath = Join-Path $localPath 'postgres-data'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
if (!(Test-Path (Join-Path $pgBin 'initdb.exe'))) { throw 'PostgreSQL 18 binaries were not found. Configure DATABASE_URL in .env for your existing server instead.' }
New-Item -ItemType Directory -Path $localPath -Force | Out-Null
if (Test-Path (Join-Path $projectPath '.env')) { throw '.env already exists. Use scripts/start-local-db.ps1 to restart the existing database.' }
$databasePassword = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$adminPassword = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12))
$passwordPath = Join-Path $localPath 'init-password.txt'
Set-Content -LiteralPath $passwordPath -Value $databasePassword -Encoding ascii
try {
  & (Join-Path $pgBin 'initdb.exe') -D $dataPath -U crm_app --auth=scram-sha-256 --pwfile=$passwordPath --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
} finally { Remove-Item -LiteralPath $passwordPath -ErrorAction SilentlyContinue }
Add-Content -LiteralPath (Join-Path $dataPath 'postgresql.conf') -Value "`nport = 55432`nlisten_addresses = '127.0.0.1'`ntimezone = 'Asia/Kolkata'`n"
$envText = "DATABASE_URL=postgresql://crm_app:${databasePassword}@127.0.0.1:55432/crm_module`nPORT=4310`nAPP_ORIGIN=http://127.0.0.1:5188`nADMIN_EMAIL=admin@crm.local`nADMIN_PASSWORD=$adminPassword`nNODE_ENV=development`n"
Set-Content -LiteralPath (Join-Path $projectPath '.env') -Value $envText -Encoding ascii
$postgresProcess = Start-Process -FilePath (Join-Path $pgBin 'pg_ctl.exe') -ArgumentList @('-D', ('"' + $dataPath + '"'), '-l', ('"' + (Join-Path $localPath 'postgres.log') + '"'), '-w', 'start') -WindowStyle Hidden -PassThru
if (!$postgresProcess.WaitForExit(15000)) { throw 'Database startup timed out. Inspect .local/postgres.log.' }; if ($postgresProcess.ExitCode -ne 0) { throw 'Database startup failed. Inspect .local/postgres.log.' }
try {
  $env:PGPASSWORD = $databasePassword
  & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U crm_app crm_module
  if ($LASTEXITCODE -ne 0) { throw 'Database creation failed.' }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
Set-Content -LiteralPath (Join-Path $localPath 'login.txt') -Value "Orbit CRM local sign-in`nEmail: admin@crm.local`nPassword: $adminPassword`n" -Encoding ascii
Write-Output 'Dedicated PostgreSQL database is ready at 127.0.0.1:55432. Sign-in credentials are in .local/login.txt.'
