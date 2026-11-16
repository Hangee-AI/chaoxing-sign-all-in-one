<#
  手机安装抓包证书（Windows）
  -------------------------------------------------
  只在「想让脚本自动抓签到链接」这条路才需要；
  如果只是把链接复制粘贴到签到页，可以不装，跳过本脚本。

  做三件事：
  1) 清掉上次可能残留的手机代理
  2) 起 mitmdump，确认 8080 在监听之后，才把手机代理指向它
  3) 你在这段时间里用手机浏览器打开 http://mitm.it 下载并安装证书
     装完按回车（或等超时），脚本自动恢复手机网络

  用法：双击项目根目录的「装手机证书.bat」
       或 pwsh -File capture-tool\install-cert.ps1
       参数： -Port 8080        抓包端口
              -WaitSec 420     最长等你多久（秒）
#>
param(
  [int]$Port = 8080,
  [int]$WaitSec = 420
)

$ErrorActionPreference = 'Continue'

function Write-Step([string]$msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "  $msg" -ForegroundColor Yellow }

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $port); return $true }
  catch { return $false }
  finally { $client.Dispose() }
}

function Find-Adb {
  $c = Get-Command adb -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $cands = @(
    'C:\Tools\adb\platform-tools\adb.exe',
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ProgramFiles\platform-tools\adb.exe"
  )
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  return $null
}

function Find-Mitm {
  $c = Get-Command mitmdump -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) {
    $s = & $py.Source -c "import sysconfig,os;print(os.path.join(sysconfig.get_path('scripts'),'mitmdump.exe'))" 2>$null
    if ($s -and (Test-Path $s.Trim())) { return $s.Trim() }
  }
  $cands = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts\mitmdump.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\Scripts\mitmdump.exe",
    "$env:APPDATA\Python\Python312\Scripts\mitmdump.exe"
  )
  foreach ($p in $cands) { if (Test-Path $p) { return $p } }
  return $null
}

$adb = Find-Adb
$mitm = Find-Mitm
$script:mitmProc = $null

if (-not $adb) {
  Write-Host ''
  Write-Warn '找不到 adb。请先安装 Android platform-tools（或用 `winget install Google.PlatformTools`），并确认命令行能跑 adb devices'
  exit 1
}
if (-not $mitm) {
  Write-Host ''
  Write-Warn '找不到 mitmdump。请先装 Python，然后：python -m pip install mitmproxy'
  exit 1
}

Write-Host ''
Write-Host '== 给手机安装抓包证书 ==' -ForegroundColor White
Write-Host ''

Write-Step '先清掉上次可能残留的手机代理（避免装证书时手机断网）'
& $adb shell settings put global http_proxy :0 2>$null | Out-Null
& $adb reverse --remove-all 2>$null | Out-Null

$devices = (& $adb devices 2>$null) -join "`n"
if ($devices -notmatch 'device$') {
  Write-Host ''
  Write-Warn '没检测到手机。请用数据线连上、在开发者选项里开「USB 调试」，手机上点「允许」'
  Write-Warn '然后再运行一次本脚本'
  exit 1
}

Write-Step '启动 mitmdump（隐藏窗口）'
if (Test-Port $Port) {
  Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
  for ($i = 0; $i -lt 20 -and (Test-Port $Port); $i++) { Start-Sleep -Milliseconds 250 }
}
$script:mitmProc = Start-Process -FilePath $mitm -ArgumentList @('-p', "$Port", '--ssl-insecure', '--set', 'flow_detail=0') -WindowStyle Hidden -PassThru

$listening = $false
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Port $Port) { $listening = $true; break }
  if ($script:mitmProc.HasExited) { break }
  Start-Sleep -Milliseconds 500
}

try {
  if (-not $listening) {
    throw "mitmdump 没能在 $Port 监听（可能被杀毒软件拦了或端口占用），这次不设代理，手机不受影响"
  }

  Write-Step "把手机代理指向 127.0.0.1:$Port"
  & $adb reverse "tcp:$Port" "tcp:$Port" 2>$null | Out-Null
  & $adb shell settings put global http_proxy "127.0.0.1:$Port" 2>$null | Out-Null
  Start-Sleep -Milliseconds 800

  Write-Host ''
  Write-Host '  现在用手机浏览器打开：  http://mitm.it' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  1) 选 Android，下载 .pem / .crt 证书' -ForegroundColor Yellow
  Write-Host '  2) 华为 / HarmonyOS：设置 → 安全 → 更多安全设置 → 加密和凭据' -ForegroundColor Yellow
  Write-Host '     → 从存储设备安装 → CA 证书 → 选中刚下载的文件' -ForegroundColor Yellow
  Write-Host '     Android 14+：设置 → 安全 → 加密和凭据 → 安装证书 → CA 证书 →「仍然安装」' -ForegroundColor Yellow
  Write-Host '  3) 系统会提示该证书可能监控流量，确认安装即可（只在本机生效）' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  装完回到这个窗口按回车，脚本会自动恢复手机网络。' -ForegroundColor Green
  Write-Host "  （最多等 $WaitSec 秒，超时也会自动恢复）" -ForegroundColor DarkGray
  Write-Host ''
  Write-Host "  电脑上的证书文件：$env:USERPROFILE\.mitmproxy\mitmproxy-ca-cert.cer" -ForegroundColor DarkGray
  Write-Host ''

  $deadline = (Get-Date).AddSeconds($WaitSec)
  while ((Get-Date) -lt $deadline) {
    if (-not [Console]::IsInputRedirected -and [Console]::KeyAvailable) {
      $null = [Console]::ReadKey($true)
      break
    }
    Start-Sleep -Milliseconds 300
  }
}
catch {
  Write-Host ''
  Write-Warn $_.Exception.Message
}
finally {
  Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
  & $adb shell settings put global http_proxy :0 2>$null | Out-Null
  & $adb reverse --remove-all 2>$null | Out-Null
  Start-Sleep -Milliseconds 500
  $proxyNow = ((& $adb shell settings get global http_proxy 2>$null) -join '') -replace "`r|`n", ''
  Write-Host ''
  Write-Host "  手机网络已恢复（http_proxy = $proxyNow）" -ForegroundColor Green
  Write-Host '  验证：双击「一键拍照签到.bat」，手机上点开签到卡片，能抓到链接就是装好了' -ForegroundColor Green
  Write-Host '  想删掉证书：设置 → 安全 → 加密和凭据 → 用户凭据 → mitmproxy → 卸载' -ForegroundColor DarkGray
  Write-Host ''
}
