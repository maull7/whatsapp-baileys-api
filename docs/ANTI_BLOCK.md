# Meminimalisir Risiko Block (WhatsApp Tidak Resmi)

API ini memakai **Baileys** (WhatsApp tidak resmi). Akun bisa kena **block** atau **ban** jika dipakai sembarangan. Berikut cara meminimalisir risiko.

## Yang Sudah Diterapkan di API

1. **Batas harian per nomor**
   - Nomor di **whitelist** (dianggap "saved contact"): max **5** chat/hari.
   - Nomor **tidak di whitelist**: max **2** chat/hari.
   - Batas reset tiap hari (waktu server).

2. **Delay sebelum kirim**
   - Nomor **whitelist**: kirim **langsung** (tanpa jeda).
   - Nomor **bukan whitelist**: jeda **2 detik** dulu baru kirim (mirip orang buka chat dulu).

3. **Whitelist**
   - Tambah nomor yang aman/prioritas ke whitelist: `POST /api/whitelist` body `{ "number": "628xxx" }`.
   - Nomor whitelist dapat kuota lebih besar dan tanpa delay.

## Rekomendasi Umum

- **Jangan spam**: jangan kirim massal ke banyak nomor dalam waktu singkat.
- **Gunakan nomor dedikasi**: jangan pakai nomor pribadi utama; pakai nomor lain untuk bot/API.
- **Warm-up**: setelah scan QR, biarkan akun dipakai normal (baca chat, tidak langsung blast).
- **Hindari pesan identik**: variasi isi pesan, hindari template yang sama ke banyak orang.
- **Jangan kirim ke nomor yang mem-block kita**: kurangi kirim ke nomor yang tidak merespons atau mem-block.
- **Batasi grup**: jangan otomatis add banyak grup atau kirim ke banyak grup sekaligus.

## Environment (opsional)

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `DELAY_NOT_SAVED_MS` | 2000 | Jeda (ms) sebelum kirim ke nomor non-whitelist. |
| `LIMIT_SAVED_PER_DAY` | 5 | Max kirim per hari ke nomor whitelist. |
| `LIMIT_NOT_SAVED_PER_DAY` | 2 | Max kirim per hari ke nomor non-whitelist. |

## Disclaimer

WhatsApp melarang penggunaan API tidak resmi. Risiko block/ban tetap ada. Gunakan untuk keperluan pribadi/development dan tanggung jawab sendiri.
