# Indo-Talent ERP V3

Cloudflare Workers + D1 recruitment ERP inspired by the user-owned Hiring Dashboard / SUI Recruitment ERP workflow.

Modules: public jobs, candidate/company accounts, dashboards, candidate database, applications pipeline, interviews, training, reports and profile management.

## Deploy
`npx wrangler deploy`

D1 binding: `DB`. Assets binding: `ASSETS`.

## Existing D1
V3 is designed to preserve the existing 7-table D1 and auto-create the V3 training tables on first request. `database/migration-v3.sql` is also provided for manual migration.
