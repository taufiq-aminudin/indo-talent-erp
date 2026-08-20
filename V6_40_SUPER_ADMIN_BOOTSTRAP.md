# V6.40 — Super Admin Bootstrap & Secret Visibility Fix

## Changes
- Adds `/api/admin/config-status` to safely report whether `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, or `SUPER_ADMIN_PASSWORD_HASH` are visible to the active Worker. Secret values are never returned.
- Improves `admin_not_configured` diagnostics with non-sensitive configuration flags and build identifier `V6.40`.
- Supports database-backed `role='admin'` login before bootstrap-secret login.
- On a successful bootstrap-secret login, creates a durable `users` admin row only when the configured email is not already registered. Existing company/candidate accounts are never promoted automatically.
- Keeps Super Admin session handling compatible with the existing `super-admin` virtual session.
- Supports either plaintext `SUPER_ADMIN_PASSWORD` or PBKDF2 `SUPER_ADMIN_PASSWORD_HASH`.

## Required Cloudflare Secrets
- `SUPER_ADMIN_EMAIL`
- One of: `SUPER_ADMIN_PASSWORD` or `SUPER_ADMIN_PASSWORD_HASH`

## Deployment
Deploy the Worker after saving the secrets. Then open `/api/admin/config-status` in the same Worker domain. It should report `ok: true` and `build: V6.40` without exposing any secret value.

## V6.40 login hardening
- Bootstrap Super Admin credentials are checked before optional database profile queries.
- A missing/legacy `company_profiles` table can no longer turn a valid Super Admin login into `admin_login_failed`.
- Login response includes a non-secret `auth_source` (`bootstrap_secret` or `database`).
- If configuration is missing, `/api/admin/config-status` reports the missing secret flags without exposing values.
