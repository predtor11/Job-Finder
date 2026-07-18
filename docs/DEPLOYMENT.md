# Deployment — Vercel + Supabase

Production topology:

- **Vercel** — Next.js app + Vercel Cron (discovery, dispatch, inbox, daily)
- **Supabase** — Postgres (+RLS), Auth, Storage
- **Optional**: Redis (Upstash/Railway) + the worker container for
  cron-independent background processing

## 1. Supabase (production project)

1. Create a project → note the **Project URL**, **anon key**, **service_role
   key** (Settings → API) and the **connection strings** (Settings → Database).
2. Apply the schema from your machine (uses `DIRECT_URL`):
   ```bash
   npm run db:push
   ```
3. SQL Editor → run `supabase/migrations/0001_rls_and_triggers.sql`.
4. Authentication → Providers → enable **Email**. If you also want
   Google *app sign-in*, configure the provider and add
   `https://YOUR-DOMAIN/auth/callback` to its redirect URLs.
5. Authentication → URL Configuration → set Site URL to your production domain.

## 2. Google OAuth (Gmail sending)

In Google Cloud Console, on your OAuth client add the production redirect URI:

```
https://YOUR-DOMAIN/api/gmail/callback
```

Publish the consent screen (or keep it in Testing with your account as a test
user — sufficient for personal use).

## 3. Vercel

1. Push the repository to GitHub and import it in Vercel.
2. Set every variable from `.env.example` in Project → Settings →
   Environment Variables. Production values to double-check:
   - `NEXT_PUBLIC_APP_URL=https://YOUR-DOMAIN`
   - `GOOGLE_REDIRECT_URI=https://YOUR-DOMAIN/api/gmail/callback`
   - `DATABASE_URL` = pooled (port 6543, `?pgbouncer=true&connection_limit=1`)
   - `DIRECT_URL` = direct (port 5432)
   - `CRON_SECRET` = long random string — Vercel automatically sends it as
     `Authorization: Bearer <CRON_SECRET>` on cron invocations
3. Deploy. `vercel.json` registers the cron jobs:

   | Route | Schedule | Purpose |
   | --- | --- | --- |
   | `/api/cron/discovery` | every 4 h | fetch new jobs for all users |
   | `/api/cron/dispatch` | every 5 min | send due, approved emails |
   | `/api/cron/inbox` | every 10 min | sync Gmail replies + classify |
   | `/api/cron/daily` | 02:30 UTC | follow-up drafts + analytics rollups |

   (Hobby-plan note: Vercel Hobby allows only daily crons — either upgrade,
   or run the worker container below, or trigger the routes from an external
   scheduler like cron-job.org with the `Authorization: Bearer CRON_SECRET`
   header.)

## 4. Optional worker (Redis + container)

For processing independent of Vercel's cron limits:

1. Provision Redis (Upstash free tier works) → set `REDIS_URL`.
2. Deploy the worker image anywhere containers run (Railway, Fly.io, a VPS):
   ```bash
   docker build -f docker/Dockerfile.worker -t job-finder-worker .
   docker run -d --env-file .env job-finder-worker
   ```
   The worker registers its own repeatable schedules (discovery 4 h, inbox
   10 min, dispatch 5 min, daily 24 h). If you run the worker, you can remove
   the overlapping Vercel crons (keep `/api/cron/dispatch` disabled in one
   place or the other; both are safe to run concurrently — dispatch claims
   are atomic — but redundant).

## 5. Post-deploy checklist

- [ ] Sign up → profile row auto-created (check `profiles` table)
- [ ] Upload a resume → parsed profile appears; file lands in the private
      `resumes` bucket
- [ ] Connect Gmail in Settings → row in `gmail_accounts` with encrypted tokens
- [ ] Run discovery from the Jobs page → jobs appear
- [ ] Create an application → draft email in Approval Queue
- [ ] Approve → email gets `scheduledAt` inside working hours → arrives from
      your Gmail; `applications.status` flips to SENT
- [ ] Reply to it from another account → within ~10 min the reply is
      classified and the application updates
- [ ] RLS spot-check: with the anon key, `select * from jobs` returns only
      your rows (or none when signed out)

## Security notes

- The service-role key and `ENCRYPTION_KEY` exist **only** as server env vars.
- Gmail tokens and user Gemini keys are AES-256-GCM encrypted at rest.
- All tables carry owner-scoped RLS as defense-in-depth behind Prisma.
- Cron routes reject requests without the bearer secret.
- Rotate `ENCRYPTION_KEY` by decrypting+re-encrypting `gmail_accounts` and
  `settings.gemini_api_key_enc` in a maintenance script.
