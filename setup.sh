#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "Docker belum terpasang."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 belum tersedia."; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Git belum terpasang."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3 belum terpasang."; exit 1; }

if [ ! -f vendor/tiktok-dm-api/Dockerfile ]; then
  mkdir -p vendor
  rm -rf vendor/tiktok-dm-api
  git clone --depth 1 https://github.com/KreatixTeam/tiktok-dm-api.git vendor/tiktok-dm-api
fi

if [ ! -f .env ]; then cp .env.example .env; fi
python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('.env')
lines = p.read_text().splitlines() if p.exists() else []
values = {}
for line in lines:
    if line and not line.lstrip().startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        values[k] = v
for key, generator, placeholder in [
    ('SESSION_SECRET', lambda: secrets.token_hex(48), 'replace-with-at-least-96-hex-characters'),
    ('ADMIN_SETUP_TOKEN', lambda: secrets.token_urlsafe(36), 'replace-with-a-random-one-time-setup-token'),
]:
    if not values.get(key) or values[key] == placeholder:
        value = generator()
        found = False
        for i, line in enumerate(lines):
            if line.startswith(key + '='):
                lines[i] = key + '=' + value
                found = True
                break
        if not found:
            lines.append(key + '=' + value)
p.write_text('\n'.join(lines).rstrip() + '\n')
PY
chmod 600 .env 2>/dev/null || true

echo "Membangun aplikasi DAFZZ dan bridge TikTok..."
docker compose build

echo "Menginisialisasi penyimpanan bridge..."
docker compose run --rm tiktok-bridge init

echo "Menyalakan DAFZZ..."
docker compose up -d

echo ""
echo "DAFZZ berjalan di http://127.0.0.1:3000"
echo "Panel konfigurasi: http://127.0.0.1:3000/admin"
echo "Token setup admin sekali pakai (masukkan saat membuat admin pertama):"
grep '^ADMIN_SETUP_TOKEN=' .env | cut -d= -f2-
echo ""
echo "Token bridge:"
docker compose exec -T tiktok-bridge token || true
echo "Webhook secret:"
docker compose exec -T tiktok-bridge webhook-secret || true
echo "Simpan ketiga nilai rahasia tersebut secara privat. Token setup hanya diperlukan sekali."
echo "Selanjutnya ikuti README.md bagian IMPOR AKUN TIKTOK."
