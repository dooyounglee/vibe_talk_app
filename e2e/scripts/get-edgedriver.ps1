# WebView2 런타임과 같은 버전의 msedgedriver를 e2e/bin 에 받는다.
# WebView2가 업데이트되면 버전이 어긋나 세션 생성이 실패하므로 그때 다시 실행한다.
$ErrorActionPreference = 'Stop'

$keys = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$version = $null
foreach ($k in $keys) {
  if (Test-Path $k) {
    $version = (Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue).pv
    if ($version) { break }
  }
}
if (-not $version) { throw 'WebView2 runtime version not found.' }

$binDir = Join-Path $PSScriptRoot '..\bin'
New-Item -ItemType Directory -Force $binDir | Out-Null
$exe = Join-Path $binDir 'msedgedriver.exe'
$stamp = Join-Path $binDir 'version.txt'

if ((Test-Path $exe) -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $version)) {
  Write-Output "msedgedriver $version already present"
  exit 0
}

$zip = Join-Path $env:TEMP "edgedriver_$version.zip"
$url = "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip"
Write-Output "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

$extract = Join-Path $env:TEMP "edgedriver_$version"
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $zip -DestinationPath $extract
Copy-Item (Join-Path $extract 'msedgedriver.exe') $exe -Force
Set-Content -Path $stamp -Value $version -Encoding ascii
Remove-Item -Recurse -Force $extract, $zip

Write-Output "msedgedriver $version -> $exe"
