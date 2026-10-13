$ErrorActionPreference = 'Stop'
$config = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
if ($config.bundle.windows.webviewInstallMode.type -ne 'offlineInstaller') {
    throw 'Windows release must bundle the complete offline WebView2 installer'
}
$folder = 'src-tauri/target/release/bundle/nsis'
$installers = @(Get-ChildItem $folder -Filter '*-setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows setup executable' }
$installer = $installers[0]
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$listing = & $sevenZip l -slt $installer.FullName
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the NSIS installer' }
New-Item -ItemType Directory -Force 'test-results' | Out-Null
$listing | Set-Content 'test-results/installer-contents.txt'
$entries = ($listing -join "`n") -split "`n\s*`n"
$runtime = @($entries | Where-Object { $_ -match '(?im)^Path = .*WebView2.*\.exe\s*$' })
if ($runtime.Count -eq 0) { throw 'Bundled WebView2 installer is missing from the setup executable' }
$runtimeInfo = foreach ($entry in $runtime) {
    $pathMatch = [regex]::Match($entry, '(?im)^Path = (.*)\s*$')
    $sizeMatch = [regex]::Match($entry, '(?im)^Size = (\d+)\s*$')
    if (-not $sizeMatch.Success -or [long]$sizeMatch.Groups[1].Value -lt 50MB) {
        throw 'WebView2 payload is too small for the complete offline installer'
    }
    @{ path = $pathMatch.Groups[1].Value.Trim(); bytes = [long]$sizeMatch.Groups[1].Value }
}
$hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $($installer.Name)" | Set-Content (Join-Path $folder 'SHA256SUMS.txt') -Encoding utf8
@{
    app = $config.productName
    version = $config.version
    platform = 'windows-x64'
    installer = $installer.Name
    bytes = $installer.Length
    sha256 = $hash
    webview_install_mode = 'offlineInstaller'
    bundled_webview2 = @($runtimeInfo)
    commit = $env:GITHUB_SHA
    run_url = "https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
    signed = $false
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $folder 'installer-manifest.json') -Encoding utf8
Write-Host "Verified offline WebView2 payload in $($installer.Name) ($($installer.Length) bytes)"
Write-Host "SHA256: $hash"
