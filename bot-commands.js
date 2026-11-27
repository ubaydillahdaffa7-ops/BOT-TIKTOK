import crypto from 'node:crypto';
import { askFreeAI } from './ai.js';
import { getDb } from './store.js';

const COMMANDS = [
  ['pin','Mencari gambar melalui tautan pencarian','.pin Naruto #7'],
  ['s','Konversi gambar ke stiker; memerlukan dukungan media' ,'.s (balas gambar)'],
  ['toimg','Konversi stiker ke gambar; memerlukan dukungan media' ,'.toimg (balas stiker)'],
  ['anime','Mencari informasi anime','.anime Naruto'],
  ['manga','Mencari informasi manga','.manga One Piece'],
  ['randomanime','Rekomendasi anime acak','.randomanime'],
  ['randommanga','Rekomendasi manga acak','.randommanga'],
  ['topanime','Melihat daftar anime populer','.topanime'],
  ['character','Mencari karakter anime','.character Naruto'],
  ['ai','Bertanya langsung kepada AI dari chat','.ai pertanyaan'],
  ['pokemon','Informasi Pokémon berdasarkan nama','.pokemon pikachu'],
  ['randompokemon','Memilih Pokémon secara acak','.randompokemon'],
  ['pokemonmove','Informasi jurus Pokémon','.pokemonmove thunderbolt'],
  ['github','Mencari profil GitHub','.github octocat'],
  ['repo','Informasi repositori GitHub','.repo owner/nama-repo'],
  ['npm','Informasi paket npm','.npm express'],
  ['book','Mencari buku melalui Open Library','.book harry potter'],
  ['author','Mencari penulis melalui Open Library','.author Andrea Hirata'],
  ['country','Informasi negara','.country Indonesia'],
  ['university','Mencari universitas berdasarkan negara','.university Indonesia'],
  ['weather','Cuaca saat ini melalui layanan publik','.weather Banyuwangi'],
  ['earthquake','Informasi gempa terkini BMKG','.earthquake'],
  ['iss','Posisi Stasiun Luar Angkasa Internasional','.iss'],
  ['wiki','Ringkasan halaman Wikipedia','.wiki Naruto'],
  ['news','Mencari berita berdasarkan topik','.news teknologi'],
  ['search','Membuat tautan pencarian web','.search topik'],
  ['yt','Mencari video di YouTube','.yt tutorial JavaScript'],
  ['reddit','Mencari diskusi di Reddit','.reddit Android'],
  ['stack','Mencari jawaban di Stack Overflow','.stack JavaScript fetch'],
  ['docs','Mencari dokumentasi pemrograman','.docs CSS grid'],
  ['joke','Mengambil lelucon acak','.joke'],
  ['dadjoke','Mengambil dad joke','.dadjoke'],
  ['quote','Kutipan singkat berbahasa Indonesia','.quote'],
  ['fact','Fakta pengetahuan acak','.fact'],
  ['trivia','Pertanyaan trivia acak','.trivia'],
  ['riddle','Teka-teki acak','.riddle'],
  ['eightball','Jawaban acak ala Magic 8 Ball','.eightball pertanyaan'],
  ['coinflip','Permainan lempar koin','.coinflip'],
  ['dice','Lempar dadu','.dice 2'],
  ['choose','Memilih satu opsi secara acak','.choose merah | biru | hijau'],
  ['rps','Permainan batu-gunting-kertas','.rps batu'],
  ['dog','Tautan foto anjing acak','.dog'],
  ['cat','Tautan foto kucing acak','.cat'],
  ['meme','Mencari meme berdasarkan topik','.meme kucing'],
  ['server','Informasi runtime server bot','.server'],
  ['botstatus','Status bot dan statistik ringkas','.botstatus'],
  ['timeid','Waktu Indonesia bagian barat','.timeid'],
  ['dateid','Tanggal Indonesia','.dateid'],
  ['define','Mencari definisi kata bahasa Inggris','.define resilient'],
  ['commands','Daftar 50 perintah tambahan','.commands']
].map(([name, description, usage]) => ({ name, description, usage, command: `.${name}` }));

export const BOT_COMMANDS = COMMANDS;
const COMMAND_NAMES = new Set(COMMANDS.map(item => item.name));
const API_TIMEOUT = 9000;

