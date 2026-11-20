<#
  一键拍照签到（Windows）
  ---------------------------------------------
  1) 自愈：先把手机上一次残留的代理/reverse 清掉（之前脚本崩溃会把手机搞断网）
  2) 起 mitmdump 抓签到链接：先确认 8080 真的在监听，才去设手机代理
  3) 抓到链接后立刻恢复手机网络
  4) 把 quick-sign.html 页面推到手机浏览器（adb reverse 8050），你在手机上选照片、点签到

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
$mitmPort = 8080
$webPort = 8050
$outFile = Join-Path $env:TEMP 'cx-sign-url.txt'
$addon = Join-Path $env:TEMP 'cx_grab_run.py'
$script:devLog = Join-Path $env:TEMP 'cx-dev.log'
$script:devErrLog = Join-Path $env:TEMP 'cx-dev.err.log'

# 全部依赖都按「先找本机 PATH / 常见安装位置」的顺序探测，不写死某一台机器的路径，
# 这样把 zip 发给别人也能直接跑。
function Find-Adb {
  $candidates = @()
  foreach ($sdk in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
    if ($sdk) { $candidates += (Join-Path $sdk 'platform-tools\adb.exe') }
  }
  $candidates += @(
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'),
    'C:\Tools\adb\platform-tools\adb.exe',
    (Join-Path $env:ProgramFiles 'Android\platform-tools\adb.exe')
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  $cmd = Get-Command adb -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Find-Mitm {
  $cmd = Get-Command mitmdump -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\Scripts\mitmdump.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\Scripts\mitmdump.exe'),
    (Join-Path $env:APPDATA 'Python\Python312\Scripts\mitmdump.exe')
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  $py = Get-Command python -ErrorAction SilentlyContinue
  if ($py) {
    $scripts = Join-Path (Split-Path $py.Source -Parent) 'Scripts\mitmdump.exe'
    if (Test-Path $scripts) { return $scripts }
  }
  return $null
}

$adb = Find-Adb
$mitm = Find-Mitm

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
  if ($adb -and (Test-Path $adb)) {
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
  Write-Step '签到工具没在跑，先启动它（冷启动可能要 1~2 分钟）'

  # node 不在 PATH 时，按常见安装位置补进 PATH（别人机器上装了 Node，但 PATH 可能没刷新）
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeCandidates = @(
      (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
      'C:\Users\18007\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    )
    foreach ($cand in $nodeCandidates) {
      if ($cand -and (Test-Path $cand)) {
        $env:PATH = (Split-Path $cand -Parent) + ';' + $env:PATH
        break
      }
    }
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '找不到 node：请先安装 Node 18+（https://nodejs.org），装完重开一个终端'
  }

  # pnpm 优先用本机装的；没有就用 corepack / npx
  $cmd = $null
  if (Get-Command pnpm -ErrorAction SilentlyContinue) { $cmd = 'pnpm exec nuxi dev --port ' + $webPort }
  elseif (Get-Command corepack -ErrorAction SilentlyContinue) { $cmd = 'corepack pnpm exec nuxi dev --port ' + $webPort }
  else {
    $dshPnpm = 'C:\Users\18007\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
    if (Test-Path $dshPnpm) { $cmd = '"' + (Get-Command node).Source + '" "' + $dshPnpm + '" exec nuxi dev --port ' + $webPort }
    else { $cmd = 'npx --yes nuxi@latest dev --port ' + $webPort }
  }

  $stdout = $script:devLog
  $stderr = $script:devErrLog
  try {
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "cd /d `"$root`" && $cmd") -WindowStyle Hidden `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
  }
  catch {
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', "cd /d `"$root`" && $cmd") -WindowStyle Minimized
  }
}

function Ensure-Postgres {
  if (Test-Port 5432) { return }
  if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) {
    throw 'PostgreSQL 没在跑（127.0.0.1:5432 连不上），而且本机没有 WSL：请先装并启动 PostgreSQL'
  }
  Write-Step 'WSL 里的 PostgreSQL 没起来，拉起来（保持一个 WSL 窗口存活）'
  Start-Process -FilePath 'wsl.exe' -ArgumentList '-d Ubuntu -e bash -lc "sudo -n service postgresql start; sleep infinity"' -WindowStyle Minimized
  # WSL 冷启动 + systemd-less 的 service 拉起可能要 1 分钟，等够再开始起 dev
  for ($i = 0; $i -lt 90; $i++) {
    if (Test-Port 5432) { Start-Sleep -Seconds 1; return }
    Start-Sleep -Seconds 1
  }
  throw 'PostgreSQL 一直没起来（127.0.0.1:5432 连不上）：先在 WSL 里跑 sudo service postgresql start，再重试'
}

function Wait-WebServer {
  # 用静态页探活：首页 / 需要 next-auth 会话、偶发 500，不能代表服务没起来
  # 冷启动实测 90~100 秒，给到 240 秒
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/quick-sign.html" -UseBasicParsing -TimeoutSec 5
      if ($resp.StatusCode -in 200, 302) { return }
    }
    catch {
      # 503 / 连接失败都继续等
    }
    Start-Sleep -Seconds 2
  }
  $tail = ''
  foreach ($f in @($script:devLog, $script:devErrLog)) {
    if (Test-Path $f) { $tail += (Get-Content $f -Tail 8 -ErrorAction SilentlyContinue) -join [Environment]::NewLine }
  }
  throw "等不到 http://127.0.0.1:$webPort 起来。dev 日志最后几行：`n$tail"
}

