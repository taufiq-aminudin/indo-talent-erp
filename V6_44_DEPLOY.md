# V6.44 Deployment Checklist

1. Pastikan Worker target: `indo-talent-erp`.
2. Set `SUPER_ADMIN_EMAIL` sebagai Secret Worker.
3. Set `SUPER_ADMIN_PASSWORD` sebagai Secret Worker, atau gunakan `SUPER_ADMIN_PASSWORD_HASH`.
4. Set `SESSION_SECRET` sebagai Secret Worker yang kuat dan stabil.
5. Deploy `cloudflare/src/index.ts` dari paket V6.44.
6. Buka `/api/admin/config-status` dan pastikan `build` = `V6.44` dan `ok` = true.
7. Login melalui halaman Super Admin.
8. Jika gagal, respons login V6.44 akan menyebut `stage` agar diagnosis lebih tepat.

V6.44 tidak melakukan bootstrap Super Admin ke tabel `users`, sehingga login bootstrap tidak bergantung pada schema D1.
