# V6.30 — Transparent Screening Score

This release makes the screening score explainable.

Rule-based score:
- Skills match: 0–50
- Experience: 0–25
- Role relevance: 0–15
- Profile completeness: 0–10
- Total: 0–100

Important: the previous 50/100 was a fallback score when no candidate
experience/profile evidence was available. It was NOT an AI score.

V6.30 also fixes the rule-screening comparison so job text is compared against
candidate evidence rather than comparing the candidate's own skills against
their own summary.

UI now displays the scoring breakdown and matched/missing evidence.
Login, sessions, D1, R2, upload flow and AI flow are preserved.
