$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $env:TEMP ('radefy-e2e-' + [guid]::NewGuid())
$env:PHARMACY_TEST_DATA_DIR = $testRoot
$env:PHARMACY_TEST_BINARY = (Resolve-Path 'src-tauri/target/debug/pharmacy-offline.exe').Path
cargo run --manifest-path src-tauri/Cargo.toml --example seed_e2e -- $testRoot
if ($LASTEXITCODE -ne 0) { throw 'Fixture creation failed' }
New-Item -ItemType Directory -Force 'test-results' | Out-Null
$driver = Start-Process tauri-driver -PassThru -NoNewWindow -RedirectStandardOutput 'test-results/tauri-driver.log' -RedirectStandardError 'test-results/tauri-driver-error.log'
try {
    python -m unittest discover -s tests/windows -v
    if ($LASTEXITCODE -ne 0) { throw 'Windows desktop test failed' }
} finally {
    Stop-Process -Id $driver.Id -ErrorAction SilentlyContinue
    Remove-Item Env:PHARMACY_TEST_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:PHARMACY_TEST_BINARY -ErrorAction SilentlyContinue
    Write-Host "Test database retained at $testRoot"
}
