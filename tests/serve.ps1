# 로컬 시험용 정적 파일 서버 (http://localhost:8765)
# 사용: powershell -ExecutionPolicy Bypass -File tests\serve.ps1
# 프로젝트 폴더를 그대로 제공합니다. 종료: Ctrl+C
$root = Split-Path -Parent $PSScriptRoot
$port = 8765
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.sql' = 'text/plain; charset=utf-8'; '.json' = 'application/json'; '.md' = 'text/plain; charset=utf-8'; '.svg' = 'image/svg+xml'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$port/"
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $path))
      if ($file.StartsWith($root) -and [IO.File]::Exists($file)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $ctx.Response.ContentType = $(if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' })
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $ctx.Response.StatusCode = 404
      }
    } catch {
      Write-Host "request error: $($_.Exception.Message)"
    } finally {
      try { $ctx.Response.Close() } catch { }
    }
  }
} finally { $listener.Stop() }
