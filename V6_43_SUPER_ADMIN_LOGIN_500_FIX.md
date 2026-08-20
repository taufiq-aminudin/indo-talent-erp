# V6.43 — Super Admin Login 500 Fix

## Root cause addressed
The hidden Super Admin login could reach `/api/admin/login` but return HTTP 500 while creating a session. The previous bootstrap flow attempted to persist the synthetic `super-admin` identity through the generic D1 session path, which can fail on deployments where the sessions schema enforces a user relationship or differs from the expected schema.

## Fix
- Bootstrap Super Admin login now uses a dedicated signed, HttpOnly `ats_admin` cookie.
- The cookie is HMAC-SHA256 signed using `SESSION_SECRET` when available, otherwise the configured Super Admin secret material.
- `/api/auth/me` and protected `/api/admin/*` routes recognise the signed admin session without requiring a `users` row for `super-admin`.
- Existing company login/session handling remains unchanged.
- Logout clears both normal and Super Admin cookies.
- No D1 migration is required for the bootstrap Super Admin path.

## Deploy
Save `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` as Worker Secrets, deploy this Worker, then open the hidden Super Admin URL and sign in again.
