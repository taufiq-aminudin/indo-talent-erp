# V6.41 — Super Admin Login Diagnostic & Secret Normalization

Fixes:
- Normalizes accidental surrounding quotes/trailing newline in Cloudflare Secrets.
- Supports SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD and ADMIN_EMAIL / ADMIN_PASSWORD aliases.
- Adds masked configuration diagnostics at `/api/admin/config-status`.
- Shows configuration state and auth mode on the Super Admin login page.
- Never exposes the password or secret value.

Required Worker secrets:
- SUPER_ADMIN_EMAIL
- SUPER_ADMIN_PASSWORD

If both are configured and login still reports `invalid_admin_credentials`, the entered email/password do not match the values stored on the deployed Worker. The diagnostic endpoint shows the masked configured email and password length without revealing the secret.
