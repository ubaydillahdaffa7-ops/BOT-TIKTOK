# DAFZZ Multi-Platform Bot

Paket gabungan DAFZZ-TOOLS, backend bot TikTok, Telegram, WhatsApp, panel konfigurasi, halaman pemrosesan file, dan halaman unduhan.

## Isi paket

- file frontend di folder utama berisi website DAFZZ-TOOLS dari sumber pengguna, dengan tema dan navigasi aslinya tetap dipakai.
- `tools.json` adalah katalog sumber: 401 entri. Enam kategori lama tetap memiliki 50 tools per kategori; kategori ke-7 berisi 1 Chat AI unggulan, 50 AI/Local Tools, dan 50 Bot Commands.
- `admin.html`, `admin.css`, dan `admin.js` adalah panel konfigurasi bergaya DAFZZ dengan tiga menu terpisah: TikTok, Telegram, dan WhatsApp.
- `bot.html`, `bot.css`, dan `bot-dashboard.js` menyediakan dashboard Menu Bot dengan status TikTok, Telegram, WhatsApp, statistik, penyimpanan, AI, dan log aktivitas.
- `bot-commands.js` menyimpan kode 50 Bot Commands tambahan serta handler chat untuk seluruh 25 AI Tools dan 25 Local Tools baru.
- file `server.js`, `bot.js`, `connectors.js`, `store.js`, `security.js`, `ai.js` berisi backend bersama, webhook TikTok, polling Telegram, konektor WhatsApp Baileys, penyimpanan, dan AI fallback. `admin-info.js` mengaktifkan panel Info Admin pada ikon D.
- `docker-compose.yml` menjalankan aplikasi DAFZZ dan TikTok DM bridge dalam jaringan privat.
- file `setup.sh`, `setup.ps1`, `import-tiktok-session.sh`, `import-tiktok-session.ps1` berisi skrip instalasi awal dan impor sesi TikTok.

## Yang sudah disiapkan

1. Perintah `.menu`, `.help`, `.start`, `.info`, dan `.cancel`.
2. Perintah kategori `.ai-bot`, `.foto`, `.teks`, `.file`, `.konverter`, `.keamanan`, dan `.web`.
3. Seluruh slug tools lama tetap dapat dipanggil dengan awalan titik dan membuka sesi tool website. Seluruh 50 AI/Local Tools baru juga dapat dipanggil langsung dari chat bot, misalnya `.ai-story ide cerita`, `.sentence-counter teks`, atau `.json-to-typescript {\"nama\":\"DAFZZ\"}`.
4. Kode untuk 50 Bot Commands dan 50 AI/Local Tools baru dikumpulkan dalam `bot-commands.js`. Tool AI memanggil AI sisi server yang sama; tool lokal diproses di bot tanpa API key. Tombol katalog menyiapkan teks perintah agar mudah disalin.
5. Saat fungsi website menghasilkan file atau teks melalui fungsi hasil standar DAFZZ, hasil dikirim ke server. Server menyimpan file sementara selama 24 jam dan mengirim tautan unduhan kembali ke platform chat asal.
6. Panel admin memiliki pengaturan token bridge, webhook secret, alamat publik, kontrol bot ON/OFF, dan AI fallback.
7. Menu Bot menampilkan tiga pintu konfigurasi, statistik pesan, balasan bot/AI, sesi tool, status koneksi, penyimpanan, dan log aktivitas.
8. Perintah `.ai pertanyaan` dan pesan yang tidak dikenali diarahkan ke Pollinations. Jika gagal, sistem mencoba Kilo Auto Free, LLM7 anonim, lalu AI Horde anonim. Mode AI manual juga tersedia; jika endpoint manual gagal, tiga gateway cadangan tetap dicoba. Tidak ada jaminan kuota atau uptime layanan gratis.
9. Sesi tool dan tautan unduhan memiliki masa berlaku 24 jam. File sementara dibersihkan secara berkala.

## Batasan integrasi TikTok yang perlu dibaca

Konektor dalam paket ini menggunakan proyek pihak ketiga `KreatixTeam/tiktok-dm-api`. Konektor itu tidak resmi, eksperimental, bukan produk TikTok, dan memakai endpoint reverse-engineered yang dapat berubah tanpa pemberitahuan.

Menurut dokumentasi upstream saat paket ini dibuat, konektor hanya membaca dan mengirim pesan teks pada percakapan satu lawan satu yang sudah ada. Konektor belum mendukung login QR, pembaruan sesi otomatis, permintaan DM baru, grup, pengiriman atau penerimaan media, dan pesan ke username sembarang. Akun yang belum mempunyai percakapan yang sesuai tidak bisa dihubungi melalui endpoint ini. Pengiriman dapat berstatus `unknown` bila konfirmasi tidak tersedia.

