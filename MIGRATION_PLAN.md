# V5 -> V6 Migration Plan

## Completed in this foundation

- Cloudflare Worker runtime
- D1 schema
- R2 binding
- Multi-tenant data model
- Jobs API
- Candidates API
- Rule-based screening API
- AI screening endpoint
- Health endpoint
- Legacy V5 retained separately

## Next build order

1. Authentication/session
2. Tenant isolation from authenticated identity
3. R2 signed upload/download
4. PDF/DOCX extraction strategy
5. Job requirement analyzer
6. CV parser
7. Weighted scoring engine
8. Recruiter dashboard
9. Candidate detail
10. Screening/interview workflow
11. Email invitations
12. CSV/client reports
13. Billing/usage limits

## Do not migrate blindly

V5 writes to:
- SQLite (`sui_ai.db`)
- local `uploads/`

V6 replaces these with:
- D1
- R2

The V5 scoring and AI prompt logic should be ported selectively into `screening-engine` modules rather than copied into route handlers.
