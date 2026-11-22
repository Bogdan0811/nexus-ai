<#
  NEXUS AI - local static dev server for Windows (no Node.js required).

  Run with PowerShell (from the project folder):
      powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
      powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1 -Port 8081 -Open

  Then open http://localhost:8080/stage.html (or index.html, client.html, bank.html).

  Notes:
  - Serves the folder this script lives in (override with -Root <path>).
  - http://localhost is a secure context, so the microphone and SpeechRecognition work.
  - Every response has Cache-Control: no-store, so rehearsals never run stale JS/CSS.
  - Path traversal (.., encoded slashes, drive letters, ADS) and dot-files (.env, .git) are refused.
  - /api/chat is answered locally with {"ok":false,...}: the pages switch to the built-in offline
    engine, exactly as on a deploy without an API key. The real LLM only runs on the deployed URL.
  - Press Ctrl+C to stop.
#>
param(
  [int]$Port = 8080,
  [string]$Root = '',
  [switch]$Open
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = (Get-Location).Path }
$RootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
$RootPrefix = $RootFull + '\'

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.map' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.txt' = 'text/plain; charset=utf-8'
  '.md' = 'text/plain; charset=utf-8'
  '.csv' = 'text/csv; charset=utf-8'
  '.xml' = 'application/xml; charset=utf-8'
  '.svg' = 'image/svg+xml'
  '.png' = 'image/png'
  '.jpg' = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif' = 'image/gif'
  '.webp' = 'image/webp'
  '.avif' = 'image/avif'
  '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf' = 'font/ttf'
  '.otf' = 'font/otf'
  '.mp3' = 'audio/mpeg'
  '.wav' = 'audio/wav'
  '.ogg' = 'audio/ogg'
  '.m4a' = 'audio/mp4'
  '.mp4' = 'video/mp4'
  '.webm' = 'video/webm'
  '.wasm' = 'application/wasm'
  '.pdf' = 'application/pdf'
}

function Send-Bytes($Response, [int]$Status, [string]$ContentType, [byte[]]$Bytes, [bool]$HeadOnly) {
  $Response.StatusCode = $Status
  $Response.ContentType = $ContentType
  $Response.AddHeader('Cache-Control', 'no-store, must-revalidate')
  $Response.AddHeader('Pragma', 'no-cache')
  $Response.AddHeader('X-Content-Type-Options', 'nosniff')
  if ($HeadOnly) { return }
  $Response.ContentLength64 = $Bytes.Length
  if ($Bytes.Length -gt 0) { $Response.OutputStream.Write($Bytes, 0, $Bytes.Length) }
}

function Send-Text($Response, [int]$Status, [string]$Text, [string]$ContentType = 'text/plain; charset=utf-8', [bool]$HeadOnly = $false) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Send-Bytes $Response $Status $ContentType $bytes $HeadOnly
}

# URL path -> absolute file path inside $RootFull, or $null when the path is not allowed
function Resolve-StaticPath([string]$UrlPath) {
  try {
    $rel = [System.Uri]::UnescapeDataString($UrlPath)
    if ($rel.IndexOf([char]0) -ge 0) { return $null }
    $rel = $rel.Replace('/', '\').TrimStart('\')
    if ($rel -eq '') { $rel = 'index.html' }
    foreach ($seg in $rel.Split('\')) {
      if ($seg -eq '') { continue }
      if ($seg.StartsWith('.') -or $seg.Contains(':')) { return $null }
    }
    $full = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RootFull, $rel))
    if (-not $full.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    if ([System.IO.Directory]::Exists($full)) { $full = [System.IO.Path]::Combine($full, 'index.html') }
    return $full
  } catch {
    return $null
  }
}

function Invoke-Request($ctx) {
  $req = $ctx.Request
  $res = $ctx.Response
  $status = 200
  try {
    $method = $req.HttpMethod
    $isHead = ($method -eq 'HEAD')
    $path = $req.Url.AbsolutePath

    # Local stand-in for the serverless /api/chat: no LLM here, pages use the offline engine
    if ($path -eq '/api/chat' -or $path -eq '/api/chat/') {
      if ($method -eq 'GET' -or $isHead) {
        Send-Text $res 200 '{"ok":false,"model":null,"reason":"local_static_server"}' 'application/json; charset=utf-8' $isHead
      } elseif ($method -eq 'POST') {
        $status = 503
        Send-Text $res 503 '{"error":"not_configured","message":"Local static server: LLM is not available, the built-in offline engine is used"}' 'application/json; charset=utf-8'
      } else {
        $status = 405
        $res.AddHeader('Allow', 'GET, POST')
        Send-Text $res 405 '{"error":"method_not_allowed"}' 'application/json; charset=utf-8'
      }
      return
    }

    if ($method -ne 'GET' -and -not $isHead) {
      $status = 405
      $res.AddHeader('Allow', 'GET, HEAD')
      Send-Text $res 405 'Method Not Allowed'
      return
    }

    $full = Resolve-StaticPath $path
    if ($null -eq $full) {
      $status = 403
      Send-Text $res 403 'Forbidden' 'text/plain; charset=utf-8' $isHead
      return
    }
    if (-not [System.IO.File]::Exists($full)) {
      $status = 404
      Send-Text $res 404 ('Not found: ' + $path) 'text/plain; charset=utf-8' $isHead
      return
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $ct = $Mime[$ext]
    if (-not $ct) { $ct = 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    Send-Bytes $res 200 $ct $bytes $isHead
  } catch {
    $status = 500
    Write-Host ('  error: ' + $_.Exception.Message) -ForegroundColor Red
    try { Send-Text $res 500 'Internal Server Error' } catch { }
  } finally {
    try { $res.OutputStream.Close() } catch { }
    try { $res.Close() } catch { }
    Write-Host ('{0} {1,-4} {2} {3}' -f (Get-Date -Format 'HH:mm:ss'), $req.HttpMethod, $status, $req.Url.PathAndQuery)
  }
}

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host ("Cannot listen on $prefix - " + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Is the port already in use? Try another one:  .\serve.ps1 -Port 8081' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'NEXUS AI dev server' -ForegroundColor Cyan
Write-Host ('  root : ' + $RootFull)
Write-Host ('  url  : ' + $prefix)
foreach ($page in @('stage.html', 'index.html', 'client.html', 'bank.html')) {
  if (Test-Path -LiteralPath (Join-Path $RootFull $page)) { Write-Host ('         ' + $prefix + $page) }
}
Write-Host '  stop : Ctrl+C'
Write-Host ''

if ($Open) {
  $startPage = 'index.html'
  if (Test-Path -LiteralPath (Join-Path $RootFull 'stage.html')) { $startPage = 'stage.html' }
  try { Start-Process ($prefix + $startPage) } catch { }
}

try {
  while ($listener.IsListening) {
    $async = $listener.BeginGetContext($null, $null)
    # wait in short slices so Ctrl+C is handled promptly
    while (-not $async.AsyncWaitHandle.WaitOne(500)) {
      if (-not $listener.IsListening) { break }
    }
    if (-not $listener.IsListening) { break }
    $ctx = $null
    try { $ctx = $listener.EndGetContext($async) } catch { continue }
    if ($null -ne $ctx) { Invoke-Request $ctx }
  }
} finally {
  try { if ($listener.IsListening) { $listener.Stop() } } catch { }
  try { $listener.Close() } catch { }
  Write-Host 'Server stopped.'
}