Karena konektor chat saat ini berfokus pada teks, pengguna membuka halaman DAFZZ untuk memilih file dan menjalankan tool. Pemrosesan yang memang dibuat lokal oleh website tetap berlangsung di browser; hasilnya dikirim sementara ke server agar tautan unduhan dapat dikirim kembali ke chat asal. Pengiriman lampiran langsung lewat chat belum diaktifkan.

Sambungan ini bukan jaminan stabilitas. Perubahan protokol TikTok, autentikasi ulang, pembatasan akun, atau perubahan bridge dapat membuat bot berhenti menerima/mengirim DM.

## Menjalankan secara lokal

Prasyarat:

- Docker Desktop dengan Docker Compose v2.
- Git.
- Python 3 untuk skrip impor akun.
- Koneksi internet saat mengambil bridge dan library eksternal.

### Linux / VPS

```bash
bash setup.sh
```

### Windows PowerShell

Buka PowerShell dari folder hasil ekstrak, lalu jalankan:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1
```

Skrip mengunduh sumber bridge upstream ke `vendor/tiktok-dm-api`, membangun container, menginisialisasi database bridge, dan menjalankan aplikasi. Kode bridge tidak disalin ke dalam ZIP ini; skrip mengambilnya dari repositori upstream saat setup. Karena itu setup memerlukan internet dan GitHub harus dapat diakses dari mesin hosting.

Sesudah aplikasi hidup, buka:

- Website DAFZZ: `http://127.0.0.1:4010`
- Dashboard bot: `http://127.0.0.1:4010/bot`
- Panel konfigurasi: `http://127.0.0.1:4010/admin`

Skrip setup menampilkan token setup admin sekali pakai di terminal. Masukkan token itu dan buat password administrator minimal 12 karakter pada panel. Token ini mencegah orang lain mengambil alih panel sebelum admin pertama dibuat.

## Menyiapkan domain HTTPS

Link tool dan unduhan yang dikirim lewat DM harus memakai URL publik HTTPS, bukan `localhost`.

1. Siapkan domain/subdomain dan arahkan DNS A/AAAA ke VPS.
2. Buka port 80 dan 443 pada firewall VPS.
3. Edit `.env`:

```env
NODE_ENV=production
APP_PUBLIC_URL=https://bot.domain-kamu.com
PUBLIC_DOMAIN=bot.domain-kamu.com
SESSION_SECRET=isi-dengan-string-acak-panjang
```

4. Jalankan Caddy dengan sertifikat HTTPS otomatis:

```bash
docker compose --profile https up -d --build
```

5. Buka `https://bot.domain-kamu.com/admin` dan masukkan URL publik yang sama pada pengaturan DAFZZ.

Untuk tes lokal tanpa domain, biarkan `NODE_ENV=development`, kosongkan `APP_PUBLIC_URL` dan `PUBLIC_DOMAIN`, lalu gunakan `http://127.0.0.1:4010`. Perintah tool dari TikTok tidak akan mendapatkan link yang dapat dibuka orang lain sampai URL HTTPS publik diisi.

## Menghubungkan akun TikTok milik sendiri

Panel admin tidak meminta password TikTok dan tidak melakukan login otomatis. Konektor upstream memerlukan ekspor sesi satu kali dari Chrome desktop pada akun yang kamu miliki atau kelola.

1. Login ke TikTok melalui Chrome desktop dan buka Inbox.
2. Buka Developer Tools, tab Network, lalu refresh Inbox.
3. Cari request POST ke `https://im-api.tiktok.com/v2/message/get_by_user_init`, lalu pilih Copy as fetch (Node.js). Simpan hasilnya sebagai `inbox.fetch` di folder proyek.
4. Pindah ke filter WS. Cari koneksi `wss://im-ws.tiktok.com/ws/v2` yang memuat `Web-Sdk-Ms-Token`, lalu ekspor sebagai `socket.fetch`.
5. Lindungi dua file tersebut. Jangan kirim ke ChatGPT, jangan unggah ke converter online, dan jangan masukkan ke GitHub.
6. Jalankan skrip impor sesuai sistem operasi:

Linux / VPS:
```bash
bash import-tiktok-session.sh USERNAME_TIKTOK
```

Windows PowerShell:
```powershell
.\import-tiktok-session.ps1 -Username USERNAME_TIKTOK
```

Skrip mengimpor sesi ke volume privat bridge, lalu menghapus file ekspor lokal setelah impor berhasil. Jika impor gagal, file tetap ada agar kamu bisa membaca kesalahan dan mencoba lagi.

