# Job Finder — Architecture

AI-powered job application automation platform. Finds jobs, analyzes fit against your
resumes, generates personalized cover letters and outreach emails, sends them through
your own Gmail account under strict approval + rate rules, monitors the inbox for
replies, and tracks the entire hiring pipeline in a CRM.

**Design principle: automation with consent.** Nothing is ever sent without passing the
user-configured approval rules. Recruiter contacts come only from public sources, every
contact records *where* it was found, and cold outreach always requires explicit
approval. The daily send cap (default 50) is enforced at the database level and sends
are jittered across the user's working hours so outreach stays human-paced.

---

## 1. System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              Next.js 15 (Vercel)                          │
│  ┌─────────────────────────┐    ┌──────────────────────────────────────┐  │
│  │  App Router UI (React19)│    │  API Routes (/api/*)                 │  │
│  │  dashboard · jobs · CRM │───▶│  auth-guarded, Zod-validated         │  │
│  │  inbox · analytics      │    │  enqueue work, never block on AI     │  │
│  └─────────────────────────┘    └───────────┬──────────────────────────┘  │
└─────────────────────────────────────────────┼─────────────────────────────┘
                                              │
                ┌─────────────────────────────┼─────────────────────────────┐
                │                             ▼                             │
                │  ┌──────────┐   ┌────────────────────┐   ┌─────────────┐  │
                │  │ Supabase │   │  BullMQ + Redis     │   │  Worker     │  │
                │  │ Postgres │◀──│  queues + schedules │──▶│  process    │  │
                │  │ Auth     │   └────────────────────┘   │ (Node, tsx) │  │
                │  │ Storage  │                             └──────┬──────┘  │
                │  └──────────┘                                    │         │
                └──────────────────────────────────────────────────┼─────────┘
                                                                   │
                     ┌──────────────┬──────────────────┬───────────┴───┐
                     ▼              ▼                  ▼               ▼
               Gemini API      Gmail API        Public job APIs   Public pages
               (AI modules)    (OAuth send/     (RemoteOK, HN,    (career/team
                                read/threads)    Greenhouse,       pages for
                                                 Lever, Ashby)     recruiter info)
```

Two runtime targets share one codebase:

| Runtime            | Where            | Responsibilities                                        |
| ------------------ | ---------------- | ------------------------------------------------------- |
| **Next.js app**    | Vercel           | UI, API routes, auth, quick AI calls, Vercel Cron hooks  |
| **Worker process** | Docker/Railway/VPS | BullMQ consumers: job discovery, inbox polling, email dispatch, follow-ups, analytics rollups |

On Vercel (which cannot host a persistent worker), **Vercel Cron** hits internal API
routes (`/api/cron/*`, protected by `CRON_SECRET`) that run the same engine functions
inline; with the worker deployed, the same functions run from BullMQ repeatable jobs.
Every engine is a plain async function in `src/lib/**` so both entry points share it.

## 2. Layered Design

```
UI (app router pages, components)
  └── calls API routes / server actions          — never touches DB or AI directly
API layer (src/app/api/**)
  └── auth check → Zod validation → service call — thin controllers
Service/engine layer (src/lib/**)                — ALL business logic lives here
  ├── ai/         Gemini client + typed AI modules (parse, analyze, generate, classify)
  ├── engine/     orchestrations: discovery, application pipeline, follow-ups, inbox
  ├── gmail/      OAuth, send, thread sync
  ├── jobs/       job-source adapters + dedupe
  ├── recruiters/ public-source recruiter discovery
  ├── email/      send scheduling, rate caps, jitter
  └── queue/      BullMQ queue + worker definitions
Data layer
  ├── prisma/     schema + typed client (server only)
  └── supabase/   auth (SSR cookies), storage (resumes), RLS as defense-in-depth
```

## 3. Data Flow — the Application Pipeline

```
discover ▶ analyze ▶ match resume ▶ generate cover letter ▶ generate email
        ▶ store DRAFT ▶ approval queue ▶ scheduled send ▶ track replies
        ▶ follow-up drafts ▶ dashboard/analytics
```

1. **Discovery** (`engine/discovery.ts`, every few hours): each enabled source adapter
   returns `NormalizedJob[]`; deduped by URL/company+title fingerprint; inserted as
   `Job` rows; saved searches with matching filters trigger notifications.
2. **Analysis** (`ai/job-analyzer.ts`, fast model): extracts structured fields
   (skills, requirements, stack, salary, contacts named *in the posting*), scores
   against every resume profile → match score, missing skills, strengths/weaknesses.
3. **Application creation** (user clicks Apply, or auto-pipeline for high scores):
   picks best resume (manual override allowed), generates cover letter + email
   (smart model, uniqueness enforced by including prior-email fingerprints in the
   prompt and post-checking similarity), stores everything as a **draft**.
4. **Approval**: drafts enter the approval queue. Modes: `DRAFT` (never send),
   `MANUAL` (each send approved), `AUTO` (auto-approve above a match-score
   threshold — still rate-capped), `SCHEDULED` (approved, sent at chosen time).
   Cold outreach to discovered recruiters is **always MANUAL** regardless of mode.
5. **Sending** (`email/scheduler.ts`): approved emails get a `scheduledAt` slot —
   random jitter inside working hours, min-gap between sends, hard daily cap
   enforced by an atomic DB counter (`EmailQuota`). Worker/cron dispatches due
   emails via Gmail API with resume attached, records `gmailMessageId`/`threadId`.
6. **Inbox monitoring** (`engine/inbox.ts`, every ~10 min): Gmail history/thread
   sync for tracked threads + recent inbound mail; new inbound messages are
   classified (fast model) into reply/interview/assessment/rejection/offer/question;
   application status auto-advances; notifications raised.
7. **Follow-ups** (`engine/followups.ts`, daily): no-reply applications past the
   configured day threshold get an AI follow-up **draft** (auto-send only if the
   user explicitly enabled it); first/second follow-up + last-contact tracked.
8. **Analytics** (`engine/analytics.ts`): nightly rollups into `AnalyticsSnapshot`
   + on-demand aggregate queries power the dashboard and insight generation.

## 4. AI Module Design (Gemini, free-tier aware)

| Module              | Model (default)            | Task                                            |
| ------------------- | -------------------------- | ----------------------------------------------- |
| `resume-parser`     | `gemini-flash-latest`      | PDF/DOCX text → structured profile JSON          |
| `job-analyzer`      | `gemini-flash-lite-latest` | posting → structured fields + match analysis     |
| `email-classifier`  | `gemini-flash-lite-latest` | inbound email → category + confidence            |
| `cover-letter`      | `gemini-flash-latest`      | unique cover letter per application              |
| `email-generator`   | `gemini-flash-latest`      | outreach/apply/follow-up emails, A/B variants    |
| `insights`          | `gemini-flash-latest`      | periodic analytics insights                      |

Defaults use Google's rolling `-latest` aliases so model sunsets (like the
2.5-family retirement for new keys) never break the pipeline; concrete model
ids remain selectable in Settings → AI.

Free-tier techniques: model tiering (lite for high-volume extraction), strict JSON
output via `responseSchema`, minimal context (only the resume profile JSON, not raw
resume text), request coalescing (analyze N jobs per call where safe), retry with
exponential backoff on 429, and a per-day AI call budget in `Setting`. Model names are
user-configurable in Settings.

## 5. Job Sources & Compliance

| Source               | Method                                             | Automated? |
| -------------------- | -------------------------------------------------- | ---------- |
| RemoteOK             | public JSON API                                    | ✅         |
| Hacker News Who is Hiring (YC ecosystem) | Algolia HN public API           | ✅         |
| Greenhouse           | public board API (`boards-api.greenhouse.io`)      | ✅ per-company |
| Lever                | public postings API (`api.lever.co/v0/postings`)   | ✅ per-company |
| Ashby                | public job board API (`api.ashbyhq.com/posting-api`)| ✅ per-company |
| Company career pages | fetch + AI extraction for pages the user adds      | ✅ user-added |
| LinkedIn / Wellfound | **manual import** — paste a URL/description; AI extracts fields | ⚠️ ToS: no scraping |

LinkedIn and Wellfound prohibit automated scraping, so the platform ships an
**importer** (paste URL or description → AI-normalized job) instead of a scraper.
Recruiter discovery reads only public pages tied to a job (careers/team/contact pages,
contacts listed in the posting itself), stores the source URL + confidence for each
contact, and never fabricates addresses.

## 6. Email Safety Model

- OAuth only (Gmail API); tokens AES-256-GCM encrypted at rest; no passwords ever.
- Hard daily cap (default 50) — atomic counter per user per day; the dispatcher
  re-checks at send time, not just at scheduling time.
- Natural pacing: sends distributed over working hours with randomized intervals
  (configurable min gap ± jitter); burst-proof by construction.
- Approval rules evaluated server-side on every transition to `QUEUED`.
- Cold outreach: always requires explicit per-email approval.
- Every send is logged (`ActivityLog`) with the full rendered content snapshot.

## 7. Security

- **Supabase Auth** (email/password + OAuth) with `@supabase/ssr` cookie sessions;
  middleware refreshes tokens; every API route resolves the user server-side.
- **RLS enabled on every table** (`user_id = auth.uid()`), so even direct PostgREST
  access is scoped. Prisma connects as the service role for server code, which is the
  only place business logic runs.
- **Encryption**: Gmail OAuth tokens and user-supplied API keys encrypted with
  AES-256-GCM (`ENCRYPTION_KEY`, 32 bytes, never in the client bundle).
- **Storage**: resumes in a private Supabase Storage bucket, per-user folder policies,
  short-lived signed URLs only.
- Zod validation at every API boundary; service-role key and all secrets server-only;
  cron routes authenticated with `CRON_SECRET`.

## 8. Deployment Topology

- **Vercel**: Next.js app + Vercel Cron (discovery every 4h, inbox every 10m,
  dispatch every 5m, follow-ups+analytics daily) → see `vercel.json`.
- **Supabase**: Postgres (+RLS), Auth, Storage.
- **Redis** (Upstash/Railway) + **worker container** (Dockerfile.worker): optional but
  recommended for high-volume background processing; cron-only mode works without it.
- CI: typecheck + vitest; migrations applied via `prisma migrate deploy`.
