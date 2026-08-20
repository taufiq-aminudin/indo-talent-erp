# V6.36 — Profile, Super Admin & Commercial

## Profile
- Professional account menu in header.
- Company profile modal with company/legal/contact/address fields.

## Super Admin
- `/super-admin` login and dashboard.
- Supports DB `users.role=admin` or bootstrap `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` secrets.
- Platform overview, companies and credit balances.

## Commercial
- Customer-facing product is AI Screening Credits, not provider tokens.
- Starter: 1,000 credits / Rp99,000
- Growth: 5,000 / Rp399,000
- Professional: 15,000 / Rp999,000
- Enterprise: 50,000 / Rp2,999,000
- Orders start as pending; Super Admin approval credits the company wallet.
- Ledger and AI usage tables are created automatically in D1.

## Deploy
Set production secrets:
`npx wrangler secret put SUPER_ADMIN_EMAIL`
`npx wrangler secret put SUPER_ADMIN_PASSWORD`
Then deploy with `npx wrangler deploy`.