7. Skrip menampilkan API token dan webhook secret di terminal. Buka `/admin`, masukkan keduanya pada bagian konfigurasi bridge, lalu simpan.
8. Tekan **Uji koneksi TikTok**. Status harus menunjukkan bridge siap. Ini hanya memeriksa kesiapan bridge; tes DM nyata tetap diperlukan.
9. Dari akun TikTok lain yang sudah pernah memiliki percakapan dengan akun bot, kirim `.menu` untuk tes. Bridge membatasi pengiriman ke percakapan yang telah ada.

Jangan pernah menempelkan `inbox.fetch`, `socket.fetch`, API token, webhook secret, cookie, atau password di percakapan ini atau di repository publik. Data bridge berisi sesi akun dan riwayat pesan; batasi akses server dan backup.

## Perintah bot

- `.menu` — 7 kategori dan jumlah tools.
- `.foto` — 50 tools Foto & Desain.
- `.teks` — 50 tools Teks & Data.
- `.file` — 50 tools Dokumen & File.
- `.konverter` — 50 tools Konverter & Kalkulator.
- `.keamanan` — 50 tools Keamanan & Privasi.
- `.web` — 50 tools Web & Developer.
- `.ai-bot` — kategori Chat AI, 50 AI/Local Tools, dan 50 Bot Commands.
- `.commands` — daftar 50 perintah Bot Commands.
- Perintah tambahan antara lain `.pin`, `.anime`, `.pokemon`, `.github`, `.weather`, `.earthquake`, `.iss`, `.trivia`, `.rps`, `.dog`, `.cat`, `.recipe`, `.holidays`, dan `.define`.
- `.pin` mengambil hingga 10 tautan gambar dari Wikimedia Commons (atau tautan pencarian cadangan); Bridge mengirim tautan teks, bukan lampiran foto.
- `.s` dan `.toimg` dikenali, tetapi belum dapat memproses media karena Bridge bawaan tidak mendukung lampiran.
- `.help`, `.start`, `.info`, `.cancel`.
- Nama tool langsung dengan titik di depan, misalnya `.potong-gambar` atau `.sentence-counter`.

Sistem ini tidak membuat alur tanya-jawab berbeda untuk setiap parameter secara otomatis. Website sumber tetap meminta input melalui kontrolnya sendiri, termasuk unggahan file, ukuran, teks, pilihan, dan parameter lain. Validasi tiap tool mengikuti implementasi aslinya.

## AI otomatis Pollinations dan tiga cadangan gratis

Mode otomatis memakai endpoint legacy Pollinations yang saat ini dipakai website DAFZZ. Jika gagal, server mencoba secara berurutan:

1. Kilo AI Gateway `kilo-auto/free` — model gratis yang dapat digunakan tanpa API key milik pengguna.
2. LLM7 — akses anonim tanpa token; ketersediaan model dan batas keyless dapat berubah.
3. AI Horde — memakai identitas anonim bawaan `0000000000`; pengguna anonim memiliki prioritas antrean paling rendah.

Perintah chat: `.ai pertanyaan kamu`. AI juga menjadi fallback untuk pesan yang bukan perintah. Tidak ada gateway gratis yang menjamin selalu online atau tidak berubah. Jangan kirim password, OTP, token, cookie, atau data rahasia ke AI pihak ketiga. Kilo memperingatkan bahwa rute gratis dapat menggunakan provider hulu yang menyimpan prompt atau hasil.

Panel `/admin` juga menyediakan mode AI manual untuk endpoint OpenAI-compatible, nama model, dan API key milik pengguna. Key manual disimpan hanya di server. Endpoint utama Pollinations: `https://text.pollinations.ai/openai`, alias model `openai`. Pollinations juga telah menyediakan dokumentasi API generasi baru yang menggunakan autentikasi; bila endpoint legacy berubah, atur endpoint/model/key sesuai dokumentasi terbaru. Dokumentasi: https://gen.pollinations.ai/docs.

## Koneksi Telegram dan WhatsApp

