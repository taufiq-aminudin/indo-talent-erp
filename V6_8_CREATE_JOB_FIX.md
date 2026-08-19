# V6.8 Create Job Fix

The existing jobs schema is used as-is:
id, company_id, title, location, salary, description, status, created_at.

The Create Job API now:
- validates company context and role,
- catches D1 errors and returns `job_create_failed` with the actual detail,
- preserves submitted requirements by appending them to the job description because the ERP jobs table has no requirements column.

The frontend now displays `Creating job...`, `Job created successfully.`, or the exact API error instead of silently doing nothing.
No database schema changes are required.
