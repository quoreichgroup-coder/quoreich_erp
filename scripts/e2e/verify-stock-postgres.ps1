# QERP is served locally against PostgREST and a new, strictly synthetic PostgreSQL database.
param([switch]$StockOnly)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 10)
$network = "qerp-stock-test-$suffix"
$database = "qerp-stock-db-$suffix"
$rest = "qerp-stock-rest-$suffix"
$dbPassword = [guid]::NewGuid().ToString('N')
$restPassword = [guid]::NewGuid().ToString('N')
$jwt = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$restImage = 'ghcr.io/supabase/postgrest:v14.18'
$startedNetwork = $false
$startedDb = $false
$startedRest = $false
$savedSecret = $env:QERP_STOCK_TEST_JWT_SECRET

function Send-Sql([string]$sql) {
    $sql | docker exec -i -e 'PGOPTIONS=-c client_min_messages=warning' $database psql -Xq -U postgres -v ON_ERROR_STOP=1 -f - | Out-Null
    if ($LASTEXITCODE) { throw 'SQL failure in the isolated stock database.' }
}

Push-Location $root
try {
    docker image inspect $restImage --format '{{.Id}}' | Out-Null
    if ($LASTEXITCODE) { throw "Run docker pull $restImage first." }
    # On Docker Desktop, --internal suppresses the PostgREST port published to loopback.
    # Use a dedicated bridge; PostgreSQL remains unpublished and only the REST port binds to 127.0.0.1.
    docker network create $network | Out-Null
    if ($LASTEXITCODE) { throw 'Could not create the isolated test network.' }
    $startedNetwork = $true
    docker run --pull never --detach --network $network --name $database `
      -e "POSTGRES_PASSWORD=$dbPassword" postgres:18.6-alpine | Out-Null
    if ($LASTEXITCODE) { throw 'Could not start the test database.' }
    $startedDb = $true
    $ready = $false
    for ($i = 0; $i -lt 35; $i++) {
        docker exec $database pg_isready -h 127.0.0.1 -U postgres | Out-Null
        if (!$LASTEXITCODE) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Test PostgreSQL did not become ready.' }

    $migrations = Get-ChildItem './services/api/src/main/resources/db/migration' -Filter 'V*.sql' |
      Sort-Object { [int]($_.Name -replace '^V(\d+)__.*', '$1') }
    if ($StockOnly) {
        $migrations = @($migrations | Where-Object {
            $version = [int]($_.Name -replace '^V(\d+)__.*', '$1')
            $version -le 79 -or $version -in @(91, 92, 93, 94, 96, 100)
        })
    }
    foreach ($migration in $migrations) { Send-Sql (Get-Content -Raw -Encoding utf8 $migration.FullName) }
    Send-Sql (Get-Content -Raw -Encoding utf8 './services/api/src/test/resources/fixtures/reference-dataset.sql')
    Send-Sql (Get-Content -Raw -Encoding utf8 './scripts/e2e/stock-postgres-fixture.sql')
    Send-Sql "CREATE ROLE stock_authenticator NOINHERIT LOGIN PASSWORD '$restPassword'; GRANT anon, authenticated TO stock_authenticator;"
    Write-Output "PostgreSQL isolated: loaded $($migrations.Count) migrations through $($migrations[-1].Name)."

    docker run --pull never --detach --network $network --name $rest -p '127.0.0.1:18101:3000' `
      -e "PGRST_DB_URI=postgres://stock_authenticator:${restPassword}@${database}:5432/postgres" `
      -e 'PGRST_DB_SCHEMAS=public' -e 'PGRST_DB_ANON_ROLE=anon' -e "PGRST_JWT_SECRET=$jwt" $restImage | Out-Null
    if ($LASTEXITCODE) { throw 'Could not start PostgREST.' }
    $startedRest = $true
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:18101/' | Out-Null
            $ready = $true
            break
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { docker logs --tail 12 $rest; throw 'PostgREST did not become ready.' }

    $env:QERP_STOCK_TEST_JWT_SECRET = $jwt
    npx.cmd playwright test --config playwright.stock-postgres.config.ts --reporter=list
    if ($LASTEXITCODE) { throw 'Stock browser/SQL tests failed.' }
    Send-Sql (Get-Content -Raw -Encoding utf8 './scripts/e2e/stock-postgres-verify.sql')
    Write-Output 'Stock browser/SQL tests and independent checks passed.'
} finally {
    $env:QERP_STOCK_TEST_JWT_SECRET = $savedSecret
    if ($startedRest) { docker rm -f $rest | Out-Null }
    if ($startedDb) { docker rm -f $database | Out-Null }
    if ($startedNetwork) { docker network rm $network | Out-Null }
    Pop-Location
}
