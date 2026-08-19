# V6.26 — Professional Screening Result UI

Built from V6.25, preserving the login fix.

The result area no longer presents raw JSON as the main UI.
AI errors such as `ai_request_failed` are shown as a professional
error card with a human-readable explanation.

Normal screening results render as:
- score
- status
- assessment summary
- strengths
- areas to review
- skills match
- recommendation

Login/session/D1/R2/upload logic is unchanged.
