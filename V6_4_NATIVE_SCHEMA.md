# AI Screening V6.4 — Native ERP Schema

This version uses the existing D1 schema exactly:
- users.role: candidate | company | admin
- users.company_id
- company_profiles.user_id
- sessions(token, user_id, expires_at)

No organizations table and no new session schema are required.

Registration now creates a `company` user, then the company profile, then the session.
If registration fails, the API returns the exact failing stage and D1 error.