**Telegram:** Buat token melalui akun resmi [@BotFather](https://t.me/BotFather), masukkan token ke `/admin` → Bot Telegram, periksa, lalu aktifkan. Konektor menggunakan Telegram Bot API long polling. Saat diaktifkan, webhook lama pada token yang sama dihapus agar `getUpdates` dapat digunakan. Pengguna perlu menekan Start pada chat bot. Grup tidak diproses. Jalankan satu instance aplikasi untuk token tersebut; dua poller akan saling memutus koneksi.

**WhatsApp:** memakai Baileys 6.7.x dengan pairing code atau QR. Baileys adalah library komunitas dan bukan produk atau integrasi resmi WhatsApp. Tautkan hanya akun yang kamu miliki; akun dapat terkena pembatasan. Sesi disimpan di `APP_DATA_DIR/whatsapp-auth`. Jalankan satu instance aplikasi saat WhatsApp aktif. Pesan grup diabaikan; tes balasan dari nomor lain ke nomor yang tertaut.

Ketika pertama kali mengaktifkan setiap platform, panel menampilkan lima peringatan. Admin harus menekan tombol **Paham** pada kelima peringatan sebelum tombol lanjut aktif. Persetujuan tidak menghilangkan risiko pembatasan akun, kebocoran data, atau gangguan penyedia.

## Menu Info Admin dan preview link

Ikon D kecil di kiri atas membuka panel Info Admin yang menampilkan owner, dua tautan proyek, tombol laporan bug lewat Gmail, dan TikTok DM. Metadata Open Graph/Twitter dan gambar `og-preview.png` 1200×630 disertakan untuk preview tautan beranda pada aplikasi yang mendukungnya.

## Deploy ke Render

Untuk menjalankan Node service, atur build command `npm install` dan start command `npm start`, lalu isi environment berikut: `APP_PUBLIC_URL` (domain HTTPS), `SESSION_SECRET` (acak dan panjang), `ADMIN_SETUP_TOKEN` (acak sekali pakai untuk membuat admin), `APP_DATA_DIR` (direktori data), serta `TIKTOK_BRIDGE_URL` yang dapat dijangkau bila TikTok dipakai. Telegram dan WhatsApp diatur melalui panel `/admin`; token tidak perlu dimasukkan ke GitHub.

**Catatan Render Free:** layanan dapat sleep setelah tidak ada trafik masuk dan paket gratis tidak menyediakan persistent disk. Saat sleep, koneksi Telegram/WhatsApp dapat terputus. File konfigurasi lokal dan sesi WhatsApp dapat hilang saat service di-restart atau di-deploy ulang; jangan diasumsikan tersimpan permanen. Upload ke repository saja tidak membuat bot aktif 24 jam. Gunakan host yang selalu menyala dan storage persisten untuk bot yang harus berjalan terus. Lihat https://render.com/docs/free dan https://render.com/docs/disks.

## Data dan penyimpanan

- Data admin, sesi tool, token konfigurasi, dan indeks file tersimpan pada volume Docker `dafzz-data`.
- Sesi tool dan link file berlaku 24 jam.
- File hasil disimpan sementara pada volume app. Tautan unduhan sulit ditebak, tidak memerlukan login, dan kedaluwarsa setelah 24 jam. Token Telegram dan sesi WhatsApp disimpan di bawah APP_DATA_DIR; lindungi folder tersebut.
- Pesan dan sesi TikTok disimpan oleh bridge pada volume `tiktok-data`. Retensi riwayat bridge mengikuti kebijakan upstream dan perlu dipantau.
- Log aktivitas DAFZZ disimpan terbatas hingga 120 catatan terbaru dan tidak menyimpan isi DM atau secret.
- Jangan menghapus volume Docker saat restart atau update. Buat backup privat terlebih dahulu.

## Catatan kompatibilitas tools

Katalog berisi 401 entri dalam tujuh kategori: 300 tools lama tetap dipertahankan, sedangkan kategori ke-7 berisi Chat AI, 50 AI/Local Tools, dan 50 Bot Commands. Ini bukan berarti setiap fungsi identik dengan layanan desktop profesional. Website sumber sudah mencantumkan batasan untuk beberapa fitur: editor hapus objek/latar bersifat manual, annotasi bukan OCR, analisis dimensi foto bukan pengenalan wajah, beberapa layanan web memerlukan internet dan dapat terkena CORS, serta ekspor dokumen bisa berupa ekspor teks sederhana yang tidak mempertahankan seluruh tata letak. Beberapa library PDF/DOCX/XLSX dimuat dari CDN saat pertama digunakan.

Laporan pemeriksaan teknis ada di `QA-REPORT.txt`. Pengujian integrasi langsung dengan akun TikTok, Telegram, dan WhatsApp belum dilakukan karena memerlukan token/sesi akun pemiliknya.


## STRUKTUR ARSIP
ZIP memuat satu folder proyek utama. File-file aplikasi berada langsung di bawah folder tersebut; file `bot-commands.js`, `connectors.js`, dan `admin-info.js` menampung mesin perintah bersama, konektor platform, dan panel info admin.

## STRUKTUR FILE DATAR
Semua file bawaan ZIP diletakkan langsung di folder utama, tanpa subfolder `public`, `src`, `scripts`, `tests`, atau `vendor`. Nama file dibuat unik agar tidak ada yang tertimpa. Saat `setup.sh` dijalankan, folder `vendor/tiktok-dm-api` akan dibuat otomatis untuk source bridge eksternal yang dibutuhkan Docker.
