# V6.11 Cookie Fix

Root cause of `Create job failed: unauthorized`:
V6.10 sent two `Set-Cookie` headers in `createSession()`. In the deployed
response path the second legacy-cookie header could overwrite the new
`ats_session` cookie, so subsequent requests had no valid authenticated
session.

V6.11 sends exactly one authenticated `Set-Cookie` header for `ats_session`.
No D1 schema changes are required.
