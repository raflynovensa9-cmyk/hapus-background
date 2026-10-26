# Hapus Background

Website untuk menghapus background gambar langsung di browser. Gambar diproses di perangkat pengguna dan tidak diunggah ke server.

## Cara pakai

1. Buka website melalui GitHub Pages.
2. Pilih atau seret gambar JPG, PNG, atau WebP berukuran maksimal 30 MB.
3. Tekan **Hapus background** dan tunggu prosesnya selesai.
4. Tekan **Unduh PNG** untuk menyimpan gambar transparan.

Pemrosesan membutuhkan koneksi internet untuk memuat model dari CDN IMG.LY. File gambar tetap diproses di browser.

## GitHub Pages

Hasil website statis tersedia di folder `docs/` dan menggunakan base path relatif (`./`).

Untuk menerbitkannya, buka **Settings → Pages**, pilih **Deploy from a branch**, lalu pilih branch `main` dan folder `/docs`.

## Library

Penghapusan background menggunakan [`@imgly/background-removal`](https://www.npmjs.com/package/@imgly/background-removal), berlisensi AGPL.

## Kredit

Dibuat dengan bantuan AI (Replit Agent dan Claude). Ide, desain, dan pengujian oleh Rafly Novensa.
