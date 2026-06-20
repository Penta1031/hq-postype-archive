-- Run this once in Supabase SQL Editor after deploying this update.
-- Existing archive rows are preserved. Only anonymous read access is narrowed.

alter table public.postype_archive enable row level security;
alter table public.postype_sources enable row level security;
alter table public.crawl_runs enable row level security;

drop policy if exists "postype_archive_public_read" on public.postype_archive;
drop policy if exists "crawl_runs_public_read" on public.crawl_runs;

revoke all on public.postype_archive from anon, authenticated;
revoke all on public.postype_sources from anon, authenticated;
revoke all on public.crawl_runs from anon, authenticated;

drop view if exists public.postype_archive_public;
create view public.postype_archive_public
with (security_barrier = true)
as
select
  id,
  source_row_number,
  title,
  author,
  published_date,
  link,
  is_paid,
  is_adult,
  category,
  genres,
  keywords,
  top_tags,
  bottom_tags,
  endings,
  is_series,
  series_name,
  series_volume,
  serialization_status,
  admin_reviewed
from public.postype_archive
where deleted_at is null
  and admin_reviewed is true;

create or replace view public.crawl_runs_public
with (security_barrier = true)
as
select
  id,
  started_at,
  finished_at,
  status,
  found_count,
  inserted_count,
  ai_review_count,
  failed_count,
  created_at
from public.crawl_runs;

revoke all on public.postype_archive_public from public;
revoke all on public.crawl_runs_public from public;
grant select on public.postype_archive_public to anon, authenticated;
grant select on public.crawl_runs_public to anon, authenticated;
