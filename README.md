# DAFZZ TikTok Bot

Paket gabungan DAFZZ-TOOLS, backend bot TikTok, panel konfigurasi, halaman pemrosesan file, dan halaman unduhan.

## Isi paket

- file frontend di folder utama berisi website DAFZZ-TOOLS dari sumber pengguna, dengan tema dan navigasi aslinya tetap dipakai.
- `tools.json` adalah katalog sumber: tepat 300 tool, 6 kategori, masing-masing 50.
- `admin.html` dan `admin.js` adalah panel konfigurasi bergaya DAFZZ.
- `bot.html`, `bot.css`, dan `bot-dashboard.js` menyediakan dashboard Menu Bot TT dengan status bot, statistik, koneksi, penyimpanan, AI, dan log aktivitas.
- file `server.js`, `bot.js`, `store.js`, `security.js`, `ai.js` berisi backend, pengelolaan sesi, webhook TikTok, penyimpanan sementara, dan AI fallback.
- `docker-compose.yml` menjalankan aplikasi DAFZZ dan TikTok DM bridge dalam jaringan privat.
- file `setup.sh`, `setup.ps1`, `import-tiktok-session.sh`, `import-tiktok-session.ps1` berisi skrip instalasi awal dan impor sesi TikTok.

## Yang sudah disiapkan

1. Perintah `.menu`, `.help`, `.start`, `.info`, dan `.cancel`.
2. Perintah kategori `.foto`, `.teks`, `.file`, `.konverter`, `.keamanan`, dan `.web`.
3. Seluruh slug dari katalog asli bisa dipanggil dengan awalan titik, misalnya `.potong-gambar` atau `.word-to-pdf`.
4. Perintah tool membalas dengan tautan halaman tool yang benar. Halaman tersebut memakai mesin browser DAFZZ asli.
5. Saat fungsi website menghasilkan file atau teks melalui fungsi hasil standar DAFZZ, hasil dikirim ke server. Server menyimpan file sementara selama 24 jam dan mencoba membalas DM TikTok dengan tautan unduhan.
6. Panel admin memiliki pengaturan token bridge, webhook secret, alamat publik, kontrol bot ON/OFF, dan AI fallback.
7. Menu Bot TT menampilkan statistik DM, balasan bot/AI, sesi tool, status bridge/webhook, penyimpanan, dan log aktivitas.
8. Pesan yang bukan perintah diarahkan ke Pollinations AI melalui endpoint yang dipakai website DAFZZ AI v3.0. Mode AI manual juga tersedia untuk endpoint OpenAI-compatible dan API key milik pengguna. Awalan balasan bawaan adalah `Maaf kamu ngetik apa mpruy`.
9. Sesi tool dan tautan unduhan memiliki masa berlaku 24 jam. File sementara dibersihkan secara berkala.

## Batasan integrasi TikTok yang perlu dibaca

Konektor dalam paket ini menggunakan proyek pihak ketiga `KreatixTeam/tiktok-dm-api`. Konektor itu tidak resmi, eksperimental, bukan produk TikTok, dan memakai endpoint reverse-engineered yang dapat berubah tanpa pemberitahuan.

Menurut dokumentasi upstream saat paket ini dibuat, konektor hanya membaca dan mengirim pesan teks pada percakapan satu lawan satu yang sudah ada. Konektor belum mendukung login QR, pembaruan sesi otomatis, permintaan DM baru, grup, pengiriman atau penerimaan media, dan pesan ke username sembarang. Akun yang belum mempunyai percakapan yang sesuai tidak bisa dihubungi melalui endpoint ini. Pengiriman dapat berstatus `unknown` bila konfirmasi tidak tersedia.

Karena DM TikTok tidak dapat membawa file PDF/Word melalui bridge ini, pengguna membuka halaman DAFZZ untuk memilih file dan menjalankan tool. Pemrosesan yang memang dibuat lokal oleh website tetap berlangsung di browser; hasilnya dikirim sementara ke server agar bot dapat mengirim tautan unduhan. File yang dikirim langsung sebagai lampiran DM TikTok belum bisa diproses.

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

- Website DAFZZ: `http://127.0.0.1:3000`
- Dashboard bot: `http://127.0.0.1:3000/bot`
- Panel konfigurasi: `http://127.0.0.1:3000/admin`

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

Untuk tes lokal tanpa domain, biarkan `NODE_ENV=development`, kosongkan `APP_PUBLIC_URL` dan `PUBLIC_DOMAIN`, lalu gunakan `http://127.0.0.1:3000`. Perintah tool dari TikTok tidak akan mendapatkan link yang dapat dibuka orang lain sampai URL HTTPS publik diisi.

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