function cleanQuery(value, max = 100) {
  return String(value || '').trim().replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').slice(0, max);
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'DAFZZ-Bot/1.0 (command tools)', ...headers },
    signal: AbortSignal.timeout(API_TIMEOUT)
  });
  if (!response.ok) throw new Error(`Layanan merespons HTTP ${response.status}`);
  return response.json();
}

function entityText(value = '') {
  return String(value).replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function googleSearch(query, type = '') {
  const suffix = type === 'images' ? 'tbm=isch&' : '';
  return `https://www.google.com/search?${suffix}q=${encodeURIComponent(query)}`;
}

function timeId() {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'medium' }).format(new Date());
}

async function pinImageSearch(term, count) {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: term, gsrnamespace: '6',
    gsrwhat: 'text', gsrlimit: String(count), prop: 'imageinfo', iiprop: 'url',
    iiurlwidth: '640', format: 'json', origin: '*'
  });
  try {
    const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`);
    const pages = Object.values(data.query?.pages || {});
    const images = pages.map(page => ({
      name: page.title?.replace(/^File:/, '') || 'Gambar',
      url: page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url || ''
    })).filter(item => item.url).slice(0, count);
    if (images.length) return `Hasil gambar untuk: ${term}\nDitemukan: ${images.length} dari maksimal ${count}\n\n${images.map((item, index) => `${index + 1}. ${item.name}\n${item.url}`).join('\n\n')}\n\nSumber: Wikimedia Commons. Bridge hanya mengirim tautan teks, bukan lampiran foto.`.slice(0, 3800);
  } catch { /* fall back to a public image-search page */ }
  return `Pencarian gambar: ${term}\nJumlah yang diminta: ${count} (maksimal 10).\nHasil dikirim sebagai tautan pencarian karena konektor chat saat ini hanya mengirim teks.\n${googleSearch(term, 'images')}`;
}

async function jikanSearch(kind, query) {
  if (!query) return `Contoh: .${kind === 'characters' ? 'character' : kind === 'manga' ? 'manga' : 'anime'} kata kunci`;
  const data = await fetchJson(`https://api.jikan.moe/v4/${kind}?q=${encodeURIComponent(query)}&limit=3`);
  const rows = Array.isArray(data.data) ? data.data : [];
  if (!rows.length) return `Tidak ada hasil ${kind} untuk: ${query}`;
  return rows.map((item, index) => {
    const title = item.title || item.name || 'Tanpa judul';
    const detail = item.synopsis || item.about || item.type || 'Ringkasan tidak tersedia.';
    return `${index + 1}. ${title}\n${String(detail).replace(/\s+/g, ' ').slice(0, 430)}\n${item.url || ''}`;
  }).join('\n\n').slice(0, 3400);
}

const QUOTES = [
  'Pelan bukan berarti berhenti. Yang penting tetap bergerak.',
  'Kemajuan kecil yang dilakukan setiap hari akan menjadi perubahan besar.',
  'Jangan menunggu sempurna untuk mulai belajar.',
  'Kesalahan adalah bagian dari proses memperbaiki kemampuan.',
  'Fokus pada hal yang bisa kamu kerjakan hari ini.'
];
const RIDDLES = [
  ['Aku punya banyak tombol, tetapi tidak bisa membuka pintu. Apakah aku?', 'Keyboard.'],
  ['Semakin banyak diambil, semakin besar jadinya. Apakah itu?', 'Lubang.'],
  ['Aku selalu mengikuti kamu, tetapi menghilang dalam gelap. Apakah aku?', 'Bayangan.'],
  ['Apa yang punya leher tetapi tidak punya kepala?', 'Botol.'],
  ['Apa yang bisa berjalan tanpa kaki?', 'Jam.']
];
const EIGHT_BALL = ['Sangat mungkin.', 'Sepertinya iya.', 'Tanda-tandanya mengarah ke iya.', 'Belum bisa dipastikan.', 'Coba tanyakan lagi nanti.', 'Sepertinya tidak.', 'Kemungkinan kecil.', 'Jangan mengandalkannya.'];

