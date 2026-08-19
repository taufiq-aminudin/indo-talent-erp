# V6.17 — Screening Schema Fix

V6.16 is left untouched. V6.17 is a separate copy based on V6.16.

Fixes:
- applications table uses `ai_score`, not `score`;
- Screening list now loads the 20 applications instead of failing silently;
- Rule screening writes score/results into the existing `ai_*` columns;
- AI screening writes score, summary, strengths, weaknesses, recommendation,
  matched/missing skills, interview questions, model, and screened timestamp;
- Screening UI shows a safe error instead of a blank table;
- AI action is available when a CV object exists.

No D1 schema changes or migrations are required.
