# ============================================================================
#  enable-pages.ps1 - Turn on GitHub Pages for the target repo (best effort).
#  Called by publish.bat after a successful push. Pulls the GitHub token from
#  the same credential store git just used to push (no secrets are stored here),
#  then asks the GitHub API to serve the repo from `main` at the site root.
#  Safe to run repeatedly: an already-enabled site reports success.
# ============================================================================
param(
  [string]$Owner  = 'shamoug',
  [string]$Repo   = 'gamarc',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

function Get-GitHubToken {
  # Feed `git credential fill` via a redirected stdin file (LF-terminated) — the
  # one method that works reliably across PowerShell versions on Windows.
  $tin  = [IO.Path]::GetTempFileName()
  $tout = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tin, "protocol=https`nhost=github.com`n`n")
    $p = Start-Process -FilePath git -ArgumentList 'credential', 'fill' `
      -RedirectStandardInput $tin -RedirectStandardOutput $tout -NoNewWindow -Wait -PassThru
    if ($p.ExitCode -ne 0) { return $null }
    $line = Get-Content $tout | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -replace '^password=', '')
  } finally {
    Remove-Item $tin, $tout -ErrorAction SilentlyContinue
  }
}

$token = Get-GitHubToken
if (-not $token) {
  Write-Host "[!] No saved GitHub token found - enable Pages once at https://github.com/$Owner/$Repo/settings/pages (Source: $Branch, /root)."
  exit 0
}

$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = 'application/vnd.github+json'
  'User-Agent'           = 'nexus-arcade-publish'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$body = @{ source = @{ branch = $Branch; path = '/' } } | ConvertTo-Json -Compress
$uri = "https://api.github.com/repos/$Owner/$Repo/pages"

try {
  Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body -ContentType 'application/json' | Out-Null
  Write-Host "[OK] GitHub Pages enabled."
} catch {
  $code = 0
  try { $code = [int]$_.Exception.Response.StatusCode } catch {}
  if ($code -eq 409) {
    Write-Host "[=] GitHub Pages was already enabled."
  } else {
    Write-Host "[!] Could not auto-enable Pages (HTTP $code). Enable once at https://github.com/$Owner/$Repo/settings/pages (Source: $Branch, /root)."
  }
}
