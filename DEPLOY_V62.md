# V6.2 Schema-aligned

Uses the existing indo-talent-db schema: users.company_id, company_profiles.user_id, jobs.company_id, candidate_profiles.user_id.
No new D1 migration is required.
Required bindings: DB, CV_BUCKET, APP_NAME. Optional: OPENAI_API_KEY, OPENAI_MODEL.
