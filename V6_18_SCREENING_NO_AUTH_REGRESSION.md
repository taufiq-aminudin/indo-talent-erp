# V6.18 — Screening Fix Without Auth Regression

V6.18 is rebuilt directly from V6.16, not V6.17.

Auth/session code is retained from V6.16 with a small login hardening:
- case-insensitive email lookup;
- explicit email/password validation;
- no-store response;
- same session table and cookie mechanism.

Screening fixes:
- use applications.ai_score;
- display screening_score;
- persist rule and AI results into ai_* fields;
- show API errors instead of a blank Screening table.

Bulk/folder upload from V6.16 is preserved.
No D1 schema changes.
