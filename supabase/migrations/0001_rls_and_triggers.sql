-- ═══════════════════════════════════════════════════════════════════════════
-- Job Finder — Supabase migration: triggers, RLS, storage policies
--
-- Table DDL is owned by Prisma (`npm run db:push` or `prisma migrate deploy`).
-- Run this AFTER the Prisma schema has been applied:
--   Supabase Dashboard → SQL Editor → paste & run
--   (or: supabase db push, with this file in supabase/migrations)
--
-- What this adds on top of the Prisma DDL:
--   1. profiles auto-provisioning trigger on auth.users
--   2. Row Level Security on every table (owner-scoped via auth.uid())
--   3. Private `resumes` storage bucket with per-user folder policies
--   4. updated_at convenience trigger for tables edited via PostgREST
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 0. Cleanup when an auth user is deleted ────────────────────────────────
-- (A cross-schema FK to auth.users would break Prisma introspection — P4002 —
--  so cleanup is a trigger instead; app-level FKs cascade from profiles.)

create or replace function public.handle_user_deleted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

revoke execute on function public.handle_user_deleted() from public, anon, authenticated;
grant execute on function public.handle_user_deleted() to supabase_auth_admin;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_user_deleted();

-- ─── 1. Auto-provision profile + settings on signup ─────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    now(),
    now()
  )
  on conflict (id) do nothing;

  insert into public.settings (id, user_id, created_at, updated_at)
  values (gen_random_uuid()::text, new.id, now(), now())
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger-only function — never callable through the Data API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

-- ─── 2. Row Level Security ──────────────────────────────────────────────────
-- The Next.js server talks to Postgres through Prisma with the service role
-- (bypasses RLS). These policies lock down the PostgREST / Realtime surface so
-- the anon key can never read or write another user's rows.

-- profiles: keyed by id = auth.uid()
alter table public.profiles enable row level security;
drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Tables carrying a user_id column, owner-scoped:
do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'gmail_accounts', 'resumes', 'companies', 'jobs',
    'recruiters', 'applications', 'cover_letters', 'email_templates',
    'emails', 'email_threads', 'email_messages', 'job_searches',
    'notifications', 'analytics_snapshots', 'email_quotas', 'ai_usage',
    'background_jobs', 'activity_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_owner', t
    );
  end loop;
end $$;

-- Child tables scoped through their parent:

alter table public.resume_profiles enable row level security;
drop policy if exists "resume_profiles_owner" on public.resume_profiles;
create policy "resume_profiles_owner" on public.resume_profiles
  for all to authenticated
  using (exists (
    select 1 from public.resumes r
    where r.id = resume_profiles.resume_id and r.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.resumes r
    where r.id = resume_profiles.resume_id and r.user_id = (select auth.uid())
  ));

alter table public.job_analyses enable row level security;
drop policy if exists "job_analyses_owner" on public.job_analyses;
create policy "job_analyses_owner" on public.job_analyses
  for all to authenticated
  using (exists (
    select 1 from public.jobs j
    where j.id = job_analyses.job_id and j.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.jobs j
    where j.id = job_analyses.job_id and j.user_id = (select auth.uid())
  ));

alter table public.application_events enable row level security;
drop policy if exists "application_events_owner" on public.application_events;
create policy "application_events_owner" on public.application_events
  for all to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_events.application_id and a.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.applications a
    where a.id = application_events.application_id and a.user_id = (select auth.uid())
  ));

-- ─── 3. Storage: private resumes bucket, per-user folders ───────────────────
-- Object keys follow: {userId}/{resumeId}/{fileName}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes', 'resumes', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain'
  ]
)
on conflict (id) do nothing;

drop policy if exists "resumes_read_own" on storage.objects;
create policy "resumes_read_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes_insert_own" on storage.objects;
create policy "resumes_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes_update_own" on storage.objects;
create policy "resumes_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "resumes_delete_own" on storage.objects;
create policy "resumes_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

-- ─── 4. updated_at maintenance for PostgREST writes ─────────────────────────
-- Prisma sets updatedAt itself; this covers rows touched outside Prisma.

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'settings', 'gmail_accounts', 'resumes', 'resume_profiles',
    'companies', 'jobs', 'job_analyses', 'recruiters', 'applications',
    'cover_letters', 'email_templates', 'emails', 'email_threads',
    'job_searches'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t
    );
  end loop;
end $$;
