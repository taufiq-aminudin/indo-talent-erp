# V6.9 Auth + Create Job Fix

Create Job and Job List now use explicit `requireAuth` middleware instead of relying on
the generic path middleware. The POST route reports whether the failure occurs during
authentication, company context, role validation, or the D1 insert.

Added `/api/auth/status` as a safe diagnostic endpoint that exposes only authenticated
user identity metadata (no session token).

No database schema changes are required.
