# V6.44 — Super Admin Login Isolation

## Tujuan
Memastikan login Super Admin tidak bergantung pada schema D1 perusahaan.

## Perubahan
- `/api/admin/login` tidak lagi melakukan INSERT ke `users`.
- `/api/admin/login` tidak lagi membuat durable D1 session untuk bootstrap Super Admin.
- Super Admin menggunakan cookie `ats_admin` bertanda tangan HMAC.
- Audit tetap best-effort dan tidak dapat menggagalkan login.
- Error session signing dikembalikan sebagai `admin_session_failed` dengan stage diagnostik.
- Build identifier di endpoint konfigurasi/login menjadi `V6.44`.

## Secret Worker
Pastikan secret berikut berada pada Worker `indo-talent-erp` yang sama:

- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD` atau `SUPER_ADMIN_PASSWORD_HASH`
- `SESSION_SECRET` (sangat disarankan)

## Deploy
```bash
cd cloudflare
npm install
npm run deploy
```
