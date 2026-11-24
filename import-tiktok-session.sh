#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  echo "Pemakaian: import-tiktok-session.sh USERNAME_TIKTOK"
  exit 2
fi
if [ ! -f inbox.fetch ] || [ ! -f socket.fetch ]; then
  echo "Letakkan dua hasil ekspor Chrome bernama inbox.fetch dan socket.fetch di folder proyek."
  exit 2
fi
chmod 600 inbox.fetch socket.fetch

echo "Menghentikan bridge untuk impor sesi..."
docker compose stop tiktok-bridge

echo "Mengimpor sesi akun milikmu..."
python3 vendor/tiktok-dm-api/scripts/bundle-captures.py inbox.fetch socket.fetch \
  | docker compose run --rm -T tiktok-bridge import --stdin --username "$USERNAME"

rm -f inbox.fetch socket.fetch
docker compose up -d tiktok-bridge app

echo "Sesi berhasil diproses. Token bridge dan webhook secret:"
echo "API TOKEN:"
docker compose exec -T tiktok-bridge token
echo "WEBHOOK SECRET:"
docker compose exec -T tiktok-bridge webhook-secret
echo "Masukkan kedua nilai ke /admin. Jangan bagikan nilai ini kepada siapa pun."