function Open-SignPage([string]$signLink) {
  $encoded = [uri]::EscapeDataString($signLink)
  # 用 public/quick-sign.html：纯静态 + 原生 JS，不依赖 Nuxt 客户端 hydration
  # （项目路径带中文时 dev 模式的 entry.js 会 404，Vue 页面的按钮点了没反应）
  $url = "http://127.0.0.1:$webPort/quick-sign.html?link=$encoded"

  if ($adb -and (Test-Path $adb)) {
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

  $needCapture = [string]::IsNullOrWhiteSpace($Link) -and -not $SkipCapture
  if ($needCapture) {
    # 只有需要抓包时才强制要求手机 + adb；别人只粘链接（-Link）用路线一，不用装 adb
    if (-not $adb) { throw '找不到 adb：请安装 Android platform-tools 并把 adb 加进 PATH（或设置 ANDROID_HOME）' }
    $devices = & $adb devices 2>$null | Select-String -Pattern 'device$'
    if (-not $devices) { throw '没有检测到手机：插好 USB，打开「USB 调试」并允许这台电脑' }
  }

  Ensure-Postgres
  if (-not (Test-Port $webPort)) { Start-DevServer }
  Wait-WebServer

  if ([string]::IsNullOrWhiteSpace($Link) -and -not $SkipCapture) {
    if (-not $mitm) { throw '找不到 mitmdump：请先 pip install mitmproxy，装完把 Scripts 目录加进 PATH' }
    $grab = Join-Path $root 'capture-tool\cx_grab.py'
    if (-not (Test-Path $grab)) { throw "找不到抓包脚本：$grab" }
    Copy-Item $grab $addon -Force
    Remove-Item $outFile -ErrorAction SilentlyContinue

    Write-Step '启动 mitmdump（隐藏窗口）'
    # 端口被上一次残留的 mitmdump 占着的话先清掉，否则新进程会 bind 失败
    if (Test-Port $mitmPort) {
      Get-Process mitmdump -ErrorAction SilentlyContinue | Stop-Process -Force
      for ($i = 0; $i -lt 20 -and (Test-Port $mitmPort); $i++) { Start-Sleep -Milliseconds 250 }
    }
    $script:mitmProc = Start-Process -FilePath $mitm -ArgumentList @('-p', "$mitmPort", '--ssl-insecure', '-s', $addon, '--set', 'flow_detail=0') -WindowStyle Hidden -PassThru

    # 冷启动（含杀毒软件扫描）可能要 20 秒以上，给到 30 秒
    $listening = $false
    for ($i = 0; $i -lt 60; $i++) {
      if (Test-Port $mitmPort) { $listening = $true; break }
      if ($script:mitmProc.HasExited) { break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $listening) { throw 'mitmdump 没能在 8080 监听（可能被杀毒软件拦了或端口占用），这次不设代理，手机不受影响' }

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
