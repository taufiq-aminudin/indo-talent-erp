# V6.10 Session + Create Job Final

- Uses a versioned `ats_session` cookie to avoid stale legacy `session` cookies.
- New login sessions are stored in the existing D1 `sessions(token,user_id,expires_at)` schema.
- Legacy `session` cookie is cleared on login/logout.
- Create Job and Job List perform route-local session authentication, avoiding middleware matching ambiguity.
- Errors include safe authentication stage details; no session token is exposed.
- No database schema changes or migrations are required.
