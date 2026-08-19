# V6.25 — External Client JS / Login Fix

Built from V6.24.

Root cause addressed:
- The recruiter UI relied on an inline `<script>` block.
- The browser was behaving as if the inline client script was not executing:
  clicking Sign in caused a normal GET / instead of POST /api/auth/login.
- V6.25 moves the entire client application JavaScript into
  `public/app.js`, served as a same-origin Cloudflare asset.
- The HTML loads it with `defer` and a cache-busting query string.

Expected login request after clicking Sign in:
POST /api/auth/login

No changes to:
- users/session/database schema
- password hashing
- D1
- R2
- OpenAI secret
- CV upload/extraction
- AI screening API
- professional screening result UI

After deployment, hard refresh once with Ctrl+Shift+R.
