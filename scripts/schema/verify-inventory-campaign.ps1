# Run from any directory. Requires the local postgres:18.6-alpine image.
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$container = 'qerp-s3-schema-' + [guid]::NewGuid().ToString('N').Substring(0, 8)

function Invoke-SqlFile($file) {
    Get-Content -Raw -Encoding utf8 -LiteralPath $file |
        docker exec -i $container psql -X -q -U postgres -v ON_ERROR_STOP=1 -f - | Out-Null
    if ($LASTEXITCODE) { throw "SQL failed: $file" }
}

docker run --pull never --detach --network none --name $container -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18.6-alpine | Out-Null
if ($LASTEXITCODE) { throw 'Unable to start the disposable PostgreSQL container' }

try {
    $ready = $false
    for ($i = 0; $i -lt 25; $i++) {
        docker exec $container pg_isready -h 127.0.0.1 -U postgres | Out-Null
        if (!$LASTEXITCODE) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (!$ready) { throw 'Disposable PostgreSQL did not become ready' }

    $path = Join-Path $root 'services/api/src/main/resources/db/migration'
    $migrations = Get-ChildItem $path -Filter 'V*.sql' | Sort-Object { [int]($_.Name -replace '^V(\d+)__.*', '$1') }
    foreach ($migration in $migrations) {
        Get-Content -Raw -Encoding utf8 -LiteralPath $migration.FullName |
            docker exec -i $container psql -X -q -U postgres -v ON_ERROR_STOP=1 --single-transaction -f - | Out-Null
        if ($LASTEXITCODE) { throw "Migration failed: $($migration.Name)" }
    }
    Write-Output "Applied $($migrations.Count) migrations through $($migrations[-1].Name)."
    Invoke-SqlFile (Join-Path $root 'services/api/src/test/resources/fixtures/reference-dataset.sql')
    Invoke-SqlFile (Join-Path $PSScriptRoot 'verify-inventory-campaign-full.sql')
    Invoke-SqlFile (Join-Path $PSScriptRoot 'verify-inventory-campaign-control.sql')
    Invoke-SqlFile (Join-Path $PSScriptRoot 'verify-inventory-campaign-catalog.sql')
    Invoke-SqlFile (Join-Path $PSScriptRoot 'verify-inventory-cycle-count.sql')
    Invoke-SqlFile (Join-Path $PSScriptRoot 'verify-inventory-campaign-unallocated.sql')
    Invoke-SqlFile (Join-Path $PSScriptRoot 'verify-inventory-campaign-volume.sql')
    Get-Content -Raw -Encoding utf8 (Join-Path $PSScriptRoot 'verify-inventory-campaign-race.sh') |
        docker exec -i $container sh -c "tr -d '\015' | sh"
    if ($LASTEXITCODE) { throw 'S3 race test failed' }
} finally {
    docker rm -f $container | Out-Null
}
