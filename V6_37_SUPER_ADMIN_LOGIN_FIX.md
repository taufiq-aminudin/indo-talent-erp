# V6.37 — Super Admin Login Fix

## Root cause
The `/api/admin/login` endpoint correctly accepted the configured `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` and created a session for the synthetic platform user `super-admin`.

However, `/api/auth/me` previously resolved every session with `sessions JOIN users`. The synthetic `super-admin` identity is intentionally not stored in `users`, so the session could not be resolved and the dashboard returned `admin_required`.

This was especially important because the configured Super Admin email may already be used by a normal company account and `users.email` is unique. Creating a second `users` row with the same email would be incorrect.

## Fix
`currentUser()` now:
1. Validates the session in `sessions`.
2. Recognises the reserved `super-admin` session user id.
3. Reconstructs the platform admin identity from `SUPER_ADMIN_EMAIL`.
4. Uses the existing `users` join for normal company/candidate/admin sessions.

No D1 migration is required and no existing company account is modified.

## Deploy
Keep the production secrets configured:
- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`

Then deploy:
`npx wrangler deploy`

Open:
`/super-admin`

Sign in using exactly the configured Super Admin email/password.

## Expected result
After successful login:
- `/api/admin/login` creates the session.
- `/api/auth/me` recognises the `super-admin` session.
- The Super Admin dashboard loads instead of `admin_required`.
- Existing company accounts remain unchanged.
