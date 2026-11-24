$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop belum terpasang.' }
docker compose version | Out-Null
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git belum terpasang.' }
if (-not (Test-Path 'vendor/tiktok-dm-api/Dockerfile')) {
  New-Item -ItemType Directory -Force -Path 'vendor' | Out-Null
  git clone --depth 1 https://github.com/KreatixTeam/tiktok-dm-api.git vendor/tiktok-dm-api
}
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
$lines = [System.Collections.Generic.List[string]]::new()
(Get-Content '.env') | ForEach-Object { [void]$lines.Add($_) }
function Set-EnvSecret([string]$Name, [string]$Placeholder, [int]$Bytes) {
  $current = ($lines | Where-Object { $_.StartsWith($Name + '=') } | Select-Object -First 1)
  if (-not $current -or $current -eq ($Name + '=' + $Placeholder)) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($buffer)
    $rng.Dispose()
    $value = ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
    $replacement = $Name + '=' + $value
    if ($current) { $lines[$lines.IndexOf($current)] = $replacement } else { [void]$lines.Add($replacement) }
  }
}
Set-EnvSecret 'SESSION_SECRET' 'replace-with-at-least-96-hex-characters' 48
Set-EnvSecret 'ADMIN_SETUP_TOKEN' 'replace-with-a-random-one-time-setup-token' 36
[System.IO.File]::WriteAllLines((Join-Path $Root '.env'), $lines.ToArray(), [System.Text.UTF8Encoding]::new($false))
Write-Host 'Membangun DAFZZ dan TikTok bridge...'
docker compose build
Write-Host 'Menginisialisasi bridge...'
docker compose run --rm tiktok-bridge init
Write-Host 'Menyalakan layanan...'
docker compose up -d
Write-Host 'Buka http://127.0.0.1:3000/admin untuk membuat administrator.'
Write-Host 'Token setup admin sekali pakai:'
(Select-String -Path '.env' -Pattern '^ADMIN_SETUP_TOKEN=').Line.Split('=',2)[1]
Write-Host 'Token bridge:'
docker compose exec -T tiktok-bridge token
Write-Host 'Webhook secret:'
docker compose exec -T tiktok-bridge webhook-secret
Write-Host 'Simpan ketiga nilai rahasia tersebut secara privat. Token setup hanya dipakai saat membuat admin pertama.'
