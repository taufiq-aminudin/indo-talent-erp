# AI Screening V6.1 — Deploy

This release adds:
- organization registration and login
- secure opaque session cookies stored in D1
- tenant-isolated jobs/candidates/applications/dashboard queries
- CV upload to R2 (PDF/DOCX/TXT, max 10 MB)
- rule-based screening
- OpenAI Responses API screening with structured JSON output

## 1. Push this package to GitHub

Upload the contents of this package to the repository connected to Worker `indo-talent-erp`.

## 2. Apply the D1 migration once

From the `cloudflare/` directory:

```bash
npx wrangler d1 migrations apply indo-talent-db --remote
```

Cloudflare records applied migrations in the D1 migrations table, so rerunning the command is safe for already-applied migrations.

If you prefer the Cloudflare D1 SQL Console, run the contents of `migrations/0002_auth_uploads.sql` there.

## 3. Configure secrets (optional until AI screening is used)

```bash
npx wrangler secret put OPENAI_API_KEY
```

Optional model variable:

```bash
npx wrangler secret put OPENAI_MODEL
```

If `OPENAI_MODEL` is not set, the Worker uses `gpt-5.6`.

## 4. Deploy

```bash
npx wrangler deploy
```

## 5. Verify

- `/api/health` should return `ok: true`.
- Open `/` and create an organization.
- Create a job.
- Upload a TXT CV to test text indexing immediately.
- PDF/DOCX upload is stored in R2, but text extraction is intentionally marked pending in this release; the extraction worker is the next module.

## Security notes

- The browser no longer supplies `organization_id` for protected CRUD routes.
- Sessions are opaque random tokens; only a SHA-256 token hash is stored in D1.
- Passwords use PBKDF2-SHA-256 through Cloudflare Workers Web Crypto.
- Final hiring decisions must remain with a recruiter; AI output is decision support, not an automated hiring decision.
