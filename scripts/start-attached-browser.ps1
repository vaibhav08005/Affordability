param(
  [int]$Port = 9222,
  [string]$ProfileDir = ".browser-profiles\halifax-attached",
  [string]$Url = "https://www2.halifax-intermediariesonline.co.uk/tools/calculator/"
)

$ErrorActionPreference = "Stop"

$chromeCandidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
)

$browser = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $browser) {
  throw "Chrome or Edge was not found."
}

$resolvedProfileDir = Resolve-Path -LiteralPath (New-Item -ItemType Directory -Force -Path $ProfileDir)

$args = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$resolvedProfileDir",
  "--no-first-run",
  "--new-window",
  $Url
)

Start-Process -FilePath $browser -ArgumentList $args -WindowStyle Normal

Write-Output "Browser started: $browser"
Write-Output "CDP endpoint page: http://127.0.0.1:$Port/json/version"
Write-Output "Set BROWSER_EXECUTION_MODE=attached"
Write-Output "Set BROWSER_WS_ENDPOINT from the webSocketDebuggerUrl value returned by /json/version"
