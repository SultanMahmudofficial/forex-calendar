# update-news.ps1
# Pulls the latest economic-calendar feed from Forex Factory and caches it locally,
# plus Actual values scraped from the Forex Factory calendar page (the JSON feed has
# no "actual", only forecast/previous).
# The site reads data/data-embedded.js (loaded via <script>), so it works with no server.
# Run manually, or automatically every 12 hours via the scheduled task
# "ForexCalendarRefresh" (created by the app) or setup-schedule.bat.

$ErrorActionPreference = "Stop"

$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $base "data"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$feedUrl  = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
$pageUrl  = "https://www.forexfactory.com/calendar"
$jsonPath = Join-Path $outDir "news.json"
$jsPath   = Join-Path $outDir "data-embedded.js"
$logPath  = Join-Path $base "update-log.txt"

$headers = @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
  "Accept"     = "text/html,application/json"
}

function Write-Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg"
  Add-Content -Path $logPath -Value $line
  Write-Host $line
}

# Fetch the FF calendar page as UTF-8 text. curl.exe (ships with Windows) is used
# first because Invoke-WebRequest gets 403'd by the site's bot protection.
function Get-FFPage {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    $tmp = Join-Path $env:TEMP "ff_calendar_page.html"
    & curl.exe -sS -L --max-time 30 --ssl-no-revoke -A $headers["User-Agent"] -H "Accept: text/html" -o $tmp $pageUrl 2>$null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $tmp)) {
      $txt = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8)
      if ($txt -match 'calendar__row' -or $txt -match 'calendar__actual') { return $txt }
    }
  }
  # Fallback: relay through allorigins if direct fetch failed or returned junk
  $proxy = "https://api.allorigins.win/raw?url=" + [uri]::EscapeDataString($pageUrl)
  try {
    $page = Invoke-WebRequest -Uri $proxy -UseBasicParsing -TimeoutSec 40 -Headers @{ "User-Agent" = $headers["User-Agent"] }
    if ($page.Content -match 'calendar__row') { return $page.Content }
  } catch { }
  # Last resort: plain Invoke-WebRequest (usually 403 but harmless to try)
  $page = Invoke-WebRequest -Uri $pageUrl -UseBasicParsing -TimeoutSec 30 -Headers $headers
  return $page.Content
}

function Strip-Html([string]$s) {
  $s = [regex]::Replace($s, '(?s)<[^>]+>', ' ')
  return ($s -replace '\s+', ' ').Trim()
}

# Scrape Actual / Forecast / Previous (plus better/worse markers) from the FF calendar page.
# Returns an array of @{ Title; Day; Time; Currency; Actual; Movement; Forecast; Previous }.
function Get-FFActualRows {
  $html = Get-FFPage

  $rows = @()
  $currentDay = ""
  $rowRe = [regex]'(?s)<tr\s+data-event-id="(\d+)"[^>]*>(.*?)</tr>'
  foreach ($m in $rowRe.Matches($html)) {
    $body = $m.Groups[2].Value

    if ($body -match 'calendar__row--day-breaker') {
      $db = [regex]::Match($body, '(?s)<td colspan="10"[^>]*>\s*(.*?)\s*</td>')
      if ($db.Success) { $currentDay = $db.Groups[1].Value.Trim() }
      continue
    }

    $titleMatch = [regex]::Match($body, '(?s)calendar__event-title">\s*(.*?)\s*</span>')
    if (-not $titleMatch.Success) { continue }
    $title = Strip-Html $titleMatch.Groups[1].Value
    if ($title -eq "") { continue }

    $actualText = ""
    $movement = ""
    $acMatch = [regex]::Match($body, '(?s)calendar__actual">(.*?)</td>')
    if ($acMatch.Success) {
      $ac = $acMatch.Groups[1].Value
      $actualText = Strip-Html $ac
      if ($ac -match 'class="[^"]*\bbetter\b')  { $movement = "better" }
      elseif ($ac -match 'class="[^"]*\bworse\b') { $movement = "worse" }
    }

    if ($actualText -eq "") { continue }

    $timeMatch = [regex]::Match($body, 'calendar__time">\s*(.*?)</td>')
    $curMatch  = [regex]::Match($body, '(?s)calendar__currency">(.*?)</td>')
    $foMatch   = [regex]::Match($body, '(?s)calendar__forecast">(.*?)</td>')
    $pvMatch   = [regex]::Match($body, '(?s)calendar__previous">(.*?)</td>')

    $rows += [pscustomobject]@{
      Title    = $title
      Day      = $currentDay
      Time     = Strip-Html $timeMatch.Groups[1].Value
      Currency = Strip-Html $curMatch.Groups[1].Value
      Actual   = $actualText
      Movement = $movement
      Forecast = Strip-Html $foMatch.Groups[1].Value
      Previous = Strip-Html $pvMatch.Groups[1].Value
    }
  }
  return $rows
}

