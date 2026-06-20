-- Run once in Supabase SQL Editor for this update.
-- Rows that still exist in postype_archive are restored and exposed.
-- Physically deleted rows must be re-imported from the CSV backup first.

begin;

alter table public.postype_authors
  add column if not exists key_value text;

update public.postype_archive
set
  deleted_at = null,
  admin_reviewed = true,
  admin_reviewed_at = coalesce(admin_reviewed_at, now())
where deleted_at is not null
   or admin_reviewed is distinct from true;

create or replace view public.postype_archive_public
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

revoke all on public.postype_archive_public from public;
grant select on public.postype_archive_public to anon, authenticated;

commit;
