# V6.21 — Extract CV Auth / Action Fix

Based directly on V6.20.

- Extract CV resolves the session with currentUser(c) instead of assuming a
  middleware-populated context.
- AI Screen does the same and validates company context.
- Extract CV result/error is shown in the real result panel.
- Screening action buttons are explicit non-submit buttons.
- R2 key remains candidate_profiles.cv_url, matching the upload route.
- No D1 schema changes.
- Bulk upload and login are preserved.