# Match an event (feed title + ISO feed date) to a scraped actual row by title + day + currency.
function Find-Actual($event, $actualRows) {
  $needle = Strip-Html $event.title
  $cands = @($actualRows | Where-Object { $_.Title -eq $needle })
  if ($cands.Count -eq 0) { return $null }

  # Narrow by currency when we have it.
  $ccy = Strip-Html $event.country
  if ($ccy -ne "") {
    $byCur = @($cands | Where-Object { $_.Currency -ieq $ccy })
    if ($byCur.Count -gt 0) { $cands = $byCur }
  }

  # Prefer the row whose day line matches the event's date.
  try {
    $dt = [datetimeoffset]::Parse($event.date)
    $dayLine = $dt.ToString("ddd MMM d")
    $pick = @($cands | Where-Object { $_.Day -like ('*' + $dayLine + '*') })
    if ($pick.Count -gt 0) { return $pick[0] }
  } catch { }

  return $cands[0]
}

try {
  $raw = Invoke-WebRequest -Uri $feedUrl -UseBasicParsing -TimeoutSec 30 -Headers $headers

  $json = $raw.Content | ConvertFrom-Json
  if (-not $json -or @($json).Count -eq 0) { throw "Feed returned no events" }

  $actuals = @()
  $actualsNote = "no actuals"
  try {
    $actuals = Get-FFActualRows
    $actualsNote = "$($actuals.Count) actuals from page"
    if ($actuals.Count -eq 0 -and $null -eq ($actuals | Select-Object -First 1)) {
      # empty page (bot-blocked or botched fetch) - treat as scrape failure
      $actuals = @()
      $actualsNote = "page returned no rows"
    }
  } catch {
    Write-Log ("  page scrape failed (" + $_.Exception.Message + ") - keeping previous actuals")
    $actualsNote = "scrape failed, keeping previous"
  }

  # Load previous cache so already-known actuals survive transient scrape failures
  $previous = @()
  if (Test-Path $jsonPath) {
    try { $previous = Get-Content $jsonPath -Raw | ConvertFrom-Json } catch { $previous = @() }
  }
  $prevByKey = @{}
  foreach ($p in $previous) {
    if ($p.title -and $p.date) { $prevByKey[$p.title + "|" + $p.date] = $p }
  }

  foreach ($ev in $json) {
    $hit = Find-Actual $ev $actuals
    $actual = ""
    $movement = ""
    if ($hit) {
      $actual = $hit.Actual
      $movement = $hit.Movement
      # prefer the page's fresher forecast/previous when the feed has none
      if (-not $ev.forecast -and $hit.Forecast) { $ev | Add-Member -NotePropertyName "forecast" -NotePropertyValue $hit.Forecast -Force }
      if (-not $ev.previous -and $hit.Previous) { $ev | Add-Member -NotePropertyName "previous" -NotePropertyValue $hit.Previous -Force }
    } else {
      # no fresh actual from the page - keep what we already had
      $key = $ev.title + "|" + $ev.date
      if ($prevByKey.ContainsKey($key)) {
        $actual = $prevByKey[$key].actual
        $movement = $prevByKey[$key].movement
      }
    }
    $ev | Add-Member -NotePropertyName "actual"   -NotePropertyValue $actual
    $ev | Add-Member -NotePropertyName "movement" -NotePropertyValue $movement
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

  $json | ConvertTo-Json -Depth 5 | Out-File -FilePath $jsonPath -Encoding utf8

  $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  $eventsJson = ($json | ConvertTo-Json -Depth 5 -Compress)
  $escaped = $eventsJson -replace '\\', '\\' -replace "'", "'" -replace "<!--", "<\!--"
  $js = "/* auto-generated by update-news.ps1. Do not edit. */`nwindow.__FF_FETCHED_AT = '$stamp';`nwindow.__FF_META = { fetchedAt: '$stamp' };`nwindow.__FF_EVENTS = $escaped;`n"
  [System.IO.File]::WriteAllText($jsPath, $js, $utf8NoBom)

  $count = @($json).Count
  $actualCount = @($json | Where-Object { $_.actual -ne "" }).Count
  Write-Log "OK  fetched $count events ($actualCount with actual) - $actualsNote - wrote news.json + data-embedded.js"
}
catch {
  $msg = "FAIL " + $_.Exception.Message
  Write-Log $msg
  Add-Content -Path $logPath -Value ("  URL: " + $feedUrl)
  exit 1
}