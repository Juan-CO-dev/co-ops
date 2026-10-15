# Start the guides-v2 sim (production's on-screen switches) and the tester browser daemon as standalone
# processes, so long tester rounds are not cut off by the agent's 2-hour background limit.
$repo = 'C:\Users\conta\co-ops-guides'
$logs = Join-Path $env:TEMP 'guide-test-logs'
New-Item -ItemType Directory -Force $logs | Out-Null

foreach ($port in 3100, 3199) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

$simCmd = '/c set PULSE_V2=1&& set WHOS_HERE=1&& set CUSTOMER_PROFILES=1&& node scripts\sim\dev-sim.mjs > "' + (Join-Path $logs ("sim-" + (Get-Date -Format 'HHmmss') + ".log")) + '" 2>&1'
Start-Process -FilePath 'cmd.exe' -ArgumentList $simCmd -WorkingDirectory $repo -WindowStyle Hidden
$daemonCmd = '/c node scripts\guide-test\browser-daemon.mjs > "' + (Join-Path $logs ("daemon-" + (Get-Date -Format 'HHmmss') + ".log")) + '" 2>&1'
Start-Process -FilePath 'cmd.exe' -ArgumentList $daemonCmd -WorkingDirectory $repo -WindowStyle Hidden
Write-Output "started; logs in $logs"
