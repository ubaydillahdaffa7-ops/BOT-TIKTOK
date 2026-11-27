DAFZZ-TOOLS + TIKTOK BOT
========================

Website DAFZZ-TOOLS mempertahankan 300 tools lama dalam enam kategori, masing-masing 50. Paket ini menambahkan kategori ke-7 AI & Bot Commands berisi satu Chat AI unggulan, 50 AI/Local Tools, dan 50 Bot Commands. Total katalog menjadi 401 entri.

Bot Commands disimpan terpusat di bot-commands.js. Sebagian perintah membutuhkan layanan internet. Bridge TikTok bawaan hanya mendukung pesan teks; perintah .pin menghasilkan tautan pencarian gambar, sedangkan .s dan .toimg belum dapat memproses lampiran media sampai Bridge mendukung upload/download media.

Untuk instalasi bot, integrasi TikTok, panel admin, AI fallback, domain HTTPS, dan halaman download, baca README.md pada folder utama.

Fungsi browser dari website dipakai kembali pada halaman /run/<token>. Hasil yang dibuat melalui fungsi result standar diunggah sementara ke server agar tautan unduhan dapat dibalas melalui platform chat asal. Tautan hasil dapat dikirim kembali ke TikTok, Telegram, atau WhatsApp sesuai chat asal. Lampiran media langsung belum didukung oleh konektor chat saat ini.


KONFIGURASI 3 PLATFORM
- TikTok: tetap memakai DM Bridge dan webhook yang sudah ada.
- Telegram: masukkan token BotFather di /admin > Bot Telegram. Bot memakai long polling. Pengguna harus menekan Start pada chat bot. Saat diaktifkan, webhook lama pada token yang sama akan dihapus agar polling tidak bentrok. Jalankan satu instance aplikasi saja untuk satu token.
- WhatsApp: konektor Baileys (bukan API resmi WhatsApp) memakai pairing code atau QR. Tautkan hanya akun milik sendiri. Sesi disimpan di APP_DATA_DIR/whatsapp-auth. Pada hosting yang penyimpanannya sementara, gunakan disk persisten agar sesi tidak hilang saat redeploy.

PERINTAH UMUM DI KETIGA PLATFORM
- .menu: menu 7 kategori dan 401 entri.
- .help: bantuan.
- .commands: 50 perintah tambahan.
- .ai pertanyaan: mengirim pertanyaan ke AI.
- .slug: membuka halaman tool di browser; hasilnya dikirim kembali ke chat asal.
- Telegram dan WhatsApp saat ini menerima pesan pribadi. Pesan grup sengaja tidak diproses.

AI OTOMATIS
Urutan percobaan: Pollinations legacy endpoint yang dipakai website DAFZZ, Kilo Gateway Auto Free tanpa autentikasi, LLM7 anonim (akses keyless dapat berubah dan batas anonim tidak dijamin), lalu AI Horde anonim (prioritas antrean paling rendah). Semua akses gratis/anonim memiliki batas, antrean, dan ketergantungan pada penyedia. Kilo menyebut Auto Free tidak memerlukan kredit dan dapat merutekan prompt ke penyedia yang mencatat prompt/hasil; jangan kirim data pribadi atau rahasia. AI Horde dapat lambat atau tidak memiliki worker yang cocok. Jangan kirim password, OTP, token, cookie, atau informasi sensitif ke AI pihak ketiga.

PERSETUJUAN RISIKO
Saat pertama mengaktifkan platform, admin wajib menekan Paham pada masing-masing dari lima peringatan sebelum tombol lanjut aktif. Persetujuan ini tidak menghilangkan risiko pembatasan akun, kebocoran kredensial, pemrosesan data pihak ketiga, atau gangguan layanan.


CATATAN KHUSUS RENDER FREE
Render Free dapat sleep setelah 15 menit tanpa trafik masuk dan tidak menyediakan persistent disk pada paket gratis. Saat sleep, koneksi Telegram/WhatsApp dapat terputus. File konfigurasi lokal dan sesi WhatsApp Baileys dapat hilang saat service di-restart atau di-deploy ulang; jangan diasumsikan tersimpan permanen. Upload ke GitHub saja tidak membuat bot aktif 24 jam. Gunakan host yang selalu aktif dan storage persisten untuk penggunaan jangka panjang. Dokumentasi Render: https://render.com/docs/free dan https://render.com/docs/disks.
