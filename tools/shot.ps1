# Dev helper: headless screenshot of the running game.
# Usage: tools\shot.ps1 -Name run -Query "autostart=1&god=1&warp=8&seed=7" [-W 1280 -H 720]
param([string]$Name = 'shot', [string]$Query = '', [int]$W = 1280, [int]$H = 720, [int]$Wait = 6000)
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$out = Join-Path $PSScriptRoot "_debug_$Name.png"
$profile = Join-Path $env:TEMP "apex-shot-profile"
& $edge --headless=new --disable-gpu-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --hide-scrollbars --no-first-run --user-data-dir="$profile" --window-size="$W,$H" --virtual-time-budget=$Wait --screenshot="$out" "http://127.0.0.1:5180/?$Query" | Out-Null
Start-Sleep -Milliseconds 300
if (Test-Path $out) { "saved $out" } else { "no screenshot produced" }

