# V6.38 — Super Admin Credential Diagnostic

The previous `invalid_admin_credentials` response means the Worker received the login request, but the email/password did not match either:

1. a database user with `role='admin'`, or
2. the platform bootstrap secrets.

## Required Cloudflare Worker Secrets

Set these in the same Worker that serves `screening.indo-talent.my.id`:

```bash
npx wrangler secret put SUPER_ADMIN_EMAIL
npx wrangler secret put SUPER_ADMIN_PASSWORD
```

Example:

- SUPER_ADMIN_EMAIL: `admin@indo-talent.my.id`
- SUPER_ADMIN_PASSWORD: use a long unique password

Do **not** use the normal company/recruiter password unless you intentionally configured the Super Admin password to be the same.

After setting the secrets, deploy again:

```bash
npx wrangler deploy
```

## Optional hashed password

Instead of `SUPER_ADMIN_PASSWORD`, V6.38 supports `SUPER_ADMIN_PASSWORD_HASH` containing the application's PBKDF2 format. If both are present, the hash takes precedence.

## Error handling

- `admin_not_configured` = required Worker secret is missing.
- `invalid_admin_credentials` = configuration exists, but the submitted email/password does not match.
- successful login creates the platform `super-admin` session and `/api/auth/me` recognizes it as `role=admin`.

The existing company user is never promoted automatically. This prevents a company login from becoming platform admin accidentally.
