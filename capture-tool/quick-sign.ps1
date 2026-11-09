<#
  一键拍照签到（Windows）
  ---------------------------------------------
  1) 自愈：先把手机上一次残留的代理/reverse 清掉（之前脚本崩溃会把手机搞断网）
  2) 起 mitmdump 抓签到链接：先确认 8080 真的在监听，才去设手机代理
  3) 抓到链接后立刻恢复手机网络
  4) 把 quick-sign 页面推到手机浏览器（adb reverse 8050），你在手机上选照片、点签到

  用法：
    双击 一键拍照签到.bat
    或： pwsh -File capture-tool\quick-sign.ps1
    参数： -Link <签到链接>    跳过抓包，直接用这个链接
           -SkipCapture        不抓包（需要 -Link）
           -NoOpen             只打印地址，不打开浏览器（调试用）
           -CaptureTimeoutSec  抓包等待秒数，默认 150
#>
param(
  [string]$Link = '',
  [switch]$SkipCapture,
  [switch]$NoOpen,
  [int]$CaptureTimeoutSec = 150
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot          # ps1 在 capture-tool\ 里
$adb = 'C:\Tools\adb\platform-tools\adb.exe'
$mitm = 'C:\Users\18007\AppData\Local\Programs\Python\Python312\Scripts\mitmdump.exe'
$mitmPort = 8080
$webPort = 8050
$outFile = Join-Path $env:TEMP 'cx-sign-url.txt'
$addon = Join-Path $env:TEMP 'cx_grab_run.py'
$nodeExe = 'C:\Users\18007\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpmJs = 'C:\Users\18007\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'

$script:mitmProc = $null

function Write-Step([string]$msg) {
  Write-Host "  $msg" -ForegroundColor Cyan
}

function Write-Warn([string]$msg) {
  Write-Host "  $msg" -ForegroundColor Yellow
}

function Test-Port([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $port)
    return $true
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

function Reset-PhoneProxy {
  if (Test-Path $adb) {
    & $adb shell settings put global http_proxy :0 2>$null | Out-Null
    & $adb reverse --remove-all 2>$null | Out-Null
  }
}

function Stop-Mitm {
  if ($script:mitmProc -and -not $script:mitmProc.HasExited) {
    try { $script:mitmProc.Kill() } catch { }
  }
  Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $script:mitmProc = $null
}

function Start-DevServer {
  if (-not (Test-Path $nodeExe) -or -not (Test-Path $pnpmJs)) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCmd) {
      throw "找不到 node：$nodeExe 不存在，PATH 里也没有 node"
    }
    $nodeExe = $nodeCmd.Source
  }
  Write-Step '签到工具没在跑，先启动它（第一次要等 30~90 秒）'
  if (Test-Path $pnpmJs) {
    Start-Process -FilePath $nodeExe -ArgumentList @("`"$pnpmJs`"", 'exec', 'nuxi', 'dev', '--port', "$webPort") -WorkingDirectory $root -WindowStyle Minimized
  }
  else {
    Start-Process -FilePath $nodeExe -ArgumentList @('npx', 'nuxi', 'dev', '--port', "$webPort") -WorkingDirectory $root -WindowStyle Minimized
  }
}

function Ensure-Postgres {
  if (Test-Port 5432) { return }
  Write-Step 'WSL 里的 PostgreSQL 没起来，拉起来（保持一个 WSL 窗口存活）'
  Start-Process -FilePath 'wsl.exe' -ArgumentList '-d Ubuntu -e bash -lc "sudo -n service postgresql start; sleep infinity"' -WindowStyle Minimized
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-Port 5432) { return }
    Start-Sleep -Seconds 1
  }
  Write-Warn 'PostgreSQL 还是没起来，签到可能会失败（签到记录写库会报错）'
}

function Wait-WebServer {
  for ($i = 0; $i -lt 90; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/" -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -in 200, 302) { return }
    }
    catch {
      # 503 / 连接失败都继续等
    }
    Start-Sleep -Seconds 2
  }
  throw "等不到 http://127.0.0.1:$webPort 起来"
}

function Open-SignPage([string]$signLink) {
  $encoded = [uri]::EscapeDataString($signLink)
  $url = "http://127.0.0.1:$webPort/quick-sign?link=$encoded"

  if (Test-Path $adb) {
    & $adb reverse tcp:$webPort tcp:$webPort 2>$null | Out-Null
    if (-not $NoOpen) {
      try {
        & $adb shell "am start -a android.intent.action.VIEW -d '$url'" 2>$null | Out-Null
      }
      catch {
        Write-Warn '没能在手机上直接打开浏览器，改用电脑浏览器'
      }
    }
  }

  if (-not $NoOpen) {
    Start-Process $url
  }

  Write-Host ''
  Write-Host '  签到页地址：' -ForegroundColor Green
  Write-Host "  $url" -ForegroundColor Green
  if (-not $NoOpen) {
    Write-Host '  手机浏览器里选照片 -> 点「提交签到」，结果会直接显示在页面上。' -ForegroundColor Green
  }
}

try {
  Write-Host ''
  Write-Host '== 一键拍照签到 ==' -ForegroundColor White
  Write-Host ''

  Write-Step '先清理上次可能残留的手机代理（避免一开机就断网）'
  Reset-PhoneProxy
  Stop-Mitm

  if (-not (Test-Path $adb)) { throw "找不到 adb：$adb" }
  $devices = & $adb devices 2>$null | Select-String -Pattern 'device$'
  if (-not $devices) { throw '没有检测到手机：插好 USB，打开「USB 调试」并允许这台电脑' }

  Ensure-Postgres
  if (-not (Test-Port $webPort)) { Start-DevServer }
  Wait-WebServer

  if ([string]::IsNullOrWhiteSpace($Link) -and -not $SkipCapture) {
    if (-not (Test-Path $mitm)) { throw "找不到 mitmdump：$mitm" }
    $grab = Join-Path $root 'capture-tool\cx_grab.py'
    if (-not (Test-Path $grab)) { throw "找不到抓包脚本：$grab" }
    Copy-Item $grab $addon -Force
    Remove-Item $outFile -ErrorAction SilentlyContinue

    Write-Step '启动 mitmdump（隐藏窗口）'
    $script:mitmProc = Start-Process -FilePath $mitm -ArgumentList @('-p', "$mitmPort", '--ssl-insecure', '-s', $addon, '--set', 'flow_detail=0') -WindowStyle Hidden -PassThru

    $listening = $false
    for ($i = 0; $i -lt 30; $i++) {
      if (Test-Port $mitmPort) { $listening = $true; break }
      if ($script:mitmProc.HasExited) { break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $listening) { throw 'mitmdump 没能在 8080 监听，这次不设代理，手机不受影响' }

    Write-Step '8080 已监听，挂到手机上并设置代理'
    & $adb reverse tcp:$mitmPort tcp:$mitmPort 2>$null | Out-Null
    & $adb shell settings put global http_proxy "127.0.0.1:$mitmPort" 2>$null | Out-Null

    Write-Host ''
    Write-Host '  现在去手机上打开那个签到卡片（进入拍照签到页就行，先别拍照）' -ForegroundColor Yellow
    Write-Host "  最多等 $CaptureTimeoutSec 秒，抓到链接会立刻恢复手机网络" -ForegroundColor Yellow
    Write-Host ''

    $deadline = (Get-Date).AddSeconds($CaptureTimeoutSec)
    while ((Get-Date) -lt $deadline) {
      if (Test-Path $outFile) {
        $captured = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue).Trim()
        if ($captured) { $Link = $captured; break }
      }
      if ($script:mitmProc.HasExited) { throw 'mitmdump 自己退出了（抓包失败）' }
      Start-Sleep -Milliseconds 800
    }
  }

  if ([string]::IsNullOrWhiteSpace($Link)) {
    throw '没抓到链接：超时了。确认手机上打开的是签到卡片页面，或手动复制链接后用 -Link 参数运行'
  }
}
finally {
  # 无论如何都把手机网络恢复（这是之前的坑：脚本退出时代理还留着）
  Reset-PhoneProxy
  Stop-Mitm
}

Write-Step '手机网络已恢复'
Write-Host ''
Write-Host '  抓到的链接：' -ForegroundColor White
Write-Host "  $Link" -ForegroundColor White

Open-SignPage $Link

Write-Host ''
Write-Host '  完成后这个窗口可以直接关掉。' -ForegroundColor DarkGray
Start-Sleep -Seconds 1
