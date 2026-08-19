# V6.31 — Semantic Job-to-CV Screening Fix

## What changed
- Rule screening no longer treats generic Job Description words such as `posisi`, `departemen`, `lokasi`, `atasan`, `langsung`, `general`, `kerja`, `deskripsi`, and `jawab` as skills.
- Rule screening extracts recognised job-relevant competencies and compares them with extracted CV evidence.
- AI screening now returns explicit matched skills, missing/unverified requirements, CV evidence, review areas, and a transparent 100-point breakdown.
- `overall_score` is calculated from the four breakdown values: Skills Match 50, Experience 25, Role Relevance 15, Profile Completeness 10.
- The UI now separates Matched Skills, Missing/Unverified, CV Evidence, and Areas to Review.
- Candidate name is not used for scoring.

## Important
AI screening still requires a valid `OPENAI_API_KEY` and available API credits/quota. If quota is exhausted, the application shows a professional error state and does not overwrite the previous score.
