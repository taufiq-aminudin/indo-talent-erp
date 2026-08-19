# Deployment repair

This package fixes the Cloudflare Worker name mismatch and replaces the project logo.

## One required value before deployment

The D1 database ID is account-specific and cannot be safely guessed. In `cloudflare/wrangler.toml`,
replace:

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with the real ID of the `ai_screening` D1 database.

Get it with:

```bash
npx wrangler d1 list
```

Then upload/push the repaired project to GitHub and let Cloudflare Workers Builds deploy it.
