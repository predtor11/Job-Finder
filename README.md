# Job Finder

AI-powered job application automation platform. Discovers jobs from public
sources, analyzes them against your resume library with Gemini, generates
personalized cover letters and outreach emails, sends them through **your own
Gmail** under strict approval rules and a hard daily cap, monitors replies, and
tracks the whole hiring pipeline in a CRM-style dashboard.

**Not a spam tool.** Every email is unique and personalized, recruiter contacts
come only from public sources (with the source URL stored and shown), cold
outreach always requires your explicit approval, and sending is capped at
50/day and paced naturally across your working hours.

## Stack

Next.js 15 · React 19 · TypeScript · TailwindCSS 4 · shadcn/ui · TanStack
Query/Table · Supabase (Postgres + Auth + Storage, RLS everywhere) · Prisma ·
Gemini API (free tier friendly) · Gmail API (OAuth) · BullMQ + Redis (optional
worker) · Vercel Cron.

## Quick start

### 1. Prerequisites

- Node 20+ and npm
- A [Supabase](https://supabase.com) project (free tier is fine)
- A [Google AI Studio](https://aistudio.google.com/apikey) Gemini API key (free)
- A Google Cloud OAuth client with the **Gmail API enabled**
- (Optional) Redis for the background worker — Vercel Cron works without it

### 2. Configure environment

```bash
cp .env.example .env.local   # for Next.js
cp .env.example .env         # for Prisma CLI / worker / docker
```

Fill in every value — each one is documented inline in `.env.example`.
Generate the encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

For the Google OAuth client (Google Cloud Console → APIs & Services):
1. Enable the **Gmail API**.
2. Create an **OAuth client ID** (Web application).
3. Add redirect URI: `http://localhost:3000/api/gmail/callback` (plus your
   production URL later).
4. Add scopes on the consent screen: `gmail.send`, `gmail.readonly`,
   `gmail.modify`, `userinfo.email`.
5. While the consent screen is in "Testing" mode, add your Gmail address as a
   test user.

### 3. Database

```bash
npm install
npm run db:push        # applies prisma/schema.prisma to Supabase Postgres
```

Then open the Supabase **SQL Editor** and run
[`supabase/migrations/0001_rls_and_triggers.sql`](supabase/migrations/0001_rls_and_triggers.sql)
— it adds the signup trigger, Row Level Security on every table, and the
private `resumes` storage bucket with per-user policies.

In Supabase → Authentication → Providers, enable **Email** (and optionally
Google for app sign-in).

### 4. Run

```bash
npm run dev            # app on http://localhost:3000
```

Optional background worker (instead of / in addition to Vercel Cron):

```bash
docker compose up redis   # or any Redis
npm run worker:dev
```

### 5. First steps in the app

1. Sign up, then **Settings → AI**: paste your Gemini key (or rely on the
   server `GEMINI_API_KEY`).
2. **Settings → Email & Gmail**: connect your Gmail via OAuth.
3. **Resumes**: upload one resume per target role — each is parsed into a
   structured profile.
4. **Settings → Job Sources**: enable sources; add Greenhouse/Lever/Ashby
   boards of companies you care about.
5. **Jobs**: run **Discover now**, or **Import** a posting by URL/paste
   (the compliant path for LinkedIn/Wellfound).
6. Open a job → **Analyze fit** → **Apply** → review the draft in the
   **Approval Queue** → approve. It sends inside your working hours, paced
   and capped. Replies show up on the application automatically.

## How sending stays safe

| Rule | Enforcement |
| --- | --- |
| Max 50 emails/day | Atomic per-user counter checked at send time (`EmailQuota`) |
| No bursts | Min-gap + random jitter between scheduled sends |
| Working hours only | Scheduler slots sends inside your configured hours/days/timezone |
| Nothing sends unapproved | Server-side state machine; `DRAFT` mode disables sending entirely |
| Cold outreach | **Always** requires per-email manual approval, in every mode |
| Contact provenance | Every recruiter stores `sourceUrl` + confidence; emails must literally appear on the source page |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest unit tests |
| `npm run db:push` | Apply Prisma schema to the database |
| `npm run worker` / `worker:dev` | BullMQ background worker |

## Project layout

```
src/
  app/            pages ((auth), (app)) + API routes (api/**)
  components/     ui/ (shadcn) · layout/ (shell) · shared/
  lib/
    ai/           gemini client + resume parser, job analyzer, cover letter,
                  email generator, inbound classifier
    engine/       discovery, pipeline, inbox, follow-ups, analytics
    email/        scheduler (pacing, quota, dispatch)
    gmail/        oauth + MIME sender
    jobs/         source adapters (remoteok, hn, greenhouse, lever, ashby,
                  career pages) + importer + dedupe
    recruiters/   public-source contact discovery
    queue/        BullMQ queues
    supabase/     browser/server/admin clients
prisma/           schema (all models)
supabase/         RLS + triggers + storage migration
workers/          worker process entry
docker/           worker Dockerfile
docs/             architecture + deployment guides
tests/            vitest unit tests
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production deployment on
Vercel + Supabase.
