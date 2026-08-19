# V6.3 Build Fix

Fixed the frontend API error formatter in `src/index.ts`.
The previous nested template literal caused the Cloudflare esbuild parser to fail.
No database schema or D1 configuration was changed.