// Semua 25 tool AI juga dapat dipanggil langsung dari chat bot yang tersambung.
const AI_TOOL_PROMPTS = {
  'ai-story': 'Buat cerita pendek yang orisinal dan menarik dari ide berikut.',
  'ai-novel-outline': 'Buat kerangka novel dengan premis, karakter, konflik utama, dan 8 bab.',
  'ai-poem': 'Buat puisi orisinal yang sesuai dengan tema berikut.',
  'ai-pantun': 'Buat tiga pantun dengan rima yang baik sesuai tema berikut.',
  'ai-caption': 'Buat lima pilihan caption media sosial berdasarkan konteks berikut.',
  'ai-article': 'Tulis artikel terstruktur dengan judul, pembuka, subjudul, dan penutup.',
  'ai-summary': 'Ringkas teks berikut menjadi poin inti tanpa menambah fakta.',
  'ai-paraphrase': 'Parafrase teks berikut dengan makna tetap sama.',
  'ai-translate': 'Terjemahkan teks berikut. Jika bahasa tujuan tidak disebutkan, gunakan Bahasa Indonesia.',
  'ai-explain': 'Jelaskan topik berikut dengan bahasa sederhana dan contoh.',
  'ai-code-helper': 'Bantu membuat atau menjelaskan kode. Berikan contoh yang bisa digunakan dan jelaskan batasannya.',
  'ai-ideas': 'Berikan 10 ide kreatif yang relevan dengan topik berikut.',
  'ai-product-copy': 'Tulis deskripsi produk yang informatif dan tidak membuat klaim yang tidak diberikan.',
  'ai-bio': 'Buat lima pilihan bio singkat berdasarkan informasi berikut.',
  'ai-email': 'Buat draf email yang sopan, jelas, dan sesuai tujuan berikut.',
  'ai-video-script': 'Buat naskah video dengan hook, isi, dan penutup berdasarkan topik berikut.',
  'ai-hashtags': 'Buat hashtag relevan dan tidak berulang untuk topik berikut.',
  'ai-title': 'Buat 10 alternatif judul yang menarik namun tidak menyesatkan.',
  'ai-dialogue': 'Buat dialog natural berdasarkan situasi atau karakter berikut.',
  'ai-study-notes': 'Ubah materi berikut menjadi catatan belajar yang terstruktur.',
  'ai-mindmap': 'Susun peta pikiran bertingkat berdasarkan topik berikut.',
  'ai-question-maker': 'Buat lima soal latihan beserta kunci jawaban dari materi berikut.',
  'ai-ad-copy': 'Buat teks iklan singkat dan jujur berdasarkan produk berikut.',
  'ai-lesson-plan': 'Susun rencana belajar bertahap berdasarkan topik dan tujuan berikut.',
  'ai-character-profile': 'Buat profil karakter fiksi lengkap berdasarkan deskripsi berikut.'
};
const LOCAL_AI_TOOL_NAMES = new Set([
  'sentence-counter', 'paragraph-counter', 'reading-time', 'character-frequency', 'remove-diacritics',
  'unicode-normalizer', 'smart-quotes', 'strip-control-chars', 'extract-hashtags', 'extract-mentions',
  'extract-phone', 'extract-numbers', 'extract-dates', 'initials-generator', 'text-wrap', 'text-prefixer',
  'text-suffixer', 'list-numberer', 'list-bulletizer', 'random-choice', 'text-repeater', 'template-filler',
  'csv-to-markdown-table', 'json-to-typescript', 'line-numberer'
]);
export const AI_TOOL_COMMANDS = Object.keys(AI_TOOL_PROMPTS);
export const LOCAL_AI_TOOL_COMMANDS = [...LOCAL_AI_TOOL_NAMES];
export const AI_LOCAL_BOT_COMMANDS = [...AI_TOOL_COMMANDS, ...LOCAL_AI_TOOL_COMMANDS];