- `.menu` — 6 kategori dan jumlah tools.
- `.foto` — 50 tools Foto & Desain.
- `.teks` — 50 tools Teks & Data.
- `.file` — 50 tools Dokumen & File.
- `.konverter` — 50 tools Konverter & Kalkulator.
- `.keamanan` — 50 tools Keamanan & Privasi.
- `.web` — 50 tools Web & Developer.
- `.help`, `.start`, `.info`, `.cancel`.
- Nama tool langsung dengan titik di depan, misalnya `.potong-gambar`.

Sistem ini tidak membuat alur tanya-jawab berbeda untuk setiap parameter secara otomatis. Website sumber tetap meminta input melalui kontrolnya sendiri, termasuk unggahan file, ukuran, teks, pilihan, dan parameter lain. Validasi tiap tool mengikuti implementasi aslinya.

## AI otomatis Pollinations dan AI manual

Mode AI bawaan menggunakan endpoint OpenAI-compatible Pollinations yang sudah dipakai dan diuji pada website DAFZZ AI v3.0:

- Endpoint: `https://text.pollinations.ai/openai`
- Model alias: `openai`
- Tidak mengirim API key dari aplikasi pada mode otomatis.

Jika layanan legacy tersebut berubah, membatasi akses, atau tidak tersedia, bot memberikan jawaban cadangan dan mencatat kegagalan pada log. Ketersediaan/kuota layanan eksternal tidak dijamin.

Panel `/admin` juga menyediakan mode AI manual. Administrator dapat memasukkan endpoint HTTPS OpenAI-compatible, nama model, dan API key penyedia sendiri. API key disimpan hanya di sisi server di file data privat; API overview tidak mengirim nilai key ke browser. Dokumentasi Pollinations saat ini juga menjelaskan API generasi baru di `https://gen.pollinations.ai/v1/chat/completions` dengan header `Authorization: Bearer ...` dan model ID katalog, sehingga administrator dapat memakai mode manual, mengisi URL tersebut, model yang tersedia, serta secret key Pollinations bila endpoint lama tidak lagi menerima permintaan. Dokumentasi resmi: https://gen.pollinations.ai/docs.

Menu Bot TT tersedia di `/bot`. Halaman ini memerlukan login administrator dan menyediakan kontrol ON/OFF bot, status bridge dan webhook, statistik, penyimpanan, AI fallback, serta log aktivitas terbaru. Saat bot OFF, webhook yang valid diakui oleh server tetapi pesan tidak diproses atau dibalas.

## Data dan penyimpanan

- Data admin, sesi tool, token konfigurasi, dan indeks file tersimpan pada volume Docker `dafzz-data`.
- Sesi tool dan link file berlaku 24 jam.
- File hasil disimpan sementara pada volume app. Tautan unduhan sulit ditebak, tidak memerlukan login, dan kedaluwarsa setelah 24 jam.
- Pesan dan sesi TikTok disimpan oleh bridge pada volume `tiktok-data`. Retensi riwayat bridge mengikuti kebijakan upstream dan perlu dipantau.
- Log aktivitas DAFZZ disimpan terbatas hingga 120 catatan terbaru dan tidak menyimpan isi DM atau secret.
- Jangan menghapus volume Docker saat restart atau update. Buat backup privat terlebih dahulu.

## Catatan kompatibilitas tools

Katalog dipertahankan sebagai 300 entri dalam enam kelompok, tetapi ini bukan berarti setiap fungsi identik dengan layanan desktop profesional. Website sumber sudah mencantumkan batasan untuk beberapa fitur: editor hapus objek/latar bersifat manual, annotasi bukan OCR, analisis dimensi foto bukan pengenalan wajah, beberapa layanan web memerlukan internet dan dapat terkena CORS, serta ekspor dokumen bisa berupa ekspor teks sederhana yang tidak mempertahankan seluruh tata letak. Beberapa library PDF/DOCX/XLSX dimuat dari CDN saat pertama digunakan.

Laporan pemeriksaan teknis ada di `QA-REPORT.txt`. Pengujian integrasi langsung dengan akun TikTok belum dilakukan karena membutuhkan sesi akun milik pemiliknya.


## STRUKTUR FILE DATAR
Semua file bawaan ZIP diletakkan langsung di folder utama, tanpa subfolder `public`, `src`, `scripts`, `tests`, atau `vendor`. Nama file dibuat unik agar tidak ada yang tertimpa. Saat `setup.sh` dijalankan, folder `vendor/tiktok-dm-api` akan dibuat otomatis untuk source bridge eksternal yang dibutuhkan Docker.
