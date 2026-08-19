# V6.5 PBKDF2 Fix

Cloudflare Workers rejected the previous PBKDF2 setting because 120,000
iterations exceeds the supported Web Crypto limit of 100,000.

This version changes only the PBKDF2 iteration count to 100,000.
D1 schema, session schema, tenant logic, and Worker configuration are unchanged.
