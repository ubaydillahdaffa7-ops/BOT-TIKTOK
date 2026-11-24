param(
  [Parameter(Mandatory=$true, Position=0)]
  [ValidateNotNullOrEmpty()]
  [string]$Username
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
if (-not (Test-Path 'inbox.fetch')) { throw 'File inbox.fetch tidak ditemukan di folder proyek.' }
if (-not (Test-Path 'socket.fetch')) { throw 'File socket.fetch tidak ditemukan di folder proyek.' }
if (-not (Test-Path 'vendor/tiktok-dm-api/scripts/bundle-captures.py')) { throw 'Sumber bridge belum terpasang. Jalankan setup.ps1 terlebih dahulu.' }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python belum terpasang.' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop belum terpasang.' }
Write-Host 'Menghentikan bridge sementara...'
docker compose stop tiktok-bridge
if ($LASTEXITCODE -ne 0) { throw 'Gagal menghentikan bridge.' }
Write-Host 'Mengimpor sesi akun ke volume privat bridge...'
python vendor/tiktok-dm-api/scripts/bundle-captures.py inbox.fetch socket.fetch | docker compose run --rm -T tiktok-bridge import --stdin --username $Username
if ($LASTEXITCODE -ne 0) {
  docker compose up -d tiktok-bridge app | Out-Null
  throw 'Impor gagal. File capture lokal tidak dihapus. Periksa format dan jalankan ulang setelah memperbaiki masalah.'
}
Remove-Item 'inbox.fetch','socket.fetch' -Force
Write-Host 'Impor berhasil. File capture lokal telah dihapus.'
docker compose up -d tiktok-bridge app
if ($LASTEXITCODE -ne 0) { throw 'Sesi sudah diimpor, tetapi bridge gagal dinyalakan ulang. Jalankan docker compose up -d.' }
Write-Host 'API token:'
docker compose exec -T tiktok-bridge token
Write-Host 'Webhook secret:'
docker compose exec -T tiktok-bridge webhook-secret
Write-Host 'Masukkan kedua nilai tersebut pada halaman Admin DAFZZ.'
