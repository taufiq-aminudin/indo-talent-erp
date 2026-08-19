# V6.33 — Job Actions & Screening Hardening

## Job management
- Added POST compatibility routes for update/delete to avoid environments that block PATCH/DELETE.
- Edit and Delete buttons use event delegation instead of inline handlers.
- Edit loads the existing job into the form and saves through `/api/jobs/:id/update`.
- Delete uses soft-delete through `/api/jobs/:id/delete`, preserving applications and screening history.
- Job table has clearer status, salary metadata, and action styling.

## Screening
- Rule screening now requires CV evidence and returns `cv_not_extracted` rather than generating a misleading score.
- Explicit `Required skills` from the job are mapped to recognised competencies.
- Added finance and common competency mappings: financial management, analytical thinking, attention to detail, decision making, integrity, time management.
- Generic JD words are not treated as skills.
- AI quota errors are surfaced as a dedicated UI state.
- Screening shows a professional loading state while the request is running.

## Important
AI Screening still requires a valid OpenAI API key with available credits/quota. This release does not bypass provider billing limits.