function runLocalAiCommand(command, text) {
  const lines = text.split(/\r?\n/);
  const words = text.trim().match(/\S+/g) || [];
  const countSentences = () => (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).filter(item => item.trim()).length;
  switch (command) {
    case 'sentence-counter': return `Jumlah kalimat: ${countSentences()}`;
    case 'paragraph-counter': return `Jumlah paragraf: ${text.trim() ? text.trim().split(/\n\s*\n/).filter(item => item.trim()).length : 0}`;
    case 'reading-time': { const minutes = words.length / 200; return `Jumlah kata: ${words.length}\nPerkiraan waktu baca: ${minutes < 1 ? Math.max(1, Math.ceil(minutes * 60)) + ' detik' : Math.ceil(minutes) + ' menit'} (asumsi 200 kata/menit).`; }
    case 'character-frequency': { const counts = new Map(); for (const ch of [...text]) counts.set(ch, (counts.get(ch) || 0) + 1); return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([ch, n]) => `${ch === ' ' ? '[spasi]' : ch === '\n' ? '[baris baru]' : ch}: ${n}`).join('\n') || 'Tidak ada karakter.'; }
    case 'remove-diacritics': return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    case 'unicode-normalizer': { const match = text.match(/^--(NFC|NFD|NFKC|NFKD)\s+([\s\S]*)$/i); return (match ? match[2] : text).normalize(match ? match[1].toUpperCase() : 'NFC'); }
    case 'smart-quotes': return text.replace(/"([^"]*)"/g, '“$1”').replace(/'([^']*)'/g, '‘$1’');
    case 'strip-control-chars': return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    case 'extract-hashtags': return [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])].join('\n') || 'Tidak ada hashtag.';
    case 'extract-mentions': return [...new Set(text.match(/@[\p{L}\p{N}_.]+/gu) || [])].join('\n') || 'Tidak ada mention.';
    case 'extract-phone': return [...new Set(text.match(/(?:\+?62|0)8\d[\d -]{6,13}\d/g) || [])].join('\n') || 'Tidak ditemukan pola nomor telepon Indonesia.';
    case 'extract-numbers': return text.match(/-?\d+(?:[.,]\d+)?/g)?.join('\n') || 'Tidak ada angka.';
    case 'extract-dates': return text.match(/\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g)?.join('\n') || 'Tidak ditemukan pola tanggal.';
    case 'initials-generator': return text.trim().split(/\s+/).filter(Boolean).map(word => [...word][0].toLocaleUpperCase('id-ID')).join('');
    case 'text-wrap': { const match = text.match(/^--(\d{2,3})\s+([\s\S]*)$/); const width = Math.max(10, Math.min(240, Number(match?.[1] || 60))); const source = match ? match[2] : text; const result = []; let line = ''; for (const word of source.trim().split(/\s+/).filter(Boolean)) { if (line && line.length + 1 + word.length > width) { result.push(line); line = word; } else line += (line ? ' ' : '') + word; } if (line) result.push(line); return result.join('\n'); }
    case 'text-prefixer': { const match = text.match(/^--prefix=(.*?)\n([\s\S]*)$/); const prefix = match ? match[1] : '> '; return (match ? match[2] : text).split(/\r?\n/).map(line => prefix + line).join('\n'); }
    case 'text-suffixer': { const match = text.match(/^--suffix=(.*?)\n([\s\S]*)$/); const suffix = match ? match[1] : ' '; return (match ? match[2] : text).split(/\r?\n/).map(line => line + suffix).join('\n'); }
    case 'list-numberer': return lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
    case 'list-bulletizer': return lines.map(line => line.trim() ? `• ${line.trim()}` : '').join('\n');
    case 'random-choice': { const items = text.split(/\r?\n|\|/).map(item => item.trim()).filter(Boolean); return items.length ? `Pilihan acak: ${items[crypto.randomInt(items.length)]}` : 'Masukkan setidaknya dua opsi, satu per baris atau dipisahkan |.'; }
    case 'text-repeater': { const match = text.match(/^--(\d{1,3})\n([\s\S]*)$/); const count = Math.max(1, Math.min(500, Number(match?.[1] || 3))); const value = match ? match[2] : text; return Array(count).fill(value).join('\n'); }
    case 'template-filler': { const [template, ...pairs] = text.split(/\r?\n---\r?\n/); let output = template; for (const pair of pairs) { const at = pair.indexOf('='); if (at > 0) output = output.replaceAll(`{{${pair.slice(0, at).trim()}}}`, pair.slice(at + 1).trim()); } return output; }
    case 'csv-to-markdown-table': { const rows = parseSimpleCsv(text); if (!rows.length) return 'CSV kosong.'; const headers = rows[0]; const cell = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); return `| ${headers.map(cell).join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.slice(1).map(row => `| ${headers.map((_, i) => cell(row[i])).join(' | ')} |`).join('\n')}`; }
    case 'json-to-typescript': { const value = JSON.parse(text); const object = Array.isArray(value) ? value[0] : value; if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Masukkan JSON object atau array berisi object.'); const infer = item => item === null ? 'null' : Array.isArray(item) ? (item.length ? `${infer(item[0])}[]` : 'unknown[]') : typeof item === 'object' ? 'Record<string, unknown>' : typeof item; return `export interface DAFZZData {\n${Object.entries(object).map(([key, item]) => `  ${/^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key)}: ${infer(item)};`).join('\n')}\n}`; }
    case 'line-numberer': return lines.map((line, index) => `${String(index + 1).padStart(String(lines.length).length, '0')}  ${line}`).join('\n');
    default: return null;
  }
}

function parseSimpleCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.replace(/\r$/, '')); if (row.some(item => item)) rows.push(row);
  return rows;
}

async function answerCommand(command, argument) {
  const query = cleanQuery(argument);
  switch (command) {
    case 'ai':
      return query ? askFreeAI(query, { includePrefix: false, requesterIp: 'tiktok-command' }) : 'Contoh: .ai Jelaskan cara kerja internet';
    case 'pin': {
      const countMatch = query.match(/^(.*?)\s+#(\d+)$/);
      const term = cleanQuery(countMatch ? countMatch[1] : query, 120);
      const count = Math.max(1, Math.min(10, Number(countMatch?.[2] || 1)));
      if (!term) return 'Contoh: .pin Naruto atau .pin Naruto #7';
      return pinImageSearch(term, count);
    }
    case 's':
    case 'toimg':
      return `Perintah .${command} dikenali, tetapi pemrosesan lampiran belum tersedia. Konektor chat saat ini memproses teks dan tautan; fitur media membutuhkan modul unggah dan kirim media terpisah.`;
    case 'anime': return jikanSearch('anime', query);
    case 'manga': return jikanSearch('manga', query);
    case 'character': return jikanSearch('characters', query);
    case 'randomanime':
    case 'randommanga': {
      const kind = command === 'randomanime' ? 'anime' : 'manga';
      const data = await fetchJson(`https://api.jikan.moe/v4/random/${kind}`);
      const item = data.data || {};
      return `${item.title || 'Tanpa judul'}\n${String(item.synopsis || 'Sinopsis tidak tersedia.').slice(0, 1200)}\n${item.url || ''}`;
    }
    case 'topanime': {
      const data = await fetchJson('https://api.jikan.moe/v4/top/anime?limit=5');
      return (data.data || []).map((item, index) => `${index + 1}. ${item.title} — skor ${item.score ?? '-'}\n${item.url || ''}`).join('\n\n').slice(0, 3400) || 'Daftar anime populer belum tersedia.';
    }
    case 'pokemon':
    case 'randompokemon': {
      const id = command === 'randompokemon' ? crypto.randomInt(1, 1026) : query.toLowerCase();
      if (command === 'pokemon' && !query) return 'Contoh: .pokemon pikachu';
      const data = await fetchJson(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(id)}`);
      const types = (data.types || []).map(item => item.type.name).join(', ');
      const abilities = (data.abilities || []).slice(0, 4).map(item => item.ability.name).join(', ');
      return `POKÉMON #${data.id} — ${data.name}\nTipe: ${types || '-'}\nTinggi: ${(data.height || 0) / 10} m\nBerat: ${(data.weight || 0) / 10} kg\nKemampuan: ${abilities || '-'}\nData: ${data.species?.url || ''}`;
    }
    case 'pokemonmove': {
      if (!query) return 'Contoh: .pokemonmove thunderbolt';
      const data = await fetchJson(`https://pokeapi.co/api/v2/move/${encodeURIComponent(query.toLowerCase().replace(/\s+/g, '-'))}`);
      const effect = data.effect_entries?.find(item => item.language?.name === 'en')?.short_effect || 'Deskripsi tidak tersedia.';
      return `${data.name}\nTipe: ${data.type?.name || '-'}\nKategori: ${data.damage_class?.name || '-'}\nPower: ${data.power ?? '-'} | Akurasi: ${data.accuracy ?? '-'}\nEfek: ${effect}`;
    }
    case 'github': {
      if (!query) return 'Contoh: .github octocat';
      const data = await fetchJson(`https://api.github.com/users/${encodeURIComponent(query)}`, { Accept: 'application/vnd.github+json' });
      return `${data.name || data.login}\nUsername: @${data.login}\nBio: ${data.bio || '-'}\nRepositori publik: ${data.public_repos}\nPengikut: ${data.followers}\n${data.html_url}`;
    }
    case 'repo': {
      if (!/^[\w.-]+\/[\w.-]+$/.test(query)) return 'Contoh: .repo owner/nama-repo';
      const data = await fetchJson(`https://api.github.com/repos/${query}`, { Accept: 'application/vnd.github+json' });
      return `${data.full_name}\n${data.description || 'Tidak ada deskripsi.'}\nBahasa: ${data.language || '-'}\nStars: ${data.stargazers_count} | Fork: ${data.forks_count}\n${data.html_url}`;
    }
    case 'npm': {
      if (!query) return 'Contoh: .npm express';
      const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(query)}`);
      return `${data.name}\nVersi terbaru: ${data['dist-tags']?.latest || '-'}\nDeskripsi: ${data.description || '-'}\nMingguan diunduh: ${data.downloads?.weekly ?? 'Tidak tersedia'}\n${data.homepage || `https://www.npmjs.com/package/${encodeURIComponent(query)}`}`;
    }
    case 'book': {
      if (!query) return 'Contoh: .book Laskar Pelangi';
      const data = await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=3`);
      return (data.docs || []).map((item, index) => `${index + 1}. ${item.title}\nPenulis: ${(item.author_name || []).slice(0, 3).join(', ') || '-'}\nTahun: ${item.first_publish_year || '-'}\nhttps://openlibrary.org${item.key}`).join('\n\n').slice(0, 3300) || `Buku tidak ditemukan: ${query}`;
    }
    case 'author': {
      if (!query) return 'Contoh: .author Andrea Hirata';
      const data = await fetchJson(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(query)}&limit=3`);
      return (data.docs || []).map((item, index) => `${index + 1}. ${item.name}\nBuku terkait: ${item.work_count ?? '-'}\nhttps://openlibrary.org${item.key}`).join('\n\n').slice(0, 3000) || `Penulis tidak ditemukan: ${query}`;
    }
    case 'country': {
      if (!query) return 'Contoh: .country Indonesia';
      const data = await fetchJson(`https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fields=name,capital,region,subregion,population,languages,cca2`);
      const item = data[0];
      if (!item) return `Negara tidak ditemukan: ${query}`;
      return `${item.name?.common}\nKode: ${item.cca2}\nIbu kota: ${(item.capital || []).join(', ') || '-'}\nWilayah: ${item.region || '-'} / ${item.subregion || '-'}\nPopulasi: ${(item.population || 0).toLocaleString('id-ID')}\nBahasa: ${Object.values(item.languages || {}).join(', ') || '-'}`;
    }
    case 'university': {
      if (!query) return 'Contoh: .university Indonesia';
      const data = await fetchJson(`https://universities.hipolabs.com/search?country=${encodeURIComponent(query)}&limit=5`);
      return data.slice(0, 5).map((item, index) => `${index + 1}. ${item.name}\n${item['web_pages']?.[0] || '-'}\n${item['state-province'] || ''}`).join('\n\n').slice(0, 3300) || `Universitas tidak ditemukan untuk: ${query}`;
    }
    case 'weather': {
      if (!query) return 'Contoh: .weather Banyuwangi';
      const data = await fetchJson(`https://wttr.in/${encodeURIComponent(query)}?format=j1`);
      const current = data.current_condition?.[0] || {};
      return `CUACA ${query}\nKondisi: ${current.weatherDesc?.[0]?.value || '-'}\nSuhu: ${current.temp_C ?? '-'}°C\nTerasa: ${current.FeelsLikeC ?? '-'}°C\nKelembapan: ${current.humidity ?? '-'}%\nAngin: ${current.windspeedKmph ?? '-'} km/jam`;
    }
    case 'earthquake': {
      const data = await fetchJson('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json');
      const quake = data.Infogempa?.gempa?.[0] || {};
      return `GEMPA TERKINI BMKG\nWaktu: ${quake.Jam || '-'} ${quake.Tanggal || ''}\nMagnitudo: ${quake.Magnitude || '-'}\nKedalaman: ${quake.Kedalaman || '-'}\nLokasi: ${quake.Wilayah || '-'}\nPotensi tsunami: ${quake.Potensi || '-'}\nKoordinat: ${quake.Lintang || '-'}, ${quake.Bujur || '-'}`;
    }
    case 'iss': {
      const data = await fetchJson('https://api.wheretheiss.at/v1/satellites/25544');
      return `POSISI ISS\nLintang: ${Number(data.latitude).toFixed(3)}\nBujur: ${Number(data.longitude).toFixed(3)}\nKetinggian: ${Math.round(data.altitude)} km\nKecepatan: ${Math.round(data.velocity)} km/jam\nPeta: https://www.google.com/maps?q=${data.latitude},${data.longitude}`;
    }
    case 'wiki': {
      if (!query) return 'Contoh: .wiki Naruto';
      const data = await fetchJson(`https://id.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s+/g, '_'))}`);
      return `${data.title || query}\n\n${String(data.extract || 'Ringkasan tidak tersedia.').slice(0, 2300)}${data.content_urls?.desktop?.page ? `\n\nSumber: ${data.content_urls.desktop.page}` : ''}`;
    }
    case 'news': return query ? `Pencarian berita untuk: ${query}\nhttps://news.google.com/search?q=${encodeURIComponent(query)}` : 'Contoh: .news teknologi';
    case 'search': return query ? `Pencarian web: ${query}\n${googleSearch(query)}` : 'Contoh: .search cara belajar JavaScript';
    case 'yt': return query ? `Pencarian YouTube: ${query}\nhttps://www.youtube.com/results?search_query=${encodeURIComponent(query)}` : 'Contoh: .yt tutorial JavaScript';
    case 'reddit': return query ? `Diskusi Reddit: ${query}\nhttps://www.reddit.com/search/?q=${encodeURIComponent(query)}` : 'Contoh: .reddit Android';
    case 'stack': return query ? `Pencarian Stack Overflow: ${query}\nhttps://stackoverflow.com/search?q=${encodeURIComponent(query)}` : 'Contoh: .stack JavaScript fetch';
    case 'docs': return query ? `Pencarian dokumentasi: ${query}\nhttps://developer.mozilla.org/en-US/search?q=${encodeURIComponent(query)}` : 'Contoh: .docs CSS grid';
    case 'joke': {
      const data = await fetchJson('https://official-joke-api.appspot.com/random_joke');
      return `${data.setup || 'Lelucon'}\n${data.punchline || ''}`;
    }
    case 'dadjoke': {
      const data = await fetchJson('https://icanhazdadjoke.com/', { Accept: 'application/json' });
      return data.joke || 'Lelucon belum tersedia.';
    }
    case 'quote': return QUOTES[crypto.randomInt(QUOTES.length)];
    case 'fact': {
      const data = await fetchJson('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
      return `FAKTA ACAK (EN)\n${data.text || 'Fakta belum tersedia.'}`;
    }
    case 'trivia': {
      const data = await fetchJson('https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986');
      const item = data.results?.[0];
      if (!item) return 'Pertanyaan trivia belum tersedia.';
      const choices = [...item.incorrect_answers, item.correct_answer].map(value => decodeURIComponent(value));
      for (let i = choices.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [choices[i], choices[j]] = [choices[j], choices[i]]; }
      return `TRIVIA — ${decodeURIComponent(item.category)}\n${decodeURIComponent(item.question)}\n\n${choices.map((value, index) => `${String.fromCharCode(65 + index)}. ${value}`).join('\n')}\n\nKunci jawaban: ${decodeURIComponent(item.correct_answer)}`;
    }
    case 'riddle': {
      const [question, answer] = RIDDLES[crypto.randomInt(RIDDLES.length)];
      return `TEKA-TEKI\n${question}\n\nJawaban: ${answer}`;
    }
    case 'eightball': return `${query ? `Pertanyaan: ${query}\n` : ''}Jawaban Magic 8 Ball: ${EIGHT_BALL[crypto.randomInt(EIGHT_BALL.length)]}`;
    case 'coinflip': return `Hasil lempar koin: ${crypto.randomInt(2) ? 'ANGKA' : 'GAMBAR'}`;
    case 'dice': {
      const count = Math.max(1, Math.min(5, Number.parseInt(query, 10) || 1));
      const result = Array.from({ length: count }, () => crypto.randomInt(1, 7));
      return `Hasil lempar ${count} dadu: ${result.join(', ')}\nTotal: ${result.reduce((sum, value) => sum + value, 0)}`;
    }
    case 'choose': {
      const options = query.split('|').map(item => cleanQuery(item, 80)).filter(Boolean).slice(0, 20);
      return options.length < 2 ? 'Contoh: .choose merah | biru | hijau' : `Pilihan terpilih: ${options[crypto.randomInt(options.length)]}`;
    }
    case 'rps': {
      const picks = { batu: ['batu', 'gunting', 'seri'], gunting: ['gunting', 'kertas', 'seri'], kertas: ['kertas', 'batu', 'seri'] };
      const user = query.toLowerCase();
      if (!Object.hasOwn(picks, user)) return 'Pilih: .rps batu, .rps gunting, atau .rps kertas';
      const bot = ['batu', 'gunting', 'kertas'][crypto.randomInt(3)];
      const outcome = bot === user ? 'Seri.' : picks[user][1] === bot ? 'Kamu menang.' : 'Bot menang.';
      return `Kamu: ${user}\nBot: ${bot}\n${outcome}`;
    }
    case 'dog': {
      const data = await fetchJson('https://dog.ceo/api/breeds/image/random');
      return `Foto anjing acak:\n${data.message || 'https://dog.ceo/dog-api/'}`;
    }
    case 'cat': {
      const data = await fetchJson('https://api.thecatapi.com/v1/images/search');
      return `Foto kucing acak:\n${data[0]?.url || 'https://thecatapi.com/'}`;
    }
    case 'meme': return query ? `Pencarian meme: ${query}\nhttps://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${query} meme`)}` : 'Contoh: .meme kucing';
    case 'server': {
      const memory = process.memoryUsage();
      return `SERVER DAFZZ\nNode.js: ${process.version}\nUptime proses: ${Math.floor(process.uptime() / 60)} menit\nMemori RSS: ${Math.round(memory.rss / 1024 / 1024)} MB\nPlatform: ${process.platform} ${process.arch}`;
    }
    case 'botstatus': {
      const db = getDb();
      const stats = db.stats || {};
      return `STATUS DAFZZ BOT\nTikTok: ${db.settings?.botEnabled === false ? 'OFF' : 'ON'}\nTelegram: ${db.settings?.platforms?.telegram?.enabled ? 'AKTIF' : 'OFF'}\nWhatsApp: ${db.settings?.platforms?.whatsapp?.enabled ? 'AKTIF' : 'OFF'}\nPesan masuk: ${stats.received || 0}\nBalasan: ${stats.replied || 0}\nBalasan AI: ${stats.aiReplies || 0}\nTautan tool: ${stats.toolLinks || 0}`;
    }
    case 'timeid': return `WAKTU WIB\n${timeId()}`;
    case 'dateid': return `TANGGAL INDONESIA\n${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full' }).format(new Date())}`;
    case 'define': {
      if (!query) return 'Contoh: .define resilient';
      const data = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
      const entry = data[0];
      const meanings = (entry.meanings || []).slice(0, 3).map(item => `${item.partOfSpeech || ''}: ${item.definitions?.[0]?.definition || '-'}`);
      return `${entry.word || query}\n${entry.phonetic || ''}\n${meanings.join('\n')}`.slice(0, 3200);
    }
    case 'commands':
      return ['DAFZZ — 50 BOT COMMANDS', '', ...COMMANDS.map(item => `${item.usage} — ${item.description}`), '', 'Catatan media: .pin memberikan tautan pencarian; .s dan .toimg belum dapat memproses media karena Bridge bawaan hanya mendukung teks.'].join('\n').slice(0, 3900);
    default: return null;
  }
}

