# Indo-Talent ERP V2

Commercial-ready recruitment ERP foundation for Cloudflare Workers + D1.

## Architecture
- Frontend: Vanilla HTML/CSS/JS
- Backend/API: Cloudflare Worker
- Database: Cloudflare D1
- Deployment: GitHub → Cloudflare Workers Builds
- Custom domain target: `erp.indo-talent.my.id`

## Roles
- `admin`: platform owner
- `company`: employer/client
- `candidate`: job seeker

## Multi-company / SaaS foundation
Every job belongs to a company. Applications are scoped through the job's company.
The API checks role and ownership before company operations.

## Local setup
1. Install Wrangler:
   `npm install -g wrangler`
2. Login:
   `wrangler login`
3. Create D1:
   `npx wrangler d1 create indo-talent-erp`
4. Put the returned database ID into `wrangler.toml`.
5. Apply schema:
   `npx wrangler d1 execute indo-talent-erp --remote --file=database/schema.sql`
6. Run:
   `npx wrangler dev`
7. Deploy:
   `npx wrangler deploy`

## GitHub
Push the contents of this folder to the repository root. Do not put another `indo-talent-erp` folder inside the repository.

## Demo accounts
- admin@indo-talent.my.id / Admin123!
- company@indo-talent.my.id / Company123!
- candidate@indo-talent.my.id / Candidate123!

Change demo passwords before production.

## Production checklist
- Set strong passwords.
- Add Cloudflare Turnstile.
- Add email verification and password reset.
- Add R2 for CV/document storage.
- Configure transactional email.
- Add payment gateway.
- Add backups and monitoring.
- Review security headers and rate limits.
- Replace demo seed credentials before public launch.

## Commercial licensing
The application code is proprietary to its owner unless a separate written license is granted.
Third-party dependencies, if added later, remain subject to their own licenses.