export async function handleBotCommand(rawText) {
  const match = String(rawText || '').trim().match(/^\.([a-z0-9-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const isAiTool = Object.hasOwn(AI_TOOL_PROMPTS, command);
  const isLocalTool = LOCAL_AI_TOOL_NAMES.has(command);
  if (!COMMAND_NAMES.has(command) && !isAiTool && !isLocalTool) return null;
  const argument = (match[2] || '').trim().slice(0, 3500);
  try {
    let reply;
    if (isAiTool) {
      if (!argument) reply = `Contoh: .${command} tuliskan topik atau teks yang ingin diproses.`;
      else reply = await askFreeAI(`${AI_TOOL_PROMPTS[command]}\n\nMasukan pengguna:\n${argument}`, { includePrefix: false, requesterIp: 'tiktok-ai-tool' });
    } else if (isLocalTool) {
      if (!argument) reply = `Contoh: .${command} teks yang ingin diproses.`;
      else reply = runLocalAiCommand(command, argument);
    } else {
      reply = await answerCommand(command, argument);
    }
    const type = isAiTool || command === 'ai' ? 'ai' : isLocalTool ? 'local-tool' : 'bot-command';
    return { command, type, reply: String(reply || 'Perintah selesai tanpa hasil.').slice(0, 3900) };
  } catch (error) {
    const message = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'Layanan terlalu lama merespons. Coba lagi nanti.'
      : 'Data tidak dapat diambil saat ini. Periksa penulisan perintah atau coba lagi nanti.';
    return { command, type: 'bot-command-error', reply: message };
  }
}
